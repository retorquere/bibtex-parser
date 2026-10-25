//! BibTeX processing has two stages: scan directives into raw field strings, then reparse
//! those strings by field mode. The raw scanner owns entry recovery and string concatenation;
//! `tex` owns TeX syntax and rendering, while `tokenizer` supplies title-casing token boundaries.
//! Synchronous and WASM asynchronous entry points share the same parsing and normalization paths.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

mod tex;
mod tokenizer;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// One BibTeX entry as read by the verbatim parser.
pub struct Entry {
    /// The trimmed source text for this entry.
    pub input: String,
    /// The entry type, normalized to lowercase.
    #[serde(rename = "type")]
    pub entry: String,
    /// The citation key, preserved as written.
    pub key: String,
    /// Field names are lowercase; duplicate fields use a `+duplicate-N` suffix.
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// A recoverable parsing error and the source text associated with it.
pub struct ParseError {
    /// Error description, including the source location.
    pub error: String,
    /// The malformed entry text, or an empty string for unresolved strings.
    pub input: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Results produced by [`parse_verbatim`]. Entries remain in source order.
pub struct Library {
    /// Successfully read entries.
    pub entries: Vec<Entry>,
    /// Resolved `@string` declarations, with uppercase keys.
    pub strings: HashMap<String, String>,
    /// Contents of `@comment` directives.
    pub comments: Vec<String>,
    /// Errors encountered while parsing; parsing continues after malformed entries.
    pub errors: Vec<ParseError>,
    /// Values from `@preamble` directives.
    pub preambles: Vec<String>,
    /// JabRef metadata extracted from `jabref-meta:` comments.
    #[serde(default)]
    pub jabref: JabRefMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// A JabRef group; nested groups are stored in their parent's `groups` vector.
pub struct JabRefGroup {
    /// The group name.
    pub name: String,
    /// Citation keys belonging to this group after intersection/union calculations.
    pub entries: Vec<String>,
    /// Child groups in the hierarchy.
    pub groups: Vec<JabRefGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Metadata imported from JabRef's `jabref-meta:` comments.
pub struct JabRefMetadata {
    /// Top-level groups; nested groups are available through each group's `groups` field.
    pub root: Vec<JabRefGroup>,
    /// Base directory for attachment paths.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_directory: Option<String>,
    /// JabRef group metadata format version.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groupsversion: Option<u32>,
    /// JabRef database type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database_type: Option<String>,
}

impl JabRefMetadata {
    /// Populates JabRef 3.8+ memberships in `root` by group name; duplicate names select the first node.
    pub fn add_entry(&mut self, name: &str, key: &str) -> bool {
        /// Return the first depth-first group with this name, preserving duplicate-name precedence.
        fn find<'a>(groups: &'a mut [JabRefGroup], name: &str) -> Option<&'a mut JabRefGroup> {
            for group in groups {
                if group.name == name {
                    return Some(group);
                }
                if let Some(found) = find(&mut group.groups, name) {
                    return Some(found);
                }
            }
            None
        }

        let Some(group) = find(&mut self.root, name) else {
            return false;
        };
        if !group.entries.iter().any(|entry| entry == key) {
            group.entries.push(key.to_string());
        }
        true
    }
}

/// Decode JabRef metadata records: backslash quotes the next character, separators split records,
/// and LF/CRLF line breaks are discarded. Empty records are omitted from the returned list.
fn decode_jabref(input: &str, separator: char) -> Vec<String> {
    let mut records = vec![String::new()];
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                if let Some(escaped) = chars.next() {
                    records[0].push(escaped);
                }
            }
            '\r' if chars.peek() == Some(&'\n') => {
                chars.next();
            }
            '\n' => {}
            ch if ch == separator => records.insert(0, String::new()),
            ch => records[0].push(ch),
        }
    }
    records.reverse();
    records.retain(|record| !record.is_empty());
    records
}

/// Follow child indices from the root; an empty path or any invalid index returns `None`.
fn jabref_group_at_path_mut<'a>(
    groups: &'a mut [JabRefGroup],
    path: &[usize],
) -> Option<&'a mut JabRefGroup> {
    let (index, remainder) = path.split_first()?;
    let group = groups.get_mut(*index)?;
    if remainder.is_empty() {
        Some(group)
    } else {
        jabref_group_at_path_mut(&mut group.groups, remainder)
    }
}

/// Import JabRef groups from metadata comments and return unrelated comments unchanged.
///
/// Independent groups keep their listed keys, intersections retain only keys in the parent,
/// unions add parent keys, and query groups are not parsed. A malformed record stops processing
/// its encoded tree because later hierarchy levels may depend on the missing group path.
fn parse_jabref_metadata(comments: Vec<String>) -> (Vec<String>, JabRefMetadata) {
    let mut metadata = JabRefMetadata::default();
    let mut kept = Vec::new();
    let mut decoded = HashMap::<String, Vec<String>>::new();

    for comment in comments {
        let Some(rest) = comment.strip_prefix("jabref-meta:") else {
            kept.push(comment);
            continue;
        };
        let rest = rest.trim_start();
        let Some((kind, payload)) = rest.split_once(':') else {
            // Preserve malformed metadata verbatim rather than silently dropping the source comment.
            kept.push(comment);
            continue;
        };
        // Preserve input-order precedence: a later declaration of the same kind replaces the earlier one.
        decoded.insert(kind.to_string(), decode_jabref(payload, ';'));
    }

    if let Some(value) = decoded
        .get("groupsversion")
        .and_then(|values| values.first())
    {
        metadata.groupsversion = value.trim().parse::<u32>().ok();
    }
    metadata.file_directory = decoded
        .get("fileDirectory")
        .and_then(|values| values.first())
        .cloned();
    metadata.database_type = decoded
        .get("databaseType")
        .and_then(|values| values.first())
        .cloned();

    // Track the latest group path at each depth so subsequent records attach to their immediate parent.
    let mut levels = Vec::<Vec<usize>>::new();
    for tree in ["groupstree", "grouping"] {
        let Some(encoded_groups) = decoded.get(tree) else {
            continue;
        };
        for encoded in encoded_groups {
            let mut fields = decode_jabref(encoded, ';');
            let Some(level_type_name) = fields.first().cloned() else {
                // Tree records are ordered by hierarchy, so later groups may depend on this record.
                break;
            };
            fields.remove(0);
            let level_and_type = decode_jabref(&level_type_name, ':');
            let Some(level_type) = level_and_type.first() else {
                break;
            };
            let Some((level, group_type)) = level_type.split_once(' ') else {
                break;
            };
            let Ok(level) = level.parse::<usize>() else {
                break;
            };
            if group_type == "AllEntriesGroup" {
                // JabRef's synthetic all-entries group is a root marker, not a named child group.
                continue;
            }
            let Some(name) = level_and_type.get(1) else {
                break;
            };
            let intersection = fields
                .first()
                .and_then(|field| decode_jabref(field, ';').first().cloned())
                .unwrap_or_default();
            if !fields.is_empty() {
                fields.remove(0);
            }
            let mut group = JabRefGroup {
                name: name.clone(),
                // The `grouping` records describe hierarchy only; `groupstree` carries memberships.
                entries: if tree == "grouping" {
                    Vec::new()
                } else {
                    fields
                        .iter()
                        .filter_map(|field| decode_jabref(field, ';').first().cloned())
                        .collect()
                },
                groups: Vec::new(),
            };

            // Root groups start new branches; nested groups require the previously recorded parent path.
            if level == 1 {
                let root_index = metadata.root.len();
                metadata.root.push(group);
                let path = vec![root_index];
                if levels.len() < level {
                    levels.push(path);
                } else {
                    levels[level - 1] = path;
                }
            } else if let Some(parent_path) = levels.get(level - 2).cloned() {
                let Some(parent) = jabref_group_at_path_mut(&mut metadata.root, &parent_path)
                else {
                    // Do not attach an orphan at the wrong level when an earlier path is invalid.
                    continue;
                };
                let parent_entries = parent.entries.clone();
                // JabRef encodes membership as intersection (1), union (2), or independent (0).
                // Union appends only missing parent keys so the child's entry order is retained.
                match intersection.as_str() {
                    "1" => group.entries.retain(|key| parent_entries.contains(key)),
                    "2" => {
                        let inherited: Vec<_> = parent_entries
                            .into_iter()
                            .filter(|key| !group.entries.contains(key))
                            .collect();
                        group.entries.extend(inherited);
                    }
                    _ => {}
                }
                let child_index = parent.groups.len();
                parent.groups.push(group);
                let mut path = parent_path;
                path.push(child_index);
                if levels.len() < level {
                    levels.push(path);
                } else {
                    levels[level - 1] = path;
                }
            }
        }
    }
    (kept, metadata)
}

#[derive(Deserialize)]
struct CrossReferenceData {
    allowed: HashMap<String, Vec<String>>,
    #[serde(rename = "noCrossRef")]
    no_cross_ref: Vec<String>,
}

type CrossReferenceMap = HashMap<String, HashMap<String, HashMap<String, String>>>;

static CROSS_REFERENCE_DATA: OnceLock<CrossReferenceData> = OnceLock::new();
static CROSS_REFERENCE_MAP: OnceLock<CrossReferenceMap> = OnceLock::new();

/// Lazily decode embedded allowed-field and exclusion lists shared by all inheritance passes.
fn cross_reference_data() -> &'static CrossReferenceData {
    CROSS_REFERENCE_DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../data/fields.json"))
            .expect("fields.json is valid cross-reference data")
    })
}

/// Lazily decode child/parent type mappings and their source-to-destination field remappings.
fn cross_reference_map() -> &'static CrossReferenceMap {
    CROSS_REFERENCE_MAP.get_or_init(|| {
        serde_json::from_str(include_str!("../data/crossref.json"))
            .expect("crossref.json is valid cross-reference data")
    })
}

/// Match JavaScript truthiness for fields: empty text is false, but even empty lists are true.
fn field_value_is_truthy(value: &FieldValue) -> bool {
    match value {
        FieldValue::Text(value) => !value.is_empty(),
        FieldValue::Creators(_) | FieldValue::List(_) => true,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossRefSource {
    pub parent: String,
    pub field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VerbatimField {
    Name(String),
    Pattern { source: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnsupportedHandler {
    TeX,
    Text,
    Ignore,
    Throw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
/// Configuration for verbatim and full BibTeX parsing.
pub struct Options {
    /// Stop after this many entries. `None` and `Some(0)` both mean no limit.
    pub max_entries: Option<usize>,
    /// Additional predefined strings, matched without regard to key case.
    pub strings: HashMap<String, String>,
    /// Skip TeX-to-Unicode conversion and sentence-casing while still parsing field structure.
    pub raw: bool,
    /// Apply inherited cross-reference fields from the target entry to its children.
    pub apply_crossref: bool,
    /// Case-insensitive field-name patterns that select verbatim mode.
    ///
    /// Fields such as `url` are normally parsed in verbatim mode, where TeX commands are treated
    /// as regular text. Patterns use `*` for any number of characters and `?` for one character;
    /// each pattern must match the complete field name. A backslash escapes wildcard characters.
    pub verbatim_fields: Vec<VerbatimField>,
    /// Fields whose single outer brace layer should be removed before reparsing.
    ///
    /// BibTeX data often wraps fields in double braces as a workaround for case handling. Listed
    /// fields have one outer group ignored when the complete field value is exactly one group.
    pub remove_outer_braces: Vec<String>,
    /// Explicit mode overrides for specific fields. These precede the default field-mode tables.
    pub field_mode: HashMap<String, String>,
    /// Language identifiers whose titles receive sentence casing; an empty list disables it.
    ///
    /// Bib(La)TeX treats English entries differently from other languages: English titles are
    /// conventionally title-cased and braced words carry case protection. This parser converts
    /// English-like titles to sentence case for consumers such as Zotero. If no language field is
    /// present, Bib(La)TeX assumes English; include the empty string in custom language lists to
    /// preserve that default. Sentence casing is heuristic and does not use natural-language
    /// processing, so results should be reviewed. The WASM adapter exposes the default language
    /// list as `english`; custom arrays replace it exactly.
    pub english: Vec<String>,
    /// Use the `language` field as a fallback when neither `langid` nor `hyphenation` is present.
    ///
    /// Some sources use `language` for this purpose despite the usual `langid` and `hyphenation`
    /// fields; enable this option to include that fallback.
    pub language_as_langid: bool,
    /// Controls for guessing and applying sentence case to titles.
    pub sentence_case: SentenceCaseOptions,
    /// Title case-protection policy: `off`, `as-needed`, or `strict`.
    ///
    /// In `as-needed` mode, mixed-case words inside root groups are inferred to need no-case
    /// protection. This avoids treating ordinary `\\textit{...}` emphasis as intentional case
    /// protection when authors may not expect the braces to affect title casing. `strict` preserves
    /// protection exactly as entered; `off` disables protection.
    pub case_protection: String,
    /// Merge adjacent equal markup spans separated only by whitespace (default true).
    pub collapse_markup: bool,
    #[serde(rename = "richURL")]
    pub rich_url: bool,
    /// Policy for rendering unknown TeX commands and environments.
    pub unsupported: Option<UnsupportedHandler>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
/// Sentence-case controls used while normalizing English title fields.
pub struct SentenceCaseOptions {
    /// Skip sentence casing when the parser guesses a title is already sentence-cased.
    ///
    /// Some English titles are already sentence-cased or all-uppercase. When this option is on,
    /// a title with enough sentence-case words that are not prepositions, acronyms, or ordinals is
    /// returned unchanged.
    pub guess: bool,
    /// Preserve capitalization after sentence-like separators such as colons.
    ///
    /// For `Structured Interviewing For OCB: Construct Validity, Faking, And The Effects Of
    /// Question Type`, `true` yields `Structured interviewing for OCB: Construct validity,
    /// faking, and the effects of question type`; `false` lowercases after the colon as well.
    pub sub_sentence: bool,
    /// Retain capitalization inside quoted portions of a title.
    ///
    /// When enabled, quoted titles are preserved as entered while other title text is
    /// sentence-cased.
    pub preserve_quoted: bool,
}

impl Default for SentenceCaseOptions {
    /// Enable guessing, colon-start capitalization, and quoted-text preservation by default.
    fn default() -> Self {
        Self {
            guess: true,
            sub_sentence: true,
            preserve_quoted: true,
        }
    }
}

impl Default for Options {
    /// Configure rendered, unlimited parsing with built-in English, field, and inheritance defaults.
    fn default() -> Self {
        Self {
            max_entries: None,
            strings: HashMap::new(),
            raw: false,
            apply_crossref: true,
            verbatim_fields: Vec::new(),
            remove_outer_braces: default_remove_outer_braces(),
            field_mode: HashMap::new(),
            english: default_english(),
            language_as_langid: false,
            sentence_case: SentenceCaseOptions::default(),
            case_protection: "as-needed".to_string(),
            collapse_markup: true,
            rich_url: true,
            unsupported: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// A creator parsed from a creator-list field such as `author` or `editor`.
pub struct Creator {
    /// An unparsed literal name, used when the input wraps a whole name in braces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Family name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    /// Given name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    /// Family-name prefix, such as `van`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// Name suffix, such as `Jr.`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    /// Initials supplied by an extended-name field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial: Option<String>,
    /// Extended-name `useprefix` property.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub useprefix: Option<bool>,
    /// Extended-name `juniorcomma` property.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub juniorcomma: Option<bool>,
    /// Unrecognized extended-name properties, retained as JSON values.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
/// Typed representation of a parsed field value.
pub enum FieldValue {
    /// Scalar text, including fields whose TeX markup is not yet rendered.
    Text(String),
    /// Parsed names from creator-list fields.
    Creators(Vec<Creator>),
    /// Elements from literal-list and keyword fields.
    List(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// An entry after reparsing its fields according to their assigned modes.
pub struct ParsedEntry {
    /// Original trimmed entry source.
    pub input: String,
    /// Lowercase entry type.
    #[serde(rename = "type")]
    pub entry: String,
    /// Citation key.
    pub key: String,
    /// Parsed field values.
    pub fields: HashMap<String, FieldValue>,
    /// Parser mode assigned to each field (for example, `title` or `creatorlist`).
    pub mode: HashMap<String, String>,
    /// Field inherited from a cross-referenced parent entry.
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    #[serde(default)]
    pub crossref: HashMap<String, CrossRefSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Results from [`parse`], including TeX rendering and field interpretation.
pub struct ParsedLibrary {
    /// Entries in source order.
    pub entries: Vec<ParsedEntry>,
    /// Resolved `@string` declarations.
    pub strings: HashMap<String, String>,
    /// Contents of `@comment` directives.
    pub comments: Vec<String>,
    /// Recoverable parsing errors.
    pub errors: Vec<ParseError>,
    /// Values from `@preamble` directives.
    pub preambles: Vec<String>,
    /// JabRef metadata extracted from `jabref-meta:` comments.
    #[serde(default)]
    pub jabref: JabRefMetadata,
}

struct Parser {
    chars: Vec<char>,
    pos: usize,
    parsing: String,
    library: Library,
    defaults: HashMap<String, String>,
    max_entries: usize,
}

impl Parser {
    /// Prepare parser state, merging predefined strings into the built-in lookup table.
    fn new(input: &str, options: Options) -> Self {
        let Options {
            max_entries,
            strings,
            ..
        } = options;
        let mut defaults = default_strings();
        defaults.extend(
            strings
                .into_iter()
                .map(|(key, value)| (key.to_uppercase(), value)),
        );
        Self {
            chars: input.chars().collect(),
            pos: 0,
            parsing: String::new(),
            library: Library::default(),
            defaults,
            max_entries: max_entries.unwrap_or(0),
        }
    }

    /// Copy a character range from the source buffer.
    fn text(&self, start: usize, end: usize) -> String {
        self.chars[start..end].iter().collect()
    }

    /// Return a short source excerpt for parser diagnostics.
    fn remaining(&self) -> String {
        self.text(
            self.pos.min(self.chars.len()),
            (self.pos + 20).min(self.chars.len()),
        )
    }

    /// Format the current source position with a 1-based line and UTF-16 column.
    fn location(&self) -> String {
        let before = self.text(0, self.pos.min(self.chars.len()));
        let line = before.chars().filter(|ch| *ch == '\n').count() + 1;
        let column = before
            .rsplit('\n')
            .next()
            .unwrap_or_default()
            .encode_utf16()
            .count()
            + 1;
        format!("line {line}, column {column}")
    }

    /// Add source position and directive context to a parser error.
    fn error(&self, message: impl AsRef<str>) -> String {
        let mut error = format!("{} at {}", message.as_ref(), self.location());
        if !self.parsing.is_empty() {
            // Add directive context only after the directive name has been read.
            error.push_str(&format!(" in {:?}", self.parsing));
        }
        error
    }

    /// Skip BibTeX whitespace and percent-to-end-of-line comments.
    fn skip_whitespace(&mut self) {
        while let Some(ch) = self.chars.get(self.pos).copied() {
            if matches!(ch, ' ' | '\t' | '\r' | '\n') {
                self.pos += 1;
            } else if ch == '%' {
                // A percent sign starts a comment only while parsing between tokens.
                while self.pos < self.chars.len() && self.chars[self.pos] != '\n' {
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
    }

    /// Consume a token after skipping inter-token whitespace.
    fn consume(&mut self, token: &str) -> bool {
        self.skip_whitespace();
        let token: Vec<char> = token.chars().collect();
        if self.chars.get(self.pos..self.pos + token.len()) == Some(token.as_slice()) {
            self.pos += token.len();
            true
        } else {
            false
        }
    }

    /// Consume a required token or return a location-aware mismatch error.
    fn expect(&mut self, token: &str) -> Result<(), String> {
        if self.consume(token) {
            Ok(())
        } else {
            Err(self.error(format!(
                "Token mismatch, expected {token:?}, found {:?}...",
                self.remaining()
            )))
        }
    }

    /// Check the next token without consuming it; entry parsing uses this for closing guards.
    fn next_is(&mut self, token: &str) -> bool {
        self.skip_whitespace();
        let token: Vec<char> = token.chars().collect();
        self.chars.get(self.pos..self.pos + token.len()) == Some(token.as_slice())
    }

    /// Read a BibTeX identifier containing letters, digits, or the permitted syntax characters.
    fn key(&mut self, allow: &str) -> Result<String, String> {
        let start = self.pos;
        loop {
            let Some(ch) = self.chars.get(self.pos).copied() else {
                return Err(self.error("Runaway key"));
            };
            if ch.is_alphabetic()
                || ch.is_ascii_digit()
                || matches!(
                    ch,
                    '+' | '\'' | '&' | ';' | '_' | ':' | '\\' | '.' | '/' | '-'
                )
                || allow.contains(ch)
            {
                self.pos += 1;
            } else {
                break;
            }
        }
        Ok(self.text(start, self.pos))
    }

    /// Read the entry delimiter and return its matching closing character.
    fn guard(&mut self) -> Result<char, String> {
        // BibTeX permits either brace or parenthesis entry delimiters.
        if self.consume("{") {
            self.skip_whitespace();
            Ok('}')
        } else if self.consume("(") {
            self.skip_whitespace();
            Ok(')')
        } else {
            Err(self.error(format!(
                "Token mismatch, expected '{{' or '(', found {:?}...",
                self.remaining()
            )))
        }
    }

    /// Read a balanced braced value, respecting escaped braces and paired math delimiters.
    fn braced(&mut self) -> Result<String, String> {
        self.expect("{")?;
        let start = self.pos;
        let mut depth = 0usize;
        let mut math = false;
        while self.pos < self.chars.len() {
            // Literal commands must bypass both brace balancing and math-delimiter tracking.
            if let Some(range) = tex::verbatim_range(&self.chars, self.pos) {
                self.pos = range.end + 1;
                continue;
            }
            match self.chars[self.pos] {
                // Skip the escaped character so it cannot affect brace or math depth.
                '\\' => self.pos += 1,
                '{' => depth += 1,
                '}' if depth == 0 => {
                    let value = self.text(start, self.pos);
                    self.pos += 1;
                    return if math {
                        Err(self.error("Unclosed math section"))
                    } else {
                        Ok(value)
                    };
                }
                '}' => depth -= 1,
                // Track math independently of brace depth; an outer close rejects unmatched dollars.
                '$' => math = !math,
                _ => {}
            }
            self.pos += 1;
        }
        Err(self.error(format!(
            "Unterminated brace-value {:?}",
            self.text(start, (start + 20).min(self.chars.len()))
        )))
    }

    /// Read a quoted value; quotes inside braces do not terminate the value.
    fn quoted(&mut self) -> Result<String, String> {
        self.expect("\"")?;
        let start = self.pos;
        let mut depth = 0isize;
        while self.pos < self.chars.len() {
            // A quote inside a literal command is content, even outside a braced group.
            if let Some(range) = tex::verbatim_range(&self.chars, self.pos) {
                self.pos = range.end + 1;
                continue;
            }
            match self.chars[self.pos] {
                // Escaped quotes and braces are content, not syntax delimiters.
                '\\' => self.pos += 1,
                '{' => depth += 1,
                '}' => depth -= 1,
                '"' if depth <= 0 => {
                    let value = self.text(start, self.pos);
                    self.pos += 1;
                    return Ok(value);
                }
                _ => {}
            }
            self.pos += 1;
        }
        Err(self.error(format!(
            "Unterminated quote-value {:?}",
            self.text(start, (start + 20).min(self.chars.len()))
        )))
    }

    /// Read a braced, quoted, numeric, or string-referenced value and resolve `#` concatenation.
    /// Unresolved references retain protected source text and emit one diagnostic per name.
    fn value(&mut self) -> Result<String, String> {
        // Braced and quoted values retain their contents; bare integers are literals and other bare
        // identifiers resolve through the declared or predefined string tables.
        let mut result = if self.consume("{") {
            self.pos -= 1;
            self.braced()?
        } else if self.consume("\"") {
            self.pos -= 1;
            self.quoted()?
        } else {
            let bare = self.key("")?;
            if !bare.is_empty() && bare.chars().all(|ch| ch.is_ascii_digit()) {
                bare
            } else {
                let upper = bare.to_uppercase();
                // Nonempty user declarations take precedence over built-in abbreviations.
                if let Some(value) = self
                    .library
                    .strings
                    .get(&upper)
                    .filter(|value| !value.is_empty())
                    .or_else(|| self.defaults.get(&upper))
                    .filter(|value| !value.is_empty())
                {
                    value.clone()
                } else {
                    // Preserve unresolved names in braces and record one error per distinct name.
                    let message = format!("unresolved @string reference {bare:?}");
                    if !self
                        .library
                        .errors
                        .iter()
                        .any(|error| error.error == message)
                    {
                        self.library.errors.push(ParseError {
                            error: message,
                            input: String::new(),
                        });
                    }
                    format!("{{{{{bare}}}}}")
                }
            }
        };
        while self.consume("#") {
            result.push_str(&self.value()?);
        }
        Ok(result)
    }

    /// Parse one key/value pair, storing string declarations separately from entry fields.
    fn field(&mut self, key: Option<String>) -> Result<(), String> {
        let key = match key {
            Some(key) => key,
            None => self.key("")?,
        };
        if key.is_empty() {
            // A stray comma has no key/value pair and is tolerated for exporter compatibility.
            return Ok(());
        }
        if !self.consume("=") {
            return Err(self.error(format!(
                "{key} = value expected, equals sign missing: {:?}...",
                self.remaining()
            )));
        }
        let value = self.value()?;
        // @string values extend the lookup table; entry-field values attach to the current record.
        if self.parsing == "string" {
            let key = key.to_uppercase();
            self.library.strings.insert(key, value);
        } else if let Some(entry) = self.library.entries.last_mut() {
            // Preserve duplicate fields by appending an incrementing duplicate suffix.
            let base = key.to_lowercase();
            let mut name = base.clone();
            let mut duplicate = 0;
            while entry.fields.contains_key(&name) {
                duplicate += 1;
                name = format!("{base}+duplicate-{duplicate}");
            }
            entry.fields.insert(name, value);
        }
        Ok(())
    }

    /// Parse an entry body, including keyless records and trailing commas used by some exporters.
    fn entry(&mut self, end: char) -> Result<(), String> {
        if self.next_is(&end.to_string()) {
            return Ok(());
        }
        // A leading comma represents a keyless entry; an equals sign instead marks a keyless field.
        let key = if self.consume(",") {
            String::new()
        } else {
            self.key("[]*\"")?
        };
        if self.next_is("=") {
            self.field(Some(key))?;
        } else if let Some(entry) = self.library.entries.last_mut() {
            entry.key = key;
        }
        self.consume(",");
        if self.next_is(&end.to_string()) {
            return Ok(());
        }
        self.field(None)?;
        // Accept a comma immediately before the closing guard.
        while self.consume(",") {
            if self.next_is(&end.to_string()) {
                return Ok(());
            }
            self.field(None)?;
        }
        Ok(())
    }

    /// Read either a braced comment or the unbraced comment text through end of line.
    fn comment(&mut self) -> Result<(), String> {
        while matches!(self.chars.get(self.pos), Some(' ' | '\t')) {
            self.pos += 1;
        }
        // Braced comments use balanced values; unbraced comments end at the newline.
        if self.chars.get(self.pos) == Some(&'{') {
            let comment = self.braced()?;
            self.library.comments.push(comment);
        } else {
            let start = self.pos;
            while self.pos < self.chars.len() && self.chars[self.pos] != '\n' {
                self.pos += 1;
            }
            self.library.comments.push(self.text(start, self.pos));
        }
        Ok(())
    }

    /// Find and parse the next directive, recovering at the next `@` after malformed input.
    fn parse_next(&mut self) {
        self.skip_whitespace();
        while self.pos < self.chars.len() && self.chars[self.pos] != '@' {
            if self.chars[self.pos] == '%' {
                while self.pos < self.chars.len() && self.chars[self.pos] != '\n' {
                    self.pos += 1;
                }
            } else {
                self.pos += 1;
            }
        }
        if self.pos == self.chars.len() {
            // Ignore trailing source text that contains no further directive.
            return;
        }
        let start = self.pos;
        let result = (|| {
            self.expect("@")?;
            self.skip_whitespace();
            self.parsing = self.key("")?.to_lowercase();
            // Comments have a different body grammar and do not create an entry record.
            if self.parsing == "comment" {
                return self.comment();
            }
            // Preambles contain values and do not have an entry key.
            if self.parsing == "preamble" {
                let preamble = self.value()?;
                self.library.preambles.push(preamble);
                return Ok(());
            }
            let end = self.guard()?;
            if self.parsing == "string" {
                self.field(None)?;
                return self.expect(&end.to_string());
            }
            self.library.entries.push(Entry {
                input: String::new(),
                entry: self.parsing.clone(),
                key: String::new(),
                fields: HashMap::new(),
            });
            self.entry(end)?;
            self.expect(&end.to_string())?;
            self.skip_whitespace();
            let input = self.text(start, self.pos).trim().to_string();
            if let Some(entry) = self.library.entries.last_mut() {
                entry.input = input;
            }
            Ok(())
        })();
        if let Err(error) = result {
            // Recovery is deliberately lexical, not brace-aware: even an unclosed value must
            // allow a later directive to be found. Any partially inserted entry is retained.
            // Resume at the next directive marker so a bad entry does not discard later records.
            self.pos = start + 1;
            while self.pos < self.chars.len() && self.chars[self.pos] != '@' {
                self.pos += 1;
            }
            if !self.library.errors.iter().any(|known| known.error == error) {
                self.library.errors.push(ParseError {
                    error,
                    input: self.text(start, self.pos),
                });
            }
        }
    }

    /// Parse directives until input ends or the requested entry limit is reached.
    fn parse(self) -> Library {
        futures_util::FutureExt::now_or_never(self.parse_with_yield(|| std::future::ready(())))
            .expect("synchronous parsing does not suspend")
    }

    /// Share directive parsing between sync and async callers without yielding inside a value.
    /// The interval counts parse attempts, including comments and failures, rather than entries.
    async fn parse_with_yield<F, Fut>(mut self, mut yield_now: F) -> Library
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let mut iterations = 0;
        while self.pos < self.chars.len()
            && (self.max_entries == 0 || self.library.entries.len() < self.max_entries)
        {
            let previous = self.pos;
            self.parse_next();
            iterations += 1;
            if iterations % 1000 == 0 {
                yield_now().await;
            }
            // Guard against a parser branch that reports success without advancing the cursor.
            if previous == self.pos {
                break;
            }
        }
        let (comments, jabref) = parse_jabref_metadata(self.library.comments.clone());
        self.library.comments = comments;
        self.library.jabref = jabref;
        self.library
    }
}

/// Return BibTeX's built-in month and journal abbreviations.
fn default_strings() -> HashMap<String, String> {
    [
        ("JAN", "01"),
        ("JANUARY", "01"),
        ("FEB", "02"),
        ("FEBRUARY", "02"),
        ("MAR", "03"),
        ("MARCH", "03"),
        ("APR", "04"),
        ("APRIL", "04"),
        ("MAY", "05"),
        ("JUN", "06"),
        ("JUNE", "06"),
        ("JUL", "07"),
        ("JULY", "07"),
        ("AUG", "08"),
        ("AUGUST", "08"),
        ("SEP", "09"),
        ("SEPTEMBER", "09"),
        ("OCT", "10"),
        ("OCTOBER", "10"),
        ("NOV", "11"),
        ("NOVEMBER", "11"),
        ("DEC", "12"),
        ("DECEMBER", "12"),
        ("ACMCS", "ACM Computing Surveys"),
        ("ACTA", "Acta Informatica"),
        ("CACM", "Communications of the ACM"),
        ("IBMJRD", "IBM Journal of Research and Development"),
        ("IBMSJ", "IBM Systems Journal"),
        ("IEEESE", "IEEE Transactions on Software Engineering"),
        ("IEEETC", "IEEE Transactions on Computers"),
        (
            "IEEETCAD",
            "IEEE Transactions on Computer-Aided Design of Integrated Circuits",
        ),
        ("IPL", "Information Processing Letters"),
        ("JACM", "Journal of the ACM"),
        ("JCSS", "Journal of Computer and System Sciences"),
        ("SCP", "Science of Computer Programming"),
        ("SICOMP", "SIAM Journal on Computing"),
        ("TOCS", "ACM Transactions on Computer Systems"),
        ("TODS", "ACM Transactions on Database Systems"),
        ("TOG", "ACM Transactions on Graphics"),
        ("TOMS", "ACM Transactions on Mathematical Software"),
        ("TOOIS", "ACM Transactions on Office Information Systems"),
        (
            "TOPLAS",
            "ACM Transactions on Programming Languages and Systems",
        ),
        ("TCS", "Theoretical Computer Science"),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_string(), value.to_string()))
    .collect()
}

/// Return the language identifiers treated as English by default.
fn default_english() -> Vec<String> {
    serde_json::from_str(include_str!("../data/english.json"))
        .expect("default English language list must be valid JSON")
}

/// Return the fields whose single outer brace group is removed during normalization.
fn default_remove_outer_braces() -> Vec<String> {
    [
        "doi",
        "title",
        "subtitle",
        "series",
        "shorttitle",
        "booktitle",
        "origtitle",
        "maintitle",
        "eventtitle",
        "eprint",
        "file",
        "files",
        "pdf",
        "groups",
        "ids",
        "url",
        "verba",
        "verbb",
        "verbc",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

const CREATOR_FIELDS: &[&str] = &[
    "author",
    "bookauthor",
    "collaborator",
    "commentator",
    "director",
    "editor",
    "editora",
    "editorb",
    "editors",
    "holder",
    "scriptwriter",
    "translator",
];

const TITLE_FIELDS: &[&str] = &[
    "title",
    "subtitle",
    "series",
    "shorttitle",
    "booktitle",
    "origtitle",
    "maintitle",
    "eventtitle",
];

// JabRef's `groups` field is nonstandard and must stay literal like the other verbatim fields.
const VERBATIM_FIELDS: &[&str] = &[
    "doi", "eprint", "file", "files", "pdf", "groups", "ids", "url", "verba", "verbb", "verbc",
];

const RICHTEXT_FIELDS: &[&str] = &["annotation", "comment", "annote", "review", "notes", "note"];

const LIST_FIELDS: &[&str] = &[
    "institution",
    "publisher",
    "origpublisher",
    "organization",
    "location",
    "origlocation",
];

/// Split a value only where the separator is outside braces and is not escaped.
fn split_top_level(input: &str, separator: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut part = String::new();
    let mut depth = 0usize;
    let mut escaped = false;
    for ch in input.chars() {
        if escaped {
            // Escaped separators and braces are literal content.
            part.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        // Separators split only after the current group has closed.
        if ch == separator && depth == 0 {
            parts.push(part.trim().to_string());
            part.clear();
        } else {
            part.push(ch);
        }
    }
    parts.push(part.trim().to_string());
    parts
}

/// Split a creator list on top-level, whitespace-delimited `and` tokens.
fn split_creators(input: &str) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    let mut result = Vec::new();
    let mut start = 0;
    let mut depth = 0usize;
    let mut escaped = false;
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        if escaped {
            escaped = false;
            index += 1;
            continue;
        }
        if ch == '\\' {
            escaped = true;
        } else if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth = depth.saturating_sub(1);
        } else if depth == 0 && index + 3 <= chars.len() {
            let token: String = chars[index..index + 3].iter().collect();
            // Do not split inside a group or on a substring such as `Anderson`.
            // Require `and` to be a complete token at the current top-level depth.
            if token.eq_ignore_ascii_case("and")
                && index > 0
                && chars[index - 1].is_ascii_whitespace()
                && index + 3 < chars.len()
                && chars[index + 3].is_ascii_whitespace()
            {
                result.push(
                    chars[start..index]
                        .iter()
                        .collect::<String>()
                        .trim()
                        .to_string(),
                );
                index += 3;
                while index < chars.len() && chars[index].is_ascii_whitespace() {
                    index += 1;
                }
                start = index;
                continue;
            }
        }
        index += 1;
    }
    result.push(chars[start..].iter().collect::<String>().trim().to_string());
    result.into_iter().filter(|name| !name.is_empty()).collect()
}

/// Split first-last creator names on whitespace outside TeX groups.
fn split_creator_words(input: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let (mut depth, mut escaped) = (0usize, false);
    for character in input.chars() {
        if escaped {
            word.push(character);
            escaped = false;
        } else if character == '\\' {
            word.push(character);
            escaped = true;
        } else if character == '{' {
            depth += 1;
            word.push(character);
        } else if character == '}' {
            depth = depth.saturating_sub(1);
            word.push(character);
        } else if character.is_ascii_whitespace() && depth == 0 {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
        } else {
            word.push(character);
        }
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

/// Remove one complete outer name group while leaving partial or nested source intact.
fn clean_name_part(value: &str) -> String {
    let value = value.trim();
    if value.starts_with('{') && value.ends_with('}') && value.len() >= 2 {
        value[1..value.len() - 1].trim().to_string()
    } else {
        value.to_string()
    }
}

/// Parse one creator using the extended-name, comma-separated, or first-last convention.
fn parse_creator(
    input: &str,
    entry_key: &str,
    macro_definitions: &mut HashMap<String, Vec<tex::Node>>,
    diagnostics: &mut tex::RenderDiagnostics,
) -> Creator {
    // A fully braced name is an indivisible literal rather than a family/given name pair.
    let unwrapped = remove_outer_braces(input);
    if unwrapped != input {
        return Creator {
            name: Some(
                tex::render_with_case_protection_and_macro_definitions(
                    &unwrapped,
                    "creatorlist",
                    diagnostics,
                    tex::CaseProtection::Off,
                    macro_definitions,
                )
                .trim()
                .to_string(),
            ),
            ..Creator::default()
        };
    }
    let raw_input = input.trim();
    let input = tex::render_with_case_protection_and_macro_definitions(
        raw_input,
        "creatorlist",
        diagnostics,
        tex::CaseProtection::Off,
        macro_definitions,
    )
    .trim()
    .to_string();
    let mut parts = split_top_level(&input, ',');
    if parts.len() == 3 && parts[2].is_empty() {
        // Ignore the trailing empty part before applying BibTeX comma-name rules.
        parts.pop();
    }
    // Treat comma-separated parts as extended properties only when every part has a valid key=value signature.
    let extended = parts.len() > 1
        && parts.iter().all(|part| {
            part.split_once('=')
                .is_some_and(|(key, _)| is_extended_creator_key(key.trim()))
        });
    if extended {
        let mut creator = Creator::default();
        for part in parts {
            let Some((key, value)) = part.split_once('=') else {
                continue;
            };
            let key = key.trim().to_ascii_lowercase();
            let value = clean_name_part(value);
            match key.as_str() {
                "given" if !value.is_empty() => creator.first_name = Some(value),
                "family" if !value.is_empty() => creator.last_name = Some(value),
                "given-i" if !value.is_empty() => creator.initial = Some(value),
                "useprefix" => creator.useprefix = Some(value.eq_ignore_ascii_case("true")),
                "juniorcomma" => creator.juniorcomma = Some(value.eq_ignore_ascii_case("true")),
                // Keep nonempty extension properties instead of discarding unknown keys.
                _ if !value.is_empty() => {
                    creator.extra.insert(key, serde_json::Value::String(value));
                }
                _ => {}
            }
        }
        return creator;
    }

    // BibTeX comma form is `family, suffix, given`; without commas names use first-last rules.
    // More than three comma parts are diagnosed and discarded, retaining only these first fields.
    if parts.len() > 1 {
        if parts.len() > 3 {
            let joined = parts.join(", ");
            let key_prefix = if entry_key.is_empty() {
                String::new()
            } else {
                format!("@{entry_key}: ")
            };
            diagnostics.errors.push(ParseError {
                error: format!(
                    "{key_prefix}unexpected {}-part name \"{joined}\", dropping \"{}\"",
                    parts.len(),
                    parts[3..].join(", ")
                ),
                input: joined,
            });
        }
        let (last_name, suffix, first_name) = match parts.as_slice() {
            [last, first] => (last.as_str(), None, Some(first.as_str())),
            [last, suffix, first, ..] => {
                (last.as_str(), Some(suffix.as_str()), Some(first.as_str()))
            }
            [last] => (last.as_str(), None, None),
            [] => ("", None, None),
        };
        let last_name = clean_name_part(last_name);
        let mut creator = Creator {
            last_name: (!last_name.is_empty()).then_some(last_name.clone()),
            first_name: first_name
                .map(clean_name_part)
                .filter(|name| !name.is_empty()),
            suffix: suffix.map(clean_name_part).filter(|name| !name.is_empty()),
            ..Creator::default()
        };
        // A lowercase particle sequence in the family slot becomes the prefix; the final token is the surname.
        if let Some((split, _)) = last_name.char_indices().rev().find(|(index, ch)| {
            *ch == ' '
                && *index > 0
                && *index + ch.len_utf8() < last_name.len()
                && last_name[..*index]
                    .chars()
                    .all(|prefix| prefix.is_ascii_lowercase() || matches!(prefix, '.' | '\'' | ' '))
        }) {
            creator.prefix = Some(last_name[..split].to_string());
            creator.last_name = Some(last_name[split + 1..].to_string());
        }
        return creator;
    }

    let words: Vec<String> = split_creator_words(raw_input)
        .iter()
        .map(|word| {
            tex::render_with_case_protection_and_macro_definitions(
                word,
                "creatorlist",
                diagnostics,
                tex::CaseProtection::Off,
                macro_definitions,
            )
            .trim()
            .to_string()
        })
        .filter(|word| !word.is_empty())
        .map(|word| clean_name_part(&word))
        .collect();
    if words.len() <= 1 {
        return Creator {
            last_name: words.first().cloned(),
            ..Creator::default()
        };
    }
    let prefix_index = words.iter().position(|word| {
        word.chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_lowercase())
    });
    // Lowercase particles mark the prefix; all-uppercase names use the final token as family name.
    match prefix_index {
        None => Creator {
            first_name: Some(words[..words.len() - 1].join(" ")),
            last_name: words.last().cloned(),
            ..Creator::default()
        },
        Some(0) => Creator {
            first_name: Some(words[..words.len() - 1].join(" ")),
            last_name: words.last().cloned(),
            ..Creator::default()
        },
        Some(index) => {
            let postfix = words
                .iter()
                .enumerate()
                .skip(index + 1)
                .find(|(_, word)| {
                    word.chars()
                        .next()
                        .is_some_and(|ch| !ch.is_ascii_lowercase())
                })
                .map(|(i, _)| i);
            if let Some(postfix) = postfix {
                Creator {
                    first_name: Some(words[..index].join(" ")),
                    prefix: Some(words[index..postfix].join(" ")),
                    last_name: Some(words[postfix..].join(" ")),
                    ..Creator::default()
                }
            } else {
                Creator {
                    first_name: Some(words[..words.len() - 1].join(" ")),
                    last_name: words.last().cloned(),
                    ..Creator::default()
                }
            }
        }
    }
}

/// Accept ASCII alphabetic extended-name keys with at most one nonempty hyphenated suffix.
fn is_extended_creator_key(key: &str) -> bool {
    let is_letters = |segment: &str| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|character| character.is_ascii_alphabetic())
    };
    match key.split_once('-') {
        Some((prefix, suffix)) => is_letters(prefix) && is_letters(suffix) && !suffix.contains('-'),
        None => is_letters(key),
    }
}

/// Parse creator parts without TeX rendering or outer-brace cleanup.
///
/// A two-part comma form is interpreted as family/given name unless every part is an extended
/// `key=value` property. A two-word unseparated form is interpreted as given/family; other forms
/// remain a single literal name.
fn parse_raw_creator(input: &str) -> Creator {
    let parts = split_top_level(input, ',');
    let extended = parts.len() > 1
        && parts.iter().all(|part| {
            part.split_once('=')
                .is_some_and(|(key, _)| is_extended_creator_key(key.trim()))
        });
    if parts.len() == 2 && !extended {
        return Creator {
            last_name: Some(parts[0].clone()),
            first_name: Some(parts[1].clone()),
            ..Creator::default()
        };
    }
    if parts.len() == 1 {
        let words: Vec<_> = input.split_ascii_whitespace().collect();
        if words.len() == 2 {
            return Creator {
                last_name: Some(words[1].to_string()),
                first_name: Some(words[0].to_string()),
                ..Creator::default()
            };
        }
    }
    Creator {
        name: Some(input.trim().to_string()),
        ..Creator::default()
    }
}

/// Choose a field parser mode by applying explicit overrides before built-in defaults.
///
/// A matching `verbatimFields` entry wins immediately. Otherwise an explicit `fieldMode` disables
/// ordinary default lists, even when its value is unrecognized and leaves the mode as `literal`.
/// Built-in keyword and numbered export-field patterns still force `verbatim`, overriding
/// configured modes. Without an override, the last matching default list wins.
fn field_mode(field: &str, options: &Options) -> String {
    if options
        .verbatim_fields
        .iter()
        .any(|candidate| match candidate {
            VerbatimField::Name(source) | VerbatimField::Pattern { source } => {
                wildflower::Pattern::new(source.to_lowercase()).matches(field)
            }
        })
    {
        return "verbatim".to_string();
    }

    let configured = options.field_mode.get(field);
    let has_override = configured.is_some();
    let mut mode = "literal";
    for (candidate, matches_default) in [
        (
            "creatorlist",
            !has_override && CREATOR_FIELDS.contains(&field),
        ),
        ("title", !has_override && TITLE_FIELDS.contains(&field)),
        (
            "verbatim",
            !has_override && VERBATIM_FIELDS.contains(&field),
        ),
        (
            "richtext",
            !has_override && RICHTEXT_FIELDS.contains(&field),
        ),
        ("literallist", !has_override && LIST_FIELDS.contains(&field)),
    ] {
        if configured.is_some_and(|configured| configured == candidate) || matches_default {
            mode = candidate;
        }
        let matches_verbatim_pattern = (field == "keywords"
            || field
                .strip_prefix("keywords+duplicate-")
                .is_some_and(|suffix| {
                    !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit())
                }))
            || ["citeulike-linkout-", "bdsk-url-"].iter().any(|prefix| {
                field.strip_prefix(prefix).is_some_and(|suffix| {
                    !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit())
                })
            });
        if matches_verbatim_pattern {
            mode = "verbatim";
        }
    }
    mode.to_string()
}

/// Remove a single outer brace layer from fields listed in `removeOuterBraces`.
///
/// The value must consist of one balanced outer group; repeated braces and braces within the value
/// remain intact unless they are the direct wrapper around the complete field.
fn remove_outer_braces(value: &str) -> String {
    if !value.starts_with('{') || !value.ends_with('}') || value.len() < 2 {
        return value.to_string();
    }
    let inner = &value[1..value.len() - 1];
    let mut depth = 0usize;
    let mut escaped = false;
    for ch in inner.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '{' => depth += 1,
            '}' if depth == 0 => return value.to_string(),
            '}' => depth -= 1,
            _ => {}
        }
    }
    if depth == 0 {
        inner.to_string()
    } else {
        value.to_string()
    }
}

/// Honor a custom brace-removal list; otherwise derive title/verbatim fields from effective modes.
/// Explicitly supplying the unchanged default list is indistinguishable from omitting the option.
fn remove_outer_braces_fields(options: &Options) -> Vec<String> {
    if options.remove_outer_braces != default_remove_outer_braces() {
        return options.remove_outer_braces.clone();
    }
    let mut fields = vec!["doi".to_string()];
    fields.extend(
        CREATOR_FIELDS
            .iter()
            .chain(TITLE_FIELDS)
            .chain(VERBATIM_FIELDS)
            .chain(RICHTEXT_FIELDS)
            .chain(LIST_FIELDS)
            .map(|field| (*field).to_string()),
    );
    fields.extend(options.field_mode.keys().cloned());
    fields.retain(|field| matches!(field_mode(field, options).as_str(), "title" | "verbatim"));
    fields.sort();
    fields.dedup();
    fields
}

/// Render an `@string` value unless raw mode is active, sharing new macros with subsequent fields.
fn render_string_value(
    value: &str,
    macro_definitions: &mut HashMap<String, Vec<tex::Node>>,
    options: &Options,
    diagnostics: &mut tex::RenderDiagnostics,
) -> String {
    // Render string values as TeX and share macro definitions with later entries; raw mode keeps
    // the parsed source without invoking the renderer.
    if options.raw {
        return value.to_string();
    }
    tex::render_with_case_protection_and_macro_definitions(
        value,
        "literal",
        diagnostics,
        tex::CaseProtection::default(),
        macro_definitions,
    )
}

/// Apply type remappings and allowed parent fields through the cross-reference graph.
///
/// Parents are processed before descendants even when the input lists a parent after its child;
/// shared parents are processed once. Type-specific field remappings run before the allowed-field
/// pass, and `noCrossRef` fields are excluded from ordinary inheritance.
fn apply_crossref_inheritance(entries: &mut [ParsedEntry], enabled: bool) {
    if !enabled {
        return;
    }
    let keys: HashMap<String, usize> = entries
        .iter()
        .enumerate()
        .filter_map(|(idx, entry)| {
            if entry.key.is_empty() {
                None
            } else {
                Some((entry.key.to_uppercase(), idx))
            }
        })
        .collect();

    // Topological ordering: ancestors are unshifted and children appended, so chains inherit
    // complete ancestor data before descendants are visited.
    let mut order = Vec::new();
    for entry in entries.iter() {
        let Some(parent_key) = entry.fields.get("crossref").and_then(|field| match field {
            FieldValue::Text(value) => Some(value.to_uppercase()),
            _ => None,
        }) else {
            continue;
        };
        if !keys.contains_key(&parent_key) {
            continue;
        }
        let child_key = entry.key.to_uppercase();
        if !order.contains(&parent_key) {
            order.insert(0, parent_key);
        }
        if !order.contains(&child_key) {
            order.push(child_key);
        }
    }

    let allowed = cross_reference_data();
    let mappings = cross_reference_map();
    for key in order {
        let Some(&child_index) = keys.get(&key) else {
            continue;
        };
        let parent_key =
            entries[child_index]
                .fields
                .get("crossref")
                .and_then(|field| match field {
                    FieldValue::Text(value) => Some(value.to_uppercase()),
                    _ => None,
                });
        let Some(parent_key) = parent_key else {
            continue;
        };
        let Some(&parent_index) = keys.get(&parent_key) else {
            continue;
        };
        let child_type = entries[child_index].entry.clone();
        let parent_type = entries[parent_index].entry.clone();

        // Specific child/parent mappings run before wildcard mappings. Inheritance fills only
        // falsey destinations, so the first meaningful value wins over later defaults.
        for child_mapping in [mappings.get(&child_type), mappings.get("*")]
            .into_iter()
            .flatten()
        {
            for field_mapping in [child_mapping.get(&parent_type), child_mapping.get("*")]
                .into_iter()
                .flatten()
            {
                for (child_field, parent_field) in field_mapping {
                    inherit_crossref_field(
                        entries,
                        child_index,
                        parent_index,
                        child_field,
                        parent_field,
                    );
                }
            }
            for field in allowed.allowed.get(&child_type).into_iter().flatten() {
                // Exclusions apply to ordinary same-name inheritance, not explicit remappings above.
                if allowed.no_cross_ref.contains(field) {
                    continue;
                }
                inherit_crossref_field(entries, child_index, parent_index, field, field);
            }
        }
    }
}

/// Fill a missing or falsey child field from a truthy parent value and record its provenance.
/// Existing meaningful child values, including empty list objects, must never be overwritten.
fn inherit_crossref_field(
    entries: &mut [ParsedEntry],
    child_index: usize,
    parent_index: usize,
    child_field: &str,
    parent_field: &str,
) {
    let Some(parent_value) = entries[parent_index].fields.get(parent_field).cloned() else {
        return;
    };
    if !field_value_is_truthy(&parent_value)
        || entries[child_index]
            .fields
            .get(child_field)
            .is_some_and(field_value_is_truthy)
    {
        return;
    }
    entries[child_index]
        .fields
        .insert(child_field.to_string(), parent_value);
    entries[child_index].crossref.insert(
        child_field.to_string(),
        CrossRefSource {
            parent: entries[parent_index].key.clone(),
            field: parent_field.to_string(),
        },
    );
}

/// Convert verbatim entries to typed field values and assign each field's parsing mode.
pub fn reparse(verbatim: Library) -> ParsedLibrary {
    reparse_with_options(verbatim, &Options::default())
}

/// Reparse with field-mode overrides and brace removal applied before values become typed data.
///
/// Errors from raw parsing remain in source order; diagnostics for unsupported TeX constructs are
/// appended during rendering.
pub fn reparse_with_options(verbatim: Library, options: &Options) -> ParsedLibrary {
    futures_util::FutureExt::now_or_never(reparse_with_yield(verbatim, options, || {
        std::future::ready(())
    }))
    .expect("synchronous reparsing does not suspend")
}

/// Normalize fields before cross-reference inheritance, then append shared render diagnostics.
/// Unlike directive scanning, cooperative yields here count completed entries; a single field
/// is always rendered atomically. Synchronous callers supply an immediately ready yield future.
async fn reparse_with_yield<F, Fut>(
    verbatim: Library,
    options: &Options,
    mut yield_now: F,
) -> ParsedLibrary
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let mut render_diagnostics = tex::RenderDiagnostics::default();
    render_diagnostics.unsupported = options.unsupported;
    render_diagnostics.plain_urls = !options.rich_url;
    let preambles = verbatim.preambles.clone();
    let mut macro_definitions = HashMap::new();
    if !options.raw {
        // Process preambles first so their macro definitions are available to later strings.
        for preamble in &preambles {
            let _ = tex::render_with_case_protection_and_macro_definitions(
                preamble,
                "literal",
                &mut render_diagnostics,
                tex::CaseProtection::Off,
                &mut macro_definitions,
            );
        }
    }
    let mut strings = verbatim.strings;
    for value in strings.values_mut() {
        *value = render_string_value(
            value,
            &mut macro_definitions,
            options,
            &mut render_diagnostics,
        );
    }
    let remove_brace_fields = remove_outer_braces_fields(options);
    let mut entries = Vec::with_capacity(verbatim.entries.len());
    for (index, entry) in verbatim.entries.into_iter().enumerate() {
        // Prefer a nonempty `langid`, then `hyphenation`; `language` is consulted only when enabled.
        let mut langid = entry
            .fields
            .get("langid")
            .filter(|value| !value.is_empty())
            .or_else(|| entry.fields.get("hyphenation"))
            .map(|value| value.to_lowercase())
            .unwrap_or_default();
        if langid.is_empty() && options.language_as_langid {
            langid = entry
                .fields
                .get("language")
                .map(|value| value.to_lowercase())
                .unwrap_or_default();
        }
        // Language selection gates title casing only; every language still receives TeX rendering.
        let english = options
            .english
            .iter()
            .any(|language| language.to_lowercase() == langid);
        let mut fields = HashMap::new();
        let mut mode = HashMap::new();
        let mut keywords = Vec::new();
        for (field, value) in entry.fields {
            if value.trim().is_empty() {
                continue;
            }
            // Merge duplicate keyword fields into one vector without sorting or removing repeats.
            if field == "keywords" || field.starts_with("keywords+duplicate-") {
                let value = tex::print_raw(&value);
                keywords.extend(
                    value
                        .split([',', ';'])
                        .map(str::trim)
                        .filter(|keyword| !keyword.is_empty())
                        .map(str::to_string),
                );
                continue;
            }
            let current_mode = field_mode(&field, options);
            mode.insert(field.clone(), current_mode.clone());
            let mut value = value;
            // `removeOuterBraces` removes one root Group only when it is the entire field value.
            if remove_brace_fields.contains(&field) {
                value = remove_outer_braces(&value);
            }
            if !options.raw && matches!(field.as_str(), "year" | "month") {
                if let Some(integer) = parse_integer_string(&value) {
                    value = integer;
                } else if field == "month" {
                    value = normalize_month(&value);
                }
            }
            if current_mode == "verbatim" {
                // Normalize parsed whitespace while preserving TeX commands and literal content.
                fields.insert(field, FieldValue::Text(tex::print_raw(&value)));
                continue;
            }
            if options.raw {
                // Raw mode still parses typed creators/lists, but otherwise returns printed TeX.
                if current_mode == "creatorlist" {
                    let names: Vec<_> = split_creators(&value)
                        .iter()
                        .map(|name| parse_raw_creator(name))
                        .collect();
                    fields.insert(field, FieldValue::Creators(names));
                } else if current_mode == "literallist" {
                    let items: Vec<_> = split_creators(&value)
                        .iter()
                        .map(|element| element.to_string())
                        .collect();
                    fields.insert(field, FieldValue::List(items));
                } else {
                    fields.insert(field, FieldValue::Text(value));
                }
                continue;
            }
            // Literal lists split the AST before stringifying each element, so braced `and`
            // remains content rather than becoming a separator.
            if current_mode == "literallist" {
                let items = split_creators(&value)
                    .iter()
                    .map(|element| {
                        tex::render_with_case_protection_and_macro_definitions(
                            element,
                            "literal",
                            &mut render_diagnostics,
                            tex::CaseProtection::Off,
                            &mut macro_definitions,
                        )
                        .trim()
                        .to_string()
                    })
                    .collect();
                fields.insert(field, FieldValue::List(items));
                continue;
            }
            if current_mode != "verbatim" && current_mode != "creatorlist" {
                // Unknown policy strings retain the default as-needed behavior.
                let case_protection = match options.case_protection.as_str() {
                    "off" => tex::CaseProtection::Off,
                    "strict" => tex::CaseProtection::Strict,
                    _ => tex::CaseProtection::AsNeeded,
                };
                let protect_title = current_mode == "title" && english;
                // Pass 0 marks root groups and inline math before the sentence-case pass.
                render_diagnostics.mark_case_groups = protect_title;
                value = tex::render_with_case_protection_and_macro_definitions(
                    &value,
                    &current_mode,
                    &mut render_diagnostics,
                    if protect_title {
                        case_protection
                    } else {
                        tex::CaseProtection::Off
                    },
                    &mut macro_definitions,
                );
                render_diagnostics.mark_case_groups = false;
                if protect_title {
                    // Sentence casing runs after TeX rendering, with original groups restored
                    // according to the configured `as-needed`, `strict`, or `off` mode.
                    value = tex::sentence_case_title(
                        &value,
                        options.sentence_case.guess,
                        options.sentence_case.sub_sentence,
                        options.sentence_case.preserve_quoted,
                        case_protection,
                    );
                }
            }
            let parsed = match current_mode.as_str() {
                "creatorlist" => FieldValue::Creators(
                    split_creators(&value)
                        .iter()
                        .map(|name| {
                            parse_creator(
                                name,
                                &entry.key,
                                &mut macro_definitions,
                                &mut render_diagnostics,
                            )
                        })
                        .collect(),
                ),
                "literallist" => unreachable!("literal lists are parsed before rendering"),
                _ => FieldValue::Text(value.trim().to_string()),
            };
            fields.insert(field, parsed);
        }
        if !keywords.is_empty() {
            mode.insert("keywords".to_string(), "verbatimlist".to_string());
            fields.insert("keywords".to_string(), FieldValue::List(keywords));
        }
        entries.push(ParsedEntry {
            input: entry.input,
            entry: entry.entry,
            key: entry.key,
            fields,
            mode,
            crossref: HashMap::new(),
        });
        if (index + 1) % 1000 == 0 {
            yield_now().await;
        }
    }
    if options.collapse_markup && !options.raw {
        for value in strings.values_mut() {
            *value = tex::collapse_markup(value);
        }
        for entry in &mut entries {
            for (field, value) in &mut entry.fields {
                if matches!(
                    entry.mode.get(field).map(String::as_str),
                    Some("verbatim" | "verbatimlist")
                ) {
                    continue;
                }
                match value {
                    FieldValue::Text(text) => *text = tex::collapse_markup(text),
                    FieldValue::List(items) => {
                        for item in items {
                            *item = tex::collapse_markup(item);
                        }
                    }
                    FieldValue::Creators(creators) => {
                        for creator in creators {
                            for text in [
                                &mut creator.name,
                                &mut creator.last_name,
                                &mut creator.first_name,
                                &mut creator.prefix,
                                &mut creator.suffix,
                                &mut creator.initial,
                            ]
                            .into_iter()
                            .flatten()
                            {
                                *text = tex::collapse_markup(text);
                            }
                        }
                    }
                }
            }
        }
    }
    // Inherited fields are already typed and rendered in their parent's context, not the child's.
    apply_crossref_inheritance(entries.as_mut_slice(), options.apply_crossref);
    let mut errors = verbatim.errors;
    errors.extend(render_diagnostics.errors);
    ParsedLibrary {
        entries,
        strings,
        comments: verbatim.comments,
        errors,
        preambles: verbatim.preambles,
        jabref: verbatim.jabref,
    }
}

/// Normalize a trimmed, optionally negative ASCII integer without a fixed-width numeric conversion.
/// Invalid syntax returns `None`; leading zeroes and negative zero collapse to canonical text.
fn parse_integer_string(value: &str) -> Option<String> {
    let value = value.trim();
    let (negative, digits) = value
        .strip_prefix('-')
        .map_or((false, value), |digits| (true, digits));
    if digits.is_empty() || !digits.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() {
        Some("0".to_string())
    } else if negative {
        Some(format!("-{digits}"))
    } else {
        Some(digits.to_string())
    }
}

/// Convert English month names to unpadded numbers; otherwise return the trimmed input unchanged.
fn normalize_month(value: &str) -> String {
    let value = value.trim();
    let month = match value.to_ascii_lowercase().as_str() {
        "jan" | "january" => "1",
        "feb" | "february" => "2",
        "mar" | "march" => "3",
        "apr" | "april" => "4",
        "may" => "5",
        "jun" | "june" => "6",
        "jul" | "july" => "7",
        "aug" | "august" => "8",
        "sep" | "september" => "9",
        "oct" | "october" => "10",
        "nov" | "november" => "11",
        "dec" | "december" => "12",
        _ => return value.to_string(),
    };
    month.to_string()
}

/// Parse BibTeX syntax without interpreting LaTeX or field values.
pub fn parse_verbatim(input: &str, options: Options) -> Library {
    Parser::new(input, options).parse()
}

/// Parse BibTeX and reparse its fields into typed values, rendering LaTeX content.
pub fn parse(input: &str, options: Options) -> ParsedLibrary {
    reparse_with_options(parse_verbatim(input, options.clone()), &options)
}

#[cfg(target_arch = "wasm32")]
mod wasm_bindings {
    use serde::Serialize;
    use std::collections::HashMap;
    use wasm_bindgen::prelude::*;

    use super::{Options, Parser, parse, parse_verbatim, reparse_with_yield};

    /// Install the browser-console panic hook once when the WASM module is initialized.
    #[wasm_bindgen(start)]
    pub fn start() {
        console_error_panic_hook::set_once();
    }

    #[wasm_bindgen(
        inline_js = "export function playnice() { return new Promise(resolve => setTimeout(resolve, 0)); }"
    )]
    extern "C" {
        /// Yield to the JavaScript event loop via a timer so cooperative parsing does not starve UI work.
        async fn playnice();
    }

    /// Decode optional JavaScript options, defaulting omitted/null options and surfacing type errors.
    fn decode_options(options: Option<JsValue>) -> Result<Options, JsValue> {
        options
            .map(|value| {
                serde_wasm_bindgen::from_value(value)
                    .map_err(|error| JsValue::from_str(&error.to_string()))
            })
            .transpose()
            .map(Option::unwrap_or_default)
    }

    /// Serialize Rust maps as plain JavaScript objects rather than key/value pair arrays.
    fn encode_result<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
        value
            .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Parse a BibTeX string and return the verbatim result as a JavaScript object.
    #[wasm_bindgen(js_name = parseVerbatim)]
    pub fn parse_verbatim_js(input: &str, options: Option<JsValue>) -> Result<JsValue, JsValue> {
        let options = decode_options(options)?;
        encode_result(&parse_verbatim(input, options))
    }

    /// Parse a BibTeX string and return the initial typed result as a JavaScript object.
    #[wasm_bindgen(js_name = parse)]
    pub fn parse_js(input: &str, options: Option<JsValue>) -> Result<JsValue, JsValue> {
        let options = decode_options(options)?;
        encode_result(&parse(input, options))
    }

    /// Parse raw BibTeX cooperatively, yielding between directive batches and returning a JS object.
    #[wasm_bindgen(js_name = parseVerbatimAsync)]
    pub async fn parse_verbatim_async_js(
        input: String,
        options: Option<JsValue>,
    ) -> Result<JsValue, JsValue> {
        let options = decode_options(options)?;
        let library = Parser::new(&input, options)
            .parse_with_yield(playnice)
            .await;
        encode_result(&library)
    }

    /// Parse and render BibTeX cooperatively, yielding between directive and entry batches.
    #[wasm_bindgen(js_name = parseAsync)]
    pub async fn parse_async_js(
        input: String,
        options: Option<JsValue>,
    ) -> Result<JsValue, JsValue> {
        let options = decode_options(options)?;
        let verbatim = Parser::new(&input, options.clone())
            .parse_with_yield(playnice)
            .await;
        let library = reparse_with_yield(verbatim, &options, playnice).await;
        encode_result(&library)
    }

    /// Apply sentence casing using optional `guess`, `subSentenceCapitalization`, and `preserveQuoted` flags.
    #[wasm_bindgen(js_name = toSentenceCase)]
    pub fn to_sentence_case_js(input: &str, options: Option<JsValue>) -> Result<String, JsValue> {
        let options = options
            .map(|value| {
                serde_wasm_bindgen::from_value::<HashMap<String, bool>>(value)
                    .map_err(|error| JsValue::from_str(&error.to_string()))
            })
            .transpose()?
            .unwrap_or_default();
        Ok(super::tex::sentence_case_with_options(
            input,
            options.get("guess").copied().unwrap_or(false),
            options
                .get("subSentenceCapitalization")
                .copied()
                .unwrap_or(true),
            options.get("preserveQuoted").copied().unwrap_or(true),
        ))
    }
}

// --- Tests ---
#[cfg(test)]
mod tests {
    use super::{FieldValue, Options, ParsedLibrary, parse, parse_verbatim, reparse_with_options};

    /// Parse a fixture with default options and fail immediately on recoverable parse errors.
    fn fixture(source: &str) -> ParsedLibrary {
        let parsed = parse(source, Options::default());
        assert!(parsed.errors.is_empty(), "{:?}", parsed.errors.first());
        parsed
    }

    #[test]
    /// Checks the final library pass merges JabRef metadata and inherited crossref fields.
    fn library_finalization_renders_comments_and_inherits_crossref() {
        let parsed = parse(
            "@comment{jabref-meta: groupsversion: 3}\n@book{parent, title={Parent title}, author={Doe, John}}\n@inbook{child, crossref={parent}, chapter={A}}",
            Options::default(),
        );
        assert_eq!(parsed.jabref.groupsversion, Some(3));
        assert!(
            matches!(parsed.entries[1].fields.get("title"), Some(FieldValue::Text(title)) if title == "Parent title")
        );
        assert!(
            matches!(parsed.entries[1].fields.get("author"), Some(FieldValue::Creators(creators)) if creators.iter().any(|creator| creator.last_name.as_deref() == Some("Doe") && creator.first_name.as_deref() == Some("John")))
        );
        assert_eq!(
            parsed.entries[1].crossref.get("title").unwrap().field,
            "title"
        );
        assert!(parsed.comments.is_empty());
    }

    #[test]
    /// Verify type remappings, allowed fields, and child-value precedence during inheritance.
    fn crossref_uses_type_mappings_and_allowed_fields() {
        let parsed = parse(
            "@periodical{p,title={Transactions}}\n@article{a,crossref={p}}",
            Options::default(),
        );
        assert_eq!(
            parsed.entries[1].fields.get("journaltitle"),
            Some(&FieldValue::Text("Transactions".into()))
        );
        assert_eq!(
            parsed.entries[1].crossref.get("journaltitle"),
            Some(&super::CrossRefSource {
                parent: "p".into(),
                field: "title".into(),
            })
        );
    }

    #[test]
    /// Verify nested JabRef memberships and the handling of metadata versus ordinary comments.
    fn parses_jabref_group_tree_hierarchy() {
        let mut parsed = parse(
            include_str!(
                "../../test/better-bibtex/import/Jabref groups import does not work #717.3.8.bib"
            ),
            Options::default(),
        );
        assert_eq!(parsed.jabref.database_type.as_deref(), Some("bibtex"));
        assert_eq!(parsed.jabref.root.len(), 1, "{:?}", parsed.jabref);
        assert_eq!(parsed.jabref.root[0].groups.len(), 2, "{:?}", parsed.jabref);
        assert_eq!(parsed.jabref.root[0].name, "my-main-group-3");
        assert_eq!(parsed.jabref.root[0].groups[0].name, "my-subgroup-3");
        assert_eq!(
            parsed.jabref.root[0].groups[0].groups[0].name,
            "sub-sub-group-3"
        );
        assert!(
            parsed
                .jabref
                .add_entry("sub-sub-group-3", "membership-probe")
        );
        assert!(
            parsed
                .jabref
                .add_entry("sub-sub-group-3", "membership-probe")
        );
        assert_eq!(
            parsed.jabref.root[0].groups[0].groups[0].entries,
            vec!["membership-probe"]
        );
        assert!(!parsed.jabref.add_entry("Missing", "membership-probe"));
        assert!(
            serde_json::to_value(&parsed.jabref)
                .unwrap()
                .get("groups")
                .is_none()
        );
    }

    #[test]
    /// Checks nested values, string expansion, and duplicate-field suffixing.
    fn parses_nested_values_and_duplicate_fields() {
        let result = parse_verbatim(
            "@string{venue={Journal}} @article{key,title={A {nested} title},journal=venue # { ! },note={one},note={two}}",
            Options::default(),
        );
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        let fields = &result.entries[0].fields;
        assert_eq!(fields["title"], "A {nested} title");
        assert_eq!(fields["journal"], "Journal ! ");
        assert_eq!(fields["note+duplicate-1"], "two");
    }

    #[test]
    /// Keep literal command delimiters and contents from affecting surrounding field parsing.
    fn verbatim_commands_preserve_literal_field_contents() {
        for (value, expected) in [
            (
                r#"{before \verb|} $ % \textbf{raw| after}"#,
                r#"before } $ % \textbf{raw after"#,
            ),
            (r#""before \verb!{ " raw! after""#, "before { \" raw after"),
            (r#"{\verb{unbalanced } braces{}"#, "unbalanced } braces"),
            (r#"{\verb}unbalanced { braces}}"#, "unbalanced { braces"),
            (r#"{\verb*literal } {*}"#, "literal } {"),
            (r#"{\verb%literal $ { %}"#, "literal $ {"),
            (r#"{before\verb||after}"#, "beforeafter"),
            (r#"{\\verb|ordinary|}"#, "<br>verb|ordinary|"),
            (r#"{before \path{a{b} after}"#, "before a{b after"),
            (
                r#"{\path{C:\raw_%$#file} after}"#,
                r#"C:\raw_%$#file after"#,
            ),
            (
                r#"{before \path|} $ % \textbf{raw| after}"#,
                r#"before } $ % \textbf{raw after"#,
            ),
            (r#""before \path!{ " raw! after""#, "before { \" raw after"),
            (r#"{\path}unbalanced { braces}}"#, "unbalanced { braces"),
            (r#"{before\path{}after}"#, "beforeafter"),
        ] {
            let source = format!("@misc{{entry,note={value},year={{2026}}}}");
            let raw = parse_verbatim(&source, Options::default());
            assert!(raw.errors.is_empty(), "{value}: {:?}", raw.errors);
            assert_eq!(raw.entries[0].fields["note"], &value[1..value.len() - 1]);
            let parsed = fixture(&source);
            assert_eq!(
                parsed.entries[0].fields["note"],
                FieldValue::Text(expected.into())
            );
            assert_eq!(
                parsed.entries[0].fields["year"],
                FieldValue::Text("2026".into())
            );
        }
    }

    #[test]
    /// Verify case-insensitive verbatim-field glob matching and literal-name matching.
    fn verbatim_fields_match_glob_patterns() {
        let options: Options = serde_json::from_value(serde_json::json!({
            "verbatimFields": ["TITLE", {"source": "file*"}, {"source": "custom?"}, {"source": "*notes"}, "x.y", "a[b]"]
        }))
        .unwrap();
        for field in [
            "title", "file", "files", "filepath", "customa", "custom1", "mynotes", "x.y", "a[b]",
        ] {
            assert_eq!(super::field_mode(field, &options), "verbatim", "{field}");
        }
        for field in [
            "subtitle", "profile", "custom", "customaa", "xay", "ab", "^title$",
        ] {
            assert_ne!(super::field_mode(field, &options), "verbatim", "{field}");
        }
    }

    #[test]
    /// Verify raw-print whitespace normalization without interpreting verbatim field commands.
    fn verbatim_fields_normalize_printed_whitespace() {
        let parsed = parse(
            "@book{x,url={https://example.org/a   b/\\~wilkins},doi={first\n    second}}",
            Options::default(),
        );
        assert_eq!(
            parsed.entries[0].fields["url"],
            FieldValue::Text("https://example.org/a b/\\~wilkins".into())
        );
        assert_eq!(
            parsed.entries[0].fields["doi"],
            FieldValue::Text("first second".into())
        );
    }

    #[test]
    /// Confirms a TeX macro and both braced arguments remain distinct AST nodes.
    fn tex_parser_preserves_macro_nodes_and_arguments() {
        let source = r"\href{https://example.org}{label}";
        let ast = super::tex::parse(source);
        let Some(super::tex::Node::Macro {
            name,
            arguments,
            span,
        }) = ast.content.first()
        else {
            panic!("expected a TeX macro node");
        };
        assert_eq!(name, "href");
        assert_eq!(span.start.offset, 0);
        assert_eq!(span.end.offset, 5);
        assert_eq!(ast.span.end.offset, source.encode_utf16().count());
        assert_eq!(arguments.len(), 2);
        assert_eq!(
            arguments[0],
            [super::tex::Node::String(
                "https://example.org".into(),
                super::tex::SourceSpan {
                    start: super::tex::SourcePosition {
                        offset: 6,
                        line: 1,
                        column: 7
                    },
                    end: super::tex::SourcePosition {
                        offset: 25,
                        line: 1,
                        column: 26
                    },
                },
            )]
        );
        assert!(matches!(
            arguments[0].as_slice(),
            [super::tex::Node::String(text, _)] if text == "https://example.org"
        ));
        assert!(matches!(
            arguments[1].as_slice(),
            [super::tex::Node::Group(children, _)] if matches!(children.as_slice(), [super::tex::Node::String(text, _)] if text == "label")
        ));
    }

    #[test]
    /// Checks whitespace, paragraph breaks, and comments remain as distinct AST nodes.
    fn tex_parser_preserves_whitespace_parbreaks_and_comments() {
        let nodes = super::tex::parse("alpha  \n\n% comment\n beta gamma");
        assert!(
            nodes
                .content
                .iter()
                .any(|node| matches!(node, super::tex::Node::Whitespace(_, _)))
        );
        assert!(
            nodes
                .content
                .iter()
                .any(|node| matches!(node, super::tex::Node::Parbreak(_)))
        );
        assert!(
            nodes
                .content
                .iter()
                .any(|node| matches!(node, super::tex::Node::Comment { .. }))
        );
        assert_eq!(
            super::tex::render("alpha  \n\n% comment\n beta gamma", "title"),
            "alpha beta gamma"
        );
        assert_eq!(super::tex::render(r"foo\ bar", "title"), "foo bar");
        assert_eq!(super::tex::render("A.  \n   B", "literal"), "A. B");
        let nbsp = super::tex::parse("a\u{00a0}b");
        assert!(matches!(
            nbsp.content.as_slice(),
            [super::tex::Node::String(text, _)] if text == "a\u{00a0}b"
        ));
        assert_eq!(
            super::tex::render("00\u{2009}text", "literal"),
            "00\u{2009}text"
        );
        assert_eq!(
            super::tex::render("aa\u{2005}bb", "literal"),
            "aa\u{2005}bb"
        );
    }

    #[test]
    /// Checks UTF-16 spans, malformed-group recovery, and comment-boundary metadata.
    fn tex_parser_matches_source_span_and_recovery_contract() {
        let malformed = super::tex::parse("a {b");
        assert_eq!(malformed.span.start.offset, 0);
        assert_eq!(malformed.span.end.offset, 4);
        assert!(matches!(
            malformed.content.as_slice(),
            [
                super::tex::Node::String(text, super::tex::SourceSpan { start: super::tex::SourcePosition { offset: 0, .. }, end: super::tex::SourcePosition { offset: 1, .. } }),
                super::tex::Node::Whitespace(text_space, _),
                super::tex::Node::String(open, super::tex::SourceSpan { start: super::tex::SourcePosition { offset: 2, .. }, end: super::tex::SourcePosition { offset: 3, .. } }),
                super::tex::Node::String(tail, super::tex::SourceSpan { start: super::tex::SourcePosition { offset: 3, .. }, end: super::tex::SourcePosition { offset: 4, .. } }),
            ] if text == "a" && text_space == " " && open == "{" && tail == "b"
        ));

        let unicode = super::tex::parse("😀x");
        assert!(matches!(
            unicode.content.as_slice(),
            [super::tex::Node::String(text, span)]
                if text == "😀x"
                    && span.start.offset == 0
                    && span.end.offset == 3
                    && span.end.column == 4
        ));

        let comment = super::tex::parse("a % c\nb");
        assert!(matches!(
            &comment.content[1],
            super::tex::Node::Comment {
                content,
                span,
                sameline: true,
                leading_whitespace: true,
                suffix_parbreak: false,
            } if content == " c" && span.start.offset == 1 && span.end.offset == 6
        ));

        let comment_parbreak = super::tex::parse("a% c\n\nb");
        assert!(
            matches!(
            comment_parbreak.content.as_slice(),
            [
                super::tex::Node::String(_, _),
                super::tex::Node::Comment {
                    content,
                    suffix_parbreak: true,
                    span,
                    ..
                },
                super::tex::Node::Parbreak(parbreak_span),
                super::tex::Node::String(_, _),
            ] if content == " c"
                && span.start.offset == 1
                && span.end.offset == 4
                && parbreak_span.start.offset == 4
                && parbreak_span.end.offset == 6
            ),
            "{:#?}",
            comment_parbreak.content
        );

        let comment_after_linebreak = super::tex::parse("a\n% c\nb");
        assert!(matches!(
            &comment_after_linebreak.content[1],
            super::tex::Node::Comment {
                content,
                span,
                sameline: false,
                leading_whitespace: false,
                ..
            } if content == " c" && span.start.offset == 1 && span.end.offset == 6
        ));

        let indented_comment = super::tex::parse("a% c\n b");
        assert!(matches!(
            indented_comment.content.as_slice(),
            [
                super::tex::Node::String(_, _),
                super::tex::Node::Comment { span, .. },
                super::tex::Node::String(b, _),
            ] if span.start.offset == 1 && span.end.offset == 6 && b == "b"
        ));
    }

    #[test]
    /// Checks matched nested environments and unmatched begin/end commands remain structurally distinct.
    fn tex_parser_matches_environment_recovery_contract() {
        let nested = super::tex::parse(r"\begin{a}x\begin{b}y\end{b}z\end{a}");
        assert!(matches!(
            nested.content.as_slice(),
            [super::tex::Node::Environment { name, content, span }]
                if name == "a"
                    && span.start.offset == 0
                    && span.end.offset == 35
                    && matches!(content.as_slice(), [
                        super::tex::Node::String(x, _),
                        super::tex::Node::Environment { name: inner, .. },
                        super::tex::Node::String(z, _),
                    ] if x == "x" && inner == "b" && z == "z")
        ));

        let unmatched = super::tex::parse(r"\begin{a}x\end{b}tail");
        assert!(matches!(
            unmatched.content.as_slice(),
            [
                super::tex::Node::Macro { name: begin, span, .. },
                super::tex::Node::String(x, _),
                super::tex::Node::Macro { name: end, .. },
                super::tex::Node::String(tail, _),
            ] if begin == "begin" && span.end.offset == 6 && x == "x" && end == "end" && tail == "tail"
        ));

        let inner_unmatched = super::tex::parse(r"\begin{a}x\begin{b}y\end{a}");
        assert!(matches!(
            inner_unmatched.content.as_slice(),
            [super::tex::Node::Environment { name, content, span }]
                if name == "a"
                    && span.end.offset == 27
                    && matches!(content.as_slice(), [
                        super::tex::Node::String(x, _),
                        super::tex::Node::Macro { name: begin, .. },
                        super::tex::Node::String(y, _),
                    ] if x == "x" && begin == "begin" && y == "y")
        ));
    }

    #[test]
    /// Checks alternate math delimiters create math nodes and `verb` preserves its literal body.
    fn tex_parser_handles_alternate_math_and_verb_syntax() {
        let inline = super::tex::parse(r"\(\frac n 2\)");
        let display = super::tex::parse(r"\[\frac n 2\]");
        assert_eq!(inline, display);
        assert_eq!(super::tex::render(r"\(\frac n 2\)", "title"), "ⁿ⁄₂");
        assert_eq!(super::tex::render(r"\[\frac n 2\]", "title"), "ⁿ⁄₂");
        assert_eq!(
            super::tex::render(r"\verb+http://example/~user+", "literal"),
            "http://example/~user"
        );
    }

    #[test]
    /// Checks custom macro bodies expand and nested ifdefined blocks are skipped.
    fn tex_parser_expands_macros_and_skips_conditionals() {
        assert_eq!(
            super::tex::render(
                r"\newcommand{\hello}{Hello} \newcommand{\greeting}{\hello{} world} \greeting",
                "title"
            ),
            "Hello world"
        );

        let conditional = super::tex::render(
            r"before \ifdefined\first hidden \ifdefined\second nested\fi fallback\else other\fi after",
            "title",
        );
        assert!(conditional.contains("before"));
        assert!(conditional.contains("after"));
        assert!(!conditional.contains("hidden"));
        assert!(!conditional.contains("nested"));
        assert!(!conditional.contains("fallback"));
        assert!(!conditional.contains("other"));
    }

    #[test]
    /// Checks that custom-command arity and default parameters do not enter replacement text.
    fn tex_parser_matches_parameterized_custom_command_behavior() {
        assert_eq!(
            super::tex::render(r"\newcommand{\hello}[1]{Hello #1} \hello{world}", "literal"),
            "Hello #1world"
        );
        assert_eq!(
            super::tex::render(
                r"\newcommand{\greet}[2][Hi]{#1 #2} \greet[Howdy]{friend}",
                "literal"
            ),
            "#1 #2[Howdy]friend"
        );
    }

    #[test]
    /// Verify preamble definitions remain available while rendering subsequent entry fields.
    fn preamble_newcommands_expand_in_entry_fields() {
        assert_eq!(
            super::tex::render(
                r"\newcommand{\mnras}{Monthly Notices of the Royal Astronomical Society} {\mnras}",
                "title"
            ),
            "<span class=\"nocase\">Monthly Notices of the Royal Astronomical Society</span>"
        );
        let library = parse_verbatim(
            r"@preamble{\newcommand{\mnras}{Monthly Notices of the Royal Astronomical Society}}
@ARTICLE{test,
  journal = {\mnras},
  title = {Example}
}",
            Options::default(),
        );
        let parsed = reparse_with_options(library, &Options::default());
        let journal = parsed.entries[0]
            .fields
            .get("journal")
            .and_then(|value| match value {
                FieldValue::Text(value) => Some(value.as_str()),
                _ => None,
            })
            .unwrap();
        assert_eq!(journal, "Monthly Notices of the Royal Astronomical Society");

        let from_string = parse(
            r"@string{define={\newcommand{\x}{Expanded}}}
@book{x,title={\x}}",
            Options::default(),
        );
        assert_eq!(
            from_string.entries[0].fields.get("title"),
            Some(&FieldValue::Text("Expanded".into()))
        );
    }

    #[test]
    /// Checks nested environments become nested AST nodes before rich-text rendering.
    fn tex_parser_nests_environment_nodes() {
        assert_eq!(
            super::tex::render(r"\begin{em}inside\end{em}", "literal"),
            "<i>inside</i>"
        );
        assert_eq!(
            super::tex::render(
                r"\begin{quotation}start \begin{em}inside\end{em} end\end{quotation}",
                "richtext"
            ),
            "<blockquote>start <i>inside</i> end</blockquote>"
        );
    }

    #[test]
    /// Checks declarations, single-token style arguments, lists, and quotes in their TeX modes.
    fn tex_visitor_renders_declarations_lists_and_quotes() {
        assert_eq!(
            super::tex::render(r"\bf bold \em italic", "literal"),
            "<b>bold <i>italic</i></b>"
        );
        assert_eq!(
            super::tex::render(
                r"\begin{itemize}\item First\item Second\end{itemize}",
                "richtext"
            ),
            "<ul><li>First<li>Second</ul>"
        );
        assert_eq!(
            super::tex::render(r"\enquote{quoted}", "literal"),
            "“quoted”"
        );
        assert_eq!(super::tex::render(r"\textbf abc", "literal"), "<b>a</b>bc");
        assert_eq!(super::tex::render(r"\LaTeX", "literal"), "LᴬT<sub>E</sub>X");
        assert_eq!(super::tex::render(r"a\par~\par b", "richtext"), "a<p>b");
        assert_eq!(super::tex::render("a\r\nb", "richtext"), "a<p>b");
        assert_eq!(
            super::tex::render(r"\url{http://example.org/\textbf{MiX}}", "literal"),
            r#"<a href="http://example.org/\textbf{MiX}">http://example.org/\textbf{MiX}</a>"#
        );
        assert_eq!(
            super::tex::render(r"dash -- em --- quotes ``quoted''", "literal"),
            "dash – em — quotes “quoted”"
        );
        assert_eq!(
            super::tex::render(
                r"\mathrm{Roman}\rlap{over}\textsl{italic}\bar{abc}",
                "literal"
            ),
            "Romanover<i>italic</i>a\u{0305}b\u{0305}c\u{0305}"
        );
        assert_eq!(
            super::tex::render(r"a\hspace{1em}b\hspace{0pt}c", "literal"),
            "a bc"
        );
        assert_eq!(
            super::tex::render(r"foo\undefined bar", "literal"),
            "foobar"
        );
        assert_eq!(
            super::tex::render("An {unusual name}", "title"),
            "An <span class=\"nocase\">unusual name</span>"
        );
        assert_eq!(
            super::tex::render("An $n$", "title"),
            "An <span class=\"nocase\">n</span>"
        );
    }

    #[test]
    /// Verify adjacent markup collapse is enabled by default and can be explicitly disabled.
    fn collapse_markup_option_defaults_on_and_can_be_disabled() {
        let source = r"@book{x,title={\textit{one} \textit{two}}}";
        let field_mode =
            std::collections::HashMap::from([("title".to_string(), "literal".to_string())]);
        let collapsed = parse(
            source,
            Options {
                field_mode: field_mode.clone(),
                ..Options::default()
            },
        );
        assert_eq!(
            collapsed.entries[0].fields["title"],
            FieldValue::Text("<i>one two</i>".into())
        );

        let separate = parse(
            source,
            Options {
                field_mode,
                collapse_markup: false,
                ..Options::default()
            },
        );
        assert_eq!(
            separate.entries[0].fields["title"],
            FieldValue::Text("<i>one</i> <i>two</i>".into())
        );

        let cased = parse(
            r"@book{x,title={\textit{The} \textit{Title}}}",
            Options {
                collapse_markup: false,
                ..Options::default()
            },
        );
        assert_eq!(
            cased.entries[0].fields["title"],
            FieldValue::Text("<i>The</i> <i>Title</i>".into())
        );

        let marked = "<case-protection><i>The</i></case-protection> <case-protection><i>Title</i></case-protection>";
        let restored = super::tex::sentence_case_title(
            marked,
            false,
            true,
            true,
            super::tex::CaseProtection::Off,
        );
        assert_eq!(restored, "<i>The</i> <i>Title</i>");
        assert_eq!(super::tex::collapse_markup(&restored), "<i>The Title</i>");
    }

    #[test]
    /// Checks title rendering for `off`, `as-needed`, and `strict` case protection.
    fn tex_visitor_honors_case_protection_modes() {
        let mut diagnostics = super::tex::RenderDiagnostics::default();
        assert_eq!(
            super::tex::render_with_case_protection(
                "An {unusual name}",
                "title",
                &mut diagnostics,
                super::tex::CaseProtection::Off,
            ),
            "An unusual name"
        );
        assert_eq!(
            super::tex::render_with_case_protection(
                "An {unusual name}",
                "title",
                &mut diagnostics,
                super::tex::CaseProtection::AsNeeded,
            ),
            "An <span class=\"nocase\">unusual name</span>"
        );
        assert_eq!(
            super::tex::render_with_case_protection(
                "An {unusual name}",
                "title",
                &mut diagnostics,
                super::tex::CaseProtection::Strict,
            ),
            "An <span class=\"nocase\">unusual name</span>"
        );
        diagnostics.mark_case_groups = true;
        assert_eq!(
            super::tex::render_with_case_protection(
                "An $n$",
                "title",
                &mut diagnostics,
                super::tex::CaseProtection::Strict,
            ),
            "An <case-protection>n</case-protection>"
        );
        assert_eq!(
            super::tex::render_with_case_protection(
                "{Astrophysical} {$\\rightarrow$} {Reactions}",
                "title",
                &mut diagnostics,
                super::tex::CaseProtection::Strict,
            ),
            "<case-protection>Astrophysical</case-protection> <case-protection>→</case-protection> <case-protection>Reactions</case-protection>"
        );
        assert_eq!(
            super::tex::sentence_case_title(
                "<case-protection>Astrophysical</case-protection> <case-protection>→</case-protection> <case-protection>Reactions</case-protection>",
                false,
                true,
                true,
                super::tex::CaseProtection::Strict,
            ),
            "<span class=\"nocase\">Astrophysical</span> <span class=\"nocase\">→</span> <span class=\"nocase\">Reactions</span>"
        );
        assert_eq!(
            super::tex::render_with_case_protection(
                r"{\mbox{$\mu$}} {J}",
                "title",
                &mut diagnostics,
                super::tex::CaseProtection::Strict,
            ),
            "<case-protection>𝜇</case-protection> <case-protection>J</case-protection>"
        );
        assert_eq!(
            super::tex::sentence_case_title(
                "<case-protection>𝜇</case-protection> <case-protection>J</case-protection>",
                false,
                true,
                true,
                super::tex::CaseProtection::Strict,
            ),
            "<span class=\"nocase\">𝜇</span> <span class=\"nocase\">J</span>"
        );
        assert_eq!(
            super::tex::render_with_case_protection(
                r"A\hspace{1em}B",
                "title",
                &mut diagnostics,
                super::tex::CaseProtection::Strict,
            ),
            "A B"
        );
        assert_eq!(
            super::tex::sentence_case_title(
                "<case-protection>Generating Bayesian</case-protection> networks",
                false,
                true,
                true,
                super::tex::CaseProtection::Off,
            ),
            "Generating Bayesian networks"
        );
        diagnostics.mark_case_groups = false;
        let href = parse(
            r"@article{x,title={\href{https://example.test}{Home}}}",
            Options {
                case_protection: "strict".to_string(),
                ..Options::default()
            },
        );
        assert_eq!(
            href.entries[0].fields["title"],
            FieldValue::Text("<a href=\"https://example.test\">Home</a>".to_string())
        );
        for (title, expected) in [
            (
                r"Stability {Analysis} and {\emph{Optimization}}",
                "Stability Analysis and <i>optimization</i>",
            ),
            (
                "{NASA} and {the} study",
                "NASA and <span class=\"nocase\">the</span> study",
            ),
            (
                "{van der Waals} interactions",
                "<span class=\"nocase\">van der Waals</span> interactions",
            ),
            (
                "{TitleCase} {alllower}",
                "TitleCase <span class=\"nocase\">alllower</span>",
            ),
        ] {
            let parsed = parse(
                &format!("@book{{case,title={{{title}}}}}"),
                Options::default(),
            );
            assert_eq!(
                parsed.entries[0].fields["title"],
                FieldValue::Text(expected.into())
            );
        }
        let markup_title = parse(
            r"@article{x,title={A {\em A} \begin{em}A\end{em} \begin{em}{A}\end{em} {A \em A}}}",
            Options::default(),
        );
        assert_eq!(
            markup_title.entries[0].fields["title"],
            FieldValue::Text("A <i>a a A</i> A <i>A</i>".into())
        );
        let quoted = parse(
            r"@article{x,langid={en},title={Blah and \enquote{enquote}.}}",
            Options::default(),
        );
        assert_eq!(
            quoted.entries[0].fields["title"],
            FieldValue::Text("Blah and “<span class=\"nocase\">enquote</span>”.".into())
        );
        let options = Options {
            english: vec!["en".into()],
            ..Options::default()
        };
        let grouped_markup = parse(
            r"@book{x,langid={en},title={Reading {{HLA Hart}}'s: {{{\emph{The Concept}}}}{\emph{ of }}{{{\emph{Law}}}}}}",
            options,
        );
        assert_eq!(
            grouped_markup.entries[0].fields["title"],
            FieldValue::Text("Reading HLA Hart's: <i>The Concept of Law</i>".into())
        );
        let hyphenated = parse(
            "@book{x,title={Symphony {No.}~3 in {E-flat} major}}",
            Options::default(),
        );
        assert_eq!(
            hyphenated.entries[0].fields["title"],
            FieldValue::Text("Symphony No.\u{00a0}3 in E-flat major".into())
        );
    }

    #[test]
    /// Ensures compound initials lowercase while standalone and sentence-initial capitals remain.
    fn sentence_case_lowercases_capitals_inside_hyphenated_words() {
        assert_eq!(
            super::tex::sentence_case_with_options("A K-Cap'01", false, false, true),
            "A k-cap'01"
        );
        assert_eq!(
            super::tex::sentence_case_with_options("A K Barker", false, false, true),
            "A K barker"
        );
        assert_eq!(
            super::tex::sentence_case_with_options("K-Cap Proceedings", false, false, true),
            "K-cap proceedings"
        );
    }

    #[test]
    /// Checks sentence-case delegation while preserving markup and protected text.
    fn sentence_case_delegates_to_core() {
        assert_eq!(
            super::tex::sentence_case_with_options("THE EFFECT OF DNA ON RNA", false, false, true,),
            "The effect of DNA on RNA"
        );
        assert_eq!(
            super::tex::sentence_case_with_options("A TITLE: AN EXPLANATION", false, false, true),
            "A title: an explanation"
        );
        assert_eq!(
            super::tex::sentence_case_with_options("A TITLE: AN EXPLANATION", false, true, true),
            "A title: An explanation"
        );
        assert_eq!(
            super::tex::sentence_case_with_options("An <i>ex</i>ample Title", false, false, false),
            "An <i>ex</i>ample title"
        );
        assert_eq!(
            super::tex::sentence_case_with_options("An Ex<i>ample</i>", false, false, false),
            "An ex<i>ample</i>"
        );
        assert_eq!(
            super::tex::sentence_case_with_options("A İ<i>X</i>", false, false, false),
            "A i\u{0307}<i>x</i>"
        );
        assert_eq!(
            super::tex::sentence_case_with_options(
                "A Study of \"DNA SEQUENCING\" in Cells",
                false,
                false,
                true,
            ),
            "A study of \"DNA SEQUENCING\" in cells"
        );
        assert_eq!(
            super::tex::sentence_case_with_options(
                "A Title <span class=\"nocase\">nASA Name</span> of Cells",
                false,
                false,
                false,
            ),
            "A title <span class=\"nocase\">nASA Name</span> of cells"
        );
    }

    #[test]
    /// Ensures sentence casing changes unprotected text within a token but restores protected text.
    fn sentence_case_restores_protected_subranges_after_casing() {
        assert_eq!(
            super::tex::sentence_case_with_options(
                "A Mm<case-protection>²</case-protection> Size",
                false,
                false,
                false,
            ),
            "A mm<case-protection>²</case-protection> size"
        );
        assert_eq!(
            super::tex::sentence_case_with_options(
                "A MM<case-protection>X</case-protection> SIZE",
                false,
                false,
                false,
            ),
            "A mm<case-protection>X</case-protection> size"
        );
    }

    #[test]
    /// Checks text ligature conversion for the shared bibliography fixture.
    fn parses_text_ligature_fixture_like_default_case() {
        let parsed = fixture(include_str!(
            "../../test/better-bibtex/export/Better BibLaTeX.001.biblatex"
        ));
        assert_eq!(
            parsed.entries[0].fields["pages"],
            FieldValue::Text("493–518".into())
        );
    }

    #[test]
    /// Checks style macros consume one unbraced character, a group, or a nested command.
    fn tex_style_macros_consume_single_unbraced_argument() {
        for (source, expected) in [
            (r"Stability analysis and \emph optimization", "Stability analysis and <i>o</i>ptimization"),
            (r"\emph{optimization}", "<i>optimization</i>"),
            (r"\emph \textbf{optimization}", "<i><b>optimization</b></i>"),
            (r"\textbf optimization", "<b>o</b>ptimization"),
            (r"\mkbibbold optimization", "<b>o</b>ptimization"),
            (r"\textit optimization", "<i>o</i>ptimization"),
            (r"\textsl optimization", "<i>o</i>ptimization"),
            (r"\mkbibemph optimization", "<i>o</i>ptimization"),
            (r"\textsc optimization", "<span style=\"font-variant:small-caps;\">o</span>ptimization"),
            (r"\texttt optimization", "<code>o</code>ptimization"),
            ("\\emph \u{1f600}optimization", "<i>\u{1f600}</i>optimization"),
        ] {
            let parsed = parse(&format!("@article{{x,note={{{source}}}}}"), Options::default());
            assert_eq!(parsed.entries[0].fields["note"], FieldValue::Text(expected.into()), "{source}");
        }
    }

    #[test]
    /// Checks rendered output for common text markup macros.
    fn parses_text_markup_fixture_like_default_case() {
        let parsed = fixture(include_str!(
            "../../test/better-bibtex/export/Better BibLaTeX.007.biblatex"
        ));
        let FieldValue::Text(title) = &parsed.entries[0].fields["title"] else {
            panic!("title should be scalar text");
        };
        assert_eq!(
            title,
            "Test of markupconversion: Italics, bold, superscript, subscript, and small caps: Mitochondrial DNA₂ sequences suggest unexpected phylogenetic position of Corso-Sardinian grass snakes (<i>Natrix cetti</i>) and <b>do not</b> support their <span style=\"font-variant:small-caps;\">species status</span>, with notes on phylogeography and subspecies delineation of grass snakes."
        );
    }

    #[test]
    /// Checks rich-text list and paragraph rendering against an existing fixture snapshot.
    fn parses_richtext_itemize_fixture_like_default_case() {
        let parsed = fixture(include_str!(
            "../../test/better-bibtex/export/Unicode ø in author name is exported with trailing space which does not work in bibtex #1538.bibtex"
        ));
        let FieldValue::Text(note) = &parsed.entries[0].fields["note"] else {
            panic!("note should be scalar text");
        };
        assert!(note.contains("<ul><li>Clean experiment"));
        assert!(note.contains("<p><li>The amount of work"));
    }

    #[test]
    /// Checks unknown macros and environments are retained and reported once by kind.
    fn tex_visitor_reports_unsupported_constructs() {
        let parsed = parse(
            r"@article{k,title={\unknown one \unknown two},note={\begin{custom}\inside body\end{custom}}}",
            Options::default(),
        );
        assert_eq!(parsed.errors.len(), 2);
        assert!(parsed.errors.iter().any(|error| {
            error.error == "unhandled macro \\unknown" && error.input == r"\unknown"
        }));
        assert!(parsed.errors.iter().any(|error| {
            error
                .error
                .starts_with("unhandled environment custom (\\begin{custom}")
                && error.input.starts_with(r"\begin{custom}")
                && error.input.ends_with(r"\end{custom}")
        }));
        assert!(
            parsed
                .errors
                .iter()
                .all(|error| !error.error.contains("macro \\inside"))
        );

        let ignored = parse(
            r"@article{k,note={before \unknown after}}",
            Options {
                unsupported: Some(crate::UnsupportedHandler::Ignore),
                ..Options::default()
            },
        );
        assert_eq!(ignored.errors.len(), 1);
        assert!(matches!(
            &ignored.entries[0].fields["note"],
            FieldValue::Text(note) if note == "before after"
        ));

        let nested_accent = parse(
            r"@book{x,title={\'{\a}}}",
            Options {
                english: Vec::new(),
                ..Options::default()
            },
        );
        assert!(matches!(
            &nested_accent.entries[0].fields["title"],
            FieldValue::Text(title) if title == "a\u{0301}"
        ));
        assert!(nested_accent.errors.is_empty());

        let standalone = parse(
            r"@book{x,title={\a}}",
            Options {
                english: Vec::new(),
                ..Options::default()
            },
        );
        assert!(matches!(
            &standalone.entries[0].fields["title"],
            FieldValue::Text(title) if title == r"\a"
        ));
        assert_eq!(standalone.errors[0].error, r"unhandled macro \a");
    }

    #[test]
    /// Checks unbraced fraction arguments and script fallback in an existing math-title fixture.
    fn parses_fraction_macros_in_math_mode_from_existing_fixture() {
        let parsed = fixture(include_str!(
            "../../test/better-bibtex/export/Math parts in title #113.biblatex"
        ));
        assert!(matches!(
            &parsed.entries[0].fields["title"],
            FieldValue::Text(title) if title.contains("ⁿ⁄₂") && !title.contains("\\frac")
        ));

        let unbraced = parse(r"@article{u,title={ $\frac n 2$ }}", Options::default());
        let braced = parse(r"@article{b,title={ $\frac{n}{2}$ }}", Options::default());
        let unbraced_title = &unbraced.entries[0].fields["title"];
        let braced_title = &braced.entries[0].fields["title"];
        assert_eq!(unbraced_title, braced_title);
        assert_eq!(unbraced_title, &FieldValue::Text("ⁿ⁄₂".into()));
        let scripts = parse("@book{x,abstract={$x^2_{e}$}}", Options::default());
        assert_eq!(
            scripts.entries[0].fields["abstract"],
            FieldValue::Text("x²ₑ".into())
        );
    }

    #[test]
    /// Verifies callers can use the raw parser without reparsing its fields.
    fn verbatim_parser_is_callable_without_reparsing() {
        let source = include_str!("../../test/better-bibtex/import/Better BibTeX.014.bib");
        let raw = super::parse_verbatim(source, Options::default());
        assert_eq!(
            raw.entries[0].fields["title"],
            r"\textbackslash\textbackslash\{\}: \\{}"
        );
        let parsed = parse(source, Options::default());
        assert!(matches!(
            &parsed.entries[0].fields["title"],
            super::FieldValue::Text(_)
        ));
    }

    #[test]
    /// Matches the existing default snapshot for text macros and escaped braces.
    fn parses_bibtex_escape_fixture_like_default_case() {
        let parsed = fixture(include_str!(
            "../../test/better-bibtex/import/Better BibTeX.014.bib"
        ));
        let entry = &parsed.entries[0];
        assert_eq!(entry.key, "BibTeXEscapeTest1");
        assert_eq!(entry.mode["title"], "title");
        assert_eq!(entry.fields["title"], FieldValue::Text(r"\\{}:".into()));
    }

    #[test]
    /// Checks literal field modes and preservation of Better BibTeX annotation fields.
    fn parses_plus_field_fixture_like_default_case() {
        let parsed = fixture(include_str!("../../test/other/plus-field.bib"));
        let entry = &parsed.entries[0];
        assert_eq!(entry.key, "9.8:11");
        assert_eq!(entry.mode["author"], "creatorlist");
        assert_eq!(entry.mode["author+an:username"], "literal");
        assert_eq!(entry.fields["date"], FieldValue::Text("2014".into()));
    }

    #[test]
    /// Exercise TeX rendering and literal-name handling in parsed creator components.
    fn creator_names_render_tex_sequences() {
        let parsed = parse(
            "@article{foo, author={H\\\"{a}gg, Nils and Nonnenmacher, St{\\'e}phane and Lecomte, J\\'{e}r\\^{o}me and Nested, J\\'{e}r\\^{\\a}me and D\\'{\\i}az, Carlos}}",
            Options::default(),
        );
        let authors = match &parsed.entries[0].fields["author"] {
            FieldValue::Creators(authors) => authors,
            other => panic!("expected creators, got {other:?}"),
        };
        assert_eq!(authors[0].last_name.as_deref(), Some("Hägg"));
        assert_eq!(authors[1].last_name.as_deref(), Some("Nonnenmacher"));
        assert_eq!(authors[1].first_name.as_deref(), Some("Stéphane"));
        assert_eq!(authors[2].first_name.as_deref(), Some("Jérôme"));
        assert_eq!(authors[3].first_name.as_deref(), Some("Jér^me"));
        assert_eq!(authors[4].last_name.as_deref(), Some("Dı́az"));

        let empty_macro_argument = parse(
            r"@book{x,author={de'{\mbox} Medici, Lorenzo}}",
            Options::default(),
        );
        let FieldValue::Creators(creators) = &empty_macro_argument.entries[0].fields["author"]
        else {
            panic!("expected creators");
        };
        assert_eq!(creators[0].prefix.as_deref(), Some("de'"));
        assert_eq!(creators[0].last_name.as_deref(), Some("Medici"));

        let grouped_family = parse(
            r"@book{x,author={Giuseppe {De Giacomo} and Riccardo {De Masellis}}}",
            Options::default(),
        );
        let FieldValue::Creators(creators) = &grouped_family.entries[0].fields["author"] else {
            panic!("expected creators");
        };
        assert_eq!(creators[0].first_name.as_deref(), Some("Giuseppe"));
        assert_eq!(creators[0].last_name.as_deref(), Some("De Giacomo"));
        assert_eq!(creators[1].first_name.as_deref(), Some("Riccardo"));
        assert_eq!(creators[1].last_name.as_deref(), Some("De Masellis"));

        let nbsp_separator = parse(
            "@book{x,author={A\u{00a0}and\u{00a0}B}}",
            Options::default(),
        );
        assert!(matches!(
            nbsp_separator.entries[0].fields.get("author"),
            Some(FieldValue::Creators(creators)) if creators.len() == 1 && creators[0].last_name.as_deref() == Some("A\u{00a0}and\u{00a0}B")
        ));

        let mut macro_definitions = std::collections::HashMap::new();
        let mut diagnostics = super::tex::RenderDiagnostics::default();
        let narrow_space = super::parse_creator(
            "van\u{2005}Loon, John",
            "",
            &mut macro_definitions,
            &mut diagnostics,
        );
        assert_eq!(narrow_space.last_name.as_deref(), Some("van\u{2005}Loon"));
        assert_eq!(narrow_space.prefix, None);
    }

    #[test]
    /// Verify multiline string declarations use the same layout normalization as rendered fields.
    fn string_values_collapse_multiline_whitespace() {
        let parsed = parse(
            "@STRING{PHILTR-B = \"Philosophical Transactions of the Royal Society of London.\n                      Series B.  Biological Sciences\"}\n@STRING{BOUNDARY = {  alpha\n  beta  }}",
            Options::default(),
        );
        assert_eq!(
            parsed.strings.get("PHILTR-B"),
            Some(&"Philosophical Transactions of the Royal Society of London. Series B. Biological Sciences".to_string())
        );
        assert_eq!(
            parsed.strings.get("BOUNDARY").map(String::as_str),
            Some(" alpha beta ")
        );
    }

    #[test]
    /// Checks conversion of Better BibTeX's extended creator-property syntax.
    fn parses_extended_creator_fixture_like_default_case() {
        let parsed = fixture(include_str!("../../test/other/stray-marker.bib"));
        let super::FieldValue::Creators(author) = &parsed.entries[0].fields["author"] else {
            panic!("author should be parsed as a creator list");
        };
        assert_eq!(author.len(), 1);
        assert_eq!(author[0].first_name.as_deref(), Some("Philippe"));
        assert_eq!(author[0].last_name.as_deref(), Some("Duchamp"));
        assert_eq!(author[0].initial.as_deref(), Some("Ph"));
        assert_eq!(parsed.entries[0].mode["author"], "creatorlist");

        let ordinary = parse("@book{x,author={A=B, John}}", Options::default());
        assert!(matches!(
            ordinary.entries[0].fields.get("author"),
            Some(FieldValue::Creators(creators)) if creators[0].last_name.as_deref() == Some("A=B") && creators[0].first_name.as_deref() == Some("John")
        ));

        let custom = parse("@book{x,author={foo=bar, given=Jane}}", Options::default());
        assert!(matches!(
            custom.entries[0].fields.get("author"),
            Some(FieldValue::Creators(creators)) if creators[0].extra.get("foo") == Some(&serde_json::Value::String("bar".into()))
        ));
    }

    #[test]
    /// Checks both existing URL and href title cases are assigned title mode.
    fn parses_two_latex_tilde_entries_like_default_case() {
        let parsed = fixture(include_str!(
            "../../test/better-bibtex/import/Better BibTeX.006.bib"
        ));
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[0].key, "test-ticket1661");
        assert_eq!(parsed.entries[1].key, "test-ticket1661a");
        assert_eq!(parsed.entries[0].mode["title"], "title");
        assert_eq!(parsed.entries[1].mode["title"], "title");
    }

    #[test]
    /// Checks quotation rendering for the shared rich-text fixture.
    fn parses_richtext_quotation_fixture_like_default_case() {
        let parsed = fixture(include_str!("../../test/other/quotation-18.bib"));
        let entry = &parsed.entries[0];
        assert_eq!(entry.key, "demonstration");
        assert_eq!(entry.mode["note"], "richtext");
        let expected_environment = "<blockquote>sdadsafsf</blockquote>";
        let expected_note = "<blockquote>sdadsafsf</blockquote><p>PRIME und SAT sind exponenziall ybd gelten in der Praxis als nicht lo\u{308}sbar. (<a href=\"zotero://open-pdf/library/items/VAB33DNE?page=30\">note on p.30</a>) <p>";
        assert!(expected_note.starts_with(expected_environment));
        assert_eq!(entry.fields["note"], FieldValue::Text(expected_note.into()));
    }

    #[test]
    /// Checks creator, literal-list, and verbatim modes in a BibLaTeX entry.
    fn parses_verbatim_string_fixture_like_default_case() {
        let parsed = fixture(include_str!("../../test/other/verbatim-string.bib"));
        let entry = &parsed.entries[0];
        assert_eq!(entry.entry, "inbook");
        assert_eq!(entry.key, "Laskar2013");
        assert_eq!(entry.mode["doi"], "verbatim");
        assert_eq!(entry.mode["url"], "verbatim");
        assert_eq!(entry.mode["publisher"], "literallist");
        assert_eq!(entry.mode["editor"], "creatorlist");
    }

    #[test]
    /// Checks all declarations in the shared strings fixture are retained.
    fn parses_builtin_string_table_fixture_like_default_case() {
        let parsed = fixture(include_str!("../../test/other/strings.bib"));
        assert!(parsed.entries.is_empty());
        assert_eq!(parsed.strings.len(), 336);
        assert_eq!(parsed.strings["A&A"], "Astronomy and Astrophysics");
    }

    #[test]
    /// Checks Unicode quote and dash rendering in the default fixture output.
    fn parses_unicode_abstract_fixture_like_default_case() {
        let parsed = fixture(include_str!("../../test/other/textquotedblleft_13.bib"));
        let entry = &parsed.entries[0];
        assert_eq!(entry.key, "Stahl2015");
        assert_eq!(entry.mode["title"], "title");
        assert_eq!(entry.mode["abstract"], "literal");
        let FieldValue::Creators(authors) = &entry.fields["author"] else {
            panic!("author should be parsed as a creator list");
        };
        assert_eq!(authors.len(), 2);
        assert_eq!(authors[0].last_name.as_deref(), Some("Stahl"));
        assert_eq!(
            entry.fields["abstract"],
            FieldValue::Text(
                "Infants use \u{201c}unexpectedness\u{201d} as a \"cue\" for learning. Stahl and Feigenson studied how babies reacted when objects behaved in surprising ways (see the Perspective by Schulz). Babies who saw apparently solid and weighty objects moving through a wall or past the edge of a table without falling looked intently at them. When given the opportunity to explore these peculiar objects, they did so by banging them on the floor\u{2014}as if to test their solidity\u{2014}or dropping them\u{2014}as if to test their weightiness.".into()
            )
        );
    }

    #[test]
    /// Checks creator splitting, literal month normalization, and title mode on a real fixture.
    fn parses_multi_author_month_fixture_like_default_case() {
        let parsed = fixture(include_str!("../../test/other/mid-word-capital.bib"));
        let entry = &parsed.entries[0];
        let FieldValue::Creators(authors) = &entry.fields["author"] else {
            panic!("author should be parsed as a creator list");
        };
        assert_eq!(authors.len(), 9);
        assert_eq!(authors[0].first_name.as_deref(), Some("Benjamin"));
        assert_eq!(authors[0].last_name.as_deref(), Some("Leung"));
        assert_eq!(authors[5].first_name.as_deref(), Some("Bo"));
        assert_eq!(authors[5].last_name.as_deref(), Some("Hyun Kong"));
        assert_eq!(entry.fields["month"], FieldValue::Text("2".into()));
        assert_eq!(entry.mode["title"], "title");

        let editor = parse(
            "@book{x,editor={Ryszard Michalski, Jaime G. Carbonell, and Tom M. Mitchell}}",
            Options::default(),
        );
        let FieldValue::Creators(editors) = &editor.entries[0].fields["editor"] else {
            panic!("editor should be a creator list");
        };
        assert_eq!(editors[0].last_name.as_deref(), Some("Ryszard Michalski"));
        assert_eq!(editors[0].first_name.as_deref(), Some("Jaime G. Carbonell"));
    }

    #[test]
    /// Checks recovery from an empty field and normalization of a double-braced institution.
    fn parses_double_comma_fixture_like_default_case() {
        let parsed = fixture(include_str!(
            "../../test/better-bibtex/import/double-comma.bib"
        ));
        let entry = &parsed.entries[0];
        assert_eq!(entry.entry, "techreport");
        assert_eq!(entry.key, "TBD");
        assert_eq!(
            entry.fields["institution"],
            FieldValue::List(vec!["Research Institute X".into()])
        );
        assert_eq!(entry.mode["url"], "verbatim");
        assert_eq!(
            entry.fields["accessed"],
            FieldValue::Text("2023-01-13".into())
        );
    }

    #[test]
    /// Split literal lists at unprotected `and` separators while preserving braced phrases.
    fn literal_list_split_respects_braced_and() {
        let parsed = parse(
            "@book{x,publisher={{Henry Holt and Co.}}}",
            Options::default(),
        );
        assert_eq!(
            parsed.entries[0].fields["publisher"],
            FieldValue::List(vec!["Henry Holt and Co.".into()])
        );
        let punctuated = parse(
            "@book{x,publisher={Holt, Rinehart, and Winston}}",
            Options::default(),
        );
        assert_eq!(
            punctuated.entries[0].fields["publisher"],
            FieldValue::List(vec!["Holt, Rinehart,".into(), "Winston".into()])
        );
    }

    #[test]
    /// Checks duplicate keyword fields merge without sorting or deduplication.
    fn normalizes_duplicate_keyword_fields() {
        let parsed = parse(
            "@article{k, keywords={zeta, alpha}, keywords={beta; zeta}}",
            Options::default(),
        );
        let FieldValue::List(keywords) = parsed.entries[0].fields["keywords"].clone() else {
            panic!("keywords should be a list");
        };
        assert_eq!(keywords.len(), 4);
        assert_eq!(
            keywords.iter().filter(|keyword| *keyword == "zeta").count(),
            2
        );
        assert_eq!(parsed.entries[0].mode["keywords"], "verbatimlist");

        let collated = parse(
            "@article{k, keywords={Forskningspolitik, Förenta staterna, Zebra, zebra}}",
            Options::default(),
        );
        let FieldValue::List(keywords) = collated.entries[0].fields["keywords"].clone() else {
            panic!("keywords should be a list");
        };
        assert_eq!(keywords.len(), 4);
        assert!(keywords.contains(&"Forskningspolitik".to_string()));
        assert!(keywords.contains(&"Förenta staterna".to_string()));

        let whitespace = fixture("@article{k, keywords={alpha,\n   beta}}");
        assert_eq!(
            whitespace.entries[0].fields["keywords"],
            FieldValue::List(vec!["alpha".into(), "beta".into()])
        );
    }

    #[test]
    /// Checks user field-mode overrides and single outer-brace stripping.
    fn field_mode_overrides_and_outer_braces_match_reference_behavior() {
        let mut field_mode = std::collections::HashMap::new();
        field_mode.insert("customfield".to_string(), "verbatim".to_string());
        let mut remove_outer_braces = vec!["doi".to_string()];
        remove_outer_braces.push("customfield".to_string());

        let parsed = parse(
            "@article{k, doi={{10.1234/example}}, customfield={{literal value}}}",
            Options {
                field_mode,
                remove_outer_braces,
                ..Options::default()
            },
        );

        assert_eq!(parsed.entries[0].mode["doi"], "verbatim");
        assert_eq!(
            parsed.entries[0].fields["doi"],
            FieldValue::Text("10.1234/example".into())
        );
        assert_eq!(parsed.entries[0].mode["customfield"], "verbatim");
        assert_eq!(
            parsed.entries[0].fields["customfield"],
            FieldValue::Text("literal value".into())
        );
    }

    #[test]
    /// Checks map/source string preloads and the maximum-entry stop condition.
    fn supports_preloaded_strings_and_max_entry_limit() {
        let options = Options {
            max_entries: Some(1),
            strings: [("custom".to_string(), "From options".to_string())].into(),
            raw: false,
            apply_crossref: true,
            verbatim_fields: vec![],
            remove_outer_braces: vec![],
            field_mode: std::collections::HashMap::new(),
            ..Options::default()
        };
        let parsed = parse_verbatim("@article{one, journal=custom}\n@article{two}", options);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].fields["journal"], "From options");
    }

    #[test]
    /// Checks comment forms, concatenated preambles, and recovery at the next directive.
    fn parses_comments_preambles_and_recovers_from_bad_entries() {
        let parsed = super::parse_verbatim(
            "% ignored @article{not-an-entry}\n@comment{block {comment}}\n@comment line comment\n@preamble{\"prefix\" # {suffix}}\n@article{bad, title={unclosed\n@book{good, title={ok}}",
            Options::default(),
        );
        assert_eq!(parsed.comments, ["block {comment}", "line comment"]);
        assert_eq!(parsed.preambles, ["\"prefix\" # {suffix}"]);
        assert_eq!(parsed.errors.len(), 1);
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[1].key, "good");
        assert_eq!(parsed.entries[1].fields["title"], "ok");
    }
}
