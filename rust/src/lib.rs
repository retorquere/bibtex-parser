use serde::{Deserialize, Serialize};
use std::collections::HashMap;

mod tex;

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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
/// Configuration for verbatim BibTeX parsing.
pub struct Options {
    /// Stop after this many entries. `None` and `Some(0)` both mean no limit.
    pub max_entries: Option<usize>,
    /// Additional predefined strings, matched without regard to key case.
    pub strings: HashMap<String, String>,
    /// BibTeX source parsed before the main input, commonly a strings file.
    pub strings_source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// A creator parsed from a creator-list field such as `author` or `editor`.
pub struct Creator {
    /// An unparsed literal name, used when the input wraps a whole name in braces.
    pub name: Option<String>,
    /// Family name.
    pub last_name: Option<String>,
    /// Given name.
    pub first_name: Option<String>,
    /// Family-name prefix, such as `van`.
    pub prefix: Option<String>,
    /// Name suffix, such as `Jr.`.
    pub suffix: Option<String>,
    /// Initials supplied by an extended-name field.
    pub initial: Option<String>,
    /// Extended-name `useprefix` property.
    pub useprefix: Option<bool>,
    /// Extended-name `juniorcomma` property.
    pub juniorcomma: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
/// Typed representation of a normalized field value.
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
/// An entry after field-mode assignment and initial typed normalization.
pub struct ParsedEntry {
    /// Original trimmed entry source.
    pub input: String,
    /// Lowercase entry type.
    #[serde(rename = "type")]
    pub entry: String,
    /// Citation key.
    pub key: String,
    /// Normalized field values.
    pub fields: HashMap<String, FieldValue>,
    /// Parser mode assigned to each field (for example, `title` or `creatorlist`).
    pub mode: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Results from [`parse_normalized`], before TeX rendering and other later transformations.
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
    pub preamble: Vec<String>,
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
    /// Prepare parser state, merging predefined strings and optionally prepending a strings file.
    fn new(input: &str, options: Options) -> Self {
        let Options {
            max_entries,
            strings,
            strings_source,
        } = options;
        let mut defaults = default_strings();
        defaults.extend(
            strings
                .into_iter()
                .map(|(key, value)| (key.to_uppercase(), value)),
        );
        // Parsing the preload first makes its declarations available to the main input.
        let source = strings_source
            .map(|strings| format!("{strings}\n{input}"))
            .unwrap_or_else(|| input.to_string());
        Self {
            chars: source.chars().collect(),
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

    /// Format the current source position using the TypeScript parser's UTF-16 columns.
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

    /// Read a BibTeX identifier, allowing the syntax characters accepted by the TS parser.
    fn key(&mut self, allow: &str) -> Result<String, String> {
        let start = self.pos;
        while let Some(ch) = self.chars.get(self.pos).copied() {
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
        if self.pos == start && self.pos == self.chars.len() {
            Err(self.error("Runaway key"))
        } else {
            Ok(self.text(start, self.pos))
        }
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
                // Dollars toggle inline math so an inner brace cannot close a math value early.
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
                if let Some(value) = self
                    .library
                    .strings
                    .get(&upper)
                    .or_else(|| self.defaults.get(&upper))
                {
                    value.clone()
                } else {
                    // Match the TS parser's placeholder behavior while recording one error per message.
                    let message = format!("Unresolved @string reference {bare:?}");
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
            self.library.strings.insert(key.to_uppercase(), value);
        } else if let Some(entry) = self.library.entries.last_mut() {
            // Preserve duplicate fields using the same numbered suffix convention as TypeScript.
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
            self.parsing = self.key("")?.to_lowercase();
            // Comments have a different body grammar and do not create an entry record.
            if self.parsing == "comment" {
                return self.comment();
            }
            let end = self.guard()?;
            if self.parsing == "string" {
                self.field(None)?;
                return self.expect(&end.to_string());
            }
            // Preambles are concatenated values; ordinary directives create entries.
            if self.parsing == "preamble" {
                let preamble = self.value()?;
                self.library.preambles.push(preamble);
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
            let input = self.text(start, self.pos).trim().to_string();
            if let Some(entry) = self.library.entries.last_mut() {
                entry.input = input;
            }
            Ok(())
        })();
        if let Err(error) = result {
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
    fn parse(mut self) -> Library {
        while self.pos < self.chars.len()
            && (self.max_entries == 0 || self.library.entries.len() < self.max_entries)
        {
            let previous = self.pos;
            self.parse_next();
            // Guard against a parser branch that reports success without advancing the cursor.
            if previous == self.pos {
                break;
            }
        }
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
                && chars[index - 1].is_whitespace()
                && index + 3 < chars.len()
                && chars[index + 3].is_whitespace()
            {
                result.push(
                    chars[start..index]
                        .iter()
                        .collect::<String>()
                        .trim()
                        .to_string(),
                );
                index += 3;
                while index < chars.len() && chars[index].is_whitespace() {
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
fn parse_creator(input: &str) -> Creator {
    // A fully braced name is an indivisible literal rather than a family/given name pair.
    if input.starts_with('{') && input.ends_with('}') {
        return Creator {
            name: Some(clean_name_part(input)),
            ..Creator::default()
        };
    }
    let parts = split_top_level(input, ',');
    // Better BibTeX's extended-name syntax is a comma-separated set of named properties.
    if parts.iter().any(|part| part.contains('=')) {
        let mut creator = Creator::default();
        for part in parts {
            let Some((key, value)) = part.split_once('=') else {
                continue;
            };
            let key = key.trim().to_ascii_lowercase();
            let value = clean_name_part(value);
            match key.as_str() {
                "given" => creator.first_name = Some(value),
                "family" => creator.last_name = Some(value),
                "given-i" => creator.initial = Some(value),
                "useprefix" => creator.useprefix = Some(value.eq_ignore_ascii_case("true")),
                "juniorcomma" => creator.juniorcomma = Some(value.eq_ignore_ascii_case("true")),
                _ => {}
            }
        }
        return creator;
    }

    // BibTeX comma form is `family, suffix, given`; without commas names use first-last rules.
    if parts.len() > 1 {
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
        if let Some((prefix, family)) = last_name.split_once(' ')
            && !prefix.is_empty()
            && prefix
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch == '.' || ch == '\'')
        {
            creator.prefix = Some(prefix.to_string());
            creator.last_name = Some(family.to_string());
        }
        return creator;
    }

    let words: Vec<String> = input.split_whitespace().map(clean_name_part).collect();
    if words.len() <= 1 {
        return Creator {
            last_name: words.first().cloned(),
            ..Creator::default()
        };
    }
    let prefix_index = words
        .iter()
        .position(|word| word.chars().next().is_some_and(char::is_lowercase));
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
                .find(|(_, word)| word.chars().next().is_some_and(|ch| !ch.is_lowercase()))
                .map(|(i, _)| i)
                .unwrap_or(words.len());
            Creator {
                first_name: Some(words[..index].join(" ")),
                prefix: Some(words[index..postfix].join(" ")),
                last_name: Some(words[postfix..].join(" ")),
                ..Creator::default()
            }
        }
    }
}

/// Select the parser mode used for a Bib(La)TeX field.
fn field_mode(field: &str) -> &'static str {
    // Specific field groups control creator splitting and which TeX features are rendered.
    if CREATOR_FIELDS.contains(&field) {
        "creatorlist"
    } else if TITLE_FIELDS.contains(&field) {
        "title"
    } else if VERBATIM_FIELDS.contains(&field)
        || field.starts_with("citeulike-linkout-")
        || field.starts_with("bdsk-url-")
    {
        "verbatim"
    } else if RICHTEXT_FIELDS.contains(&field) {
        "richtext"
    } else if LIST_FIELDS.contains(&field) {
        "literallist"
    } else {
        "literal"
    }
}

/// Convert verbatim entries to typed field values and assign each field's parsing mode.
pub fn normalize(verbatim: Library) -> ParsedLibrary {
    let mut render_diagnostics = tex::RenderDiagnostics::default();
    let entries = verbatim
        .entries
        .into_iter()
        .map(|entry| {
            let mut fields = HashMap::new();
            let mut mode = HashMap::new();
            let mut keywords = Vec::new();
            for (field, value) in entry.fields {
                // Duplicate keyword fields are merged after splitting both comma and semicolon lists.
                if field == "keywords" || field.starts_with("keywords+duplicate-") {
                    keywords.extend(
                        value
                            .split([',', ';'])
                            .map(str::trim)
                            .filter(|keyword| !keyword.is_empty())
                            .map(str::to_string),
                    );
                    continue;
                }
                let current_mode = field_mode(&field);
                mode.insert(field.clone(), current_mode.to_string());
                let mut value = value;
                // These deterministic field actions precede TeX rendering, matching the TS parser.
                if field == "year" {
                    if let Ok(year) = value.trim().parse::<i64>() {
                        value = year.to_string();
                    }
                } else if field == "month" {
                    value = normalize_month(&value);
                }
                // Verbatim data must remain untouched; creator lists need their own name tokenizer.
                if current_mode != "verbatim" && current_mode != "creatorlist" {
                    value =
                        tex::render_with_diagnostics(&value, current_mode, &mut render_diagnostics);
                }
                // These two modes produce arrays; all remaining non-keyword fields are scalar text.
                let parsed = match current_mode {
                    "creatorlist" => FieldValue::Creators(
                        split_creators(&value)
                            .iter()
                            .map(|name| parse_creator(name))
                            .collect(),
                    ),
                    "literallist" => FieldValue::List(
                        split_creators(&value)
                            .iter()
                            .map(|element| clean_name_part(element))
                            .collect(),
                    ),
                    _ => FieldValue::Text(value),
                };
                fields.insert(field, parsed);
            }
            // Sort case-insensitively before deduplication to produce stable output.
            keywords.sort_by_key(|keyword| keyword.to_lowercase());
            keywords.dedup();
            if !keywords.is_empty() {
                mode.insert("keywords".to_string(), "verbatimlist".to_string());
                fields.insert("keywords".to_string(), FieldValue::List(keywords));
            }
            ParsedEntry {
                input: entry.input,
                entry: entry.entry,
                key: entry.key,
                fields,
                mode,
            }
        })
        .collect();
    let mut errors = verbatim.errors;
    errors.extend(render_diagnostics.errors);
    ParsedLibrary {
        entries,
        strings: verbatim.strings,
        comments: verbatim.comments,
        errors,
        preamble: verbatim.preambles,
    }
}

/// Convert a month name or number to the parser's unpadded numeric form.
fn normalize_month(value: &str) -> String {
    let value = value.trim();
    if let Ok(month) = value.parse::<u8>() {
        // Keep only valid calendar month numbers normalized; non-month values remain unchanged.
        if (1..=12).contains(&month) {
            return month.to_string();
        }
    }
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

/// Parse BibTeX syntax without higher-level LaTeX or field normalization.
pub fn parse_verbatim(input: &str, options: Options) -> Library {
    Parser::new(input, options).parse()
}

/// Compatibility alias for [`parse_verbatim`].
pub fn parse(input: &str, options: Options) -> Library {
    parse_verbatim(input, options)
}

/// Parse BibTeX and apply the initial typed field normalization.
pub fn parse_normalized(input: &str, options: Options) -> ParsedLibrary {
    normalize(parse_verbatim(input, options))
}

#[cfg(target_arch = "wasm32")]
mod wasm_bindings {
    use serde::Serialize;
    use wasm_bindgen::prelude::*;

    use super::{Options, parse_normalized, parse_verbatim};

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

    /// Serialize Rust maps as plain JS objects to match the TypeScript API's record types.
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
    #[wasm_bindgen(js_name = parseNormalized)]
    pub fn parse_normalized_js(input: &str, options: Option<JsValue>) -> Result<JsValue, JsValue> {
        let options = decode_options(options)?;
        encode_result(&parse_normalized(input, options))
    }
}

#[cfg(test)]
mod tests {
    use super::{FieldValue, Options, ParsedLibrary, parse, parse_normalized};

    /// Parse a fixture with default options and fail immediately on recoverable parse errors.
    fn fixture(source: &str) -> ParsedLibrary {
        let parsed = parse_normalized(source, Options::default());
        assert!(parsed.errors.is_empty(), "{:?}", parsed.errors.first());
        parsed
    }

    #[test]
    /// Checks nested values, string expansion, and duplicate-field suffixing.
    fn parses_nested_values_and_duplicate_fields() {
        let result = parse(
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
        assert_eq!(arguments[1].len(), 1);
        assert!(
            matches!(arguments[1][0], super::tex::Node::String(ref text, _) if text == "label")
        );
    }

    #[test]
    /// Checks whitespace, paragraph breaks, and comments remain as distinct AST nodes.
    fn tex_parser_preserves_whitespace_parbreaks_and_comments() {
        let nodes = super::tex::parse("alpha  \n\n% comment\n beta");
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
            super::tex::render("alpha  \n\n% comment\n beta", "title"),
            "alpha   beta"
        );
    }

    #[test]
    /// Checks UTF-16 spans, malformed-group fallback, and TypeScript comment metadata.
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
                super::tex::Node::Whitespace(space, whitespace_span),
                super::tex::Node::String(b, _),
            ] if span.start.offset == 1
                && span.end.offset == 5
                && space == " "
                && whitespace_span.start.offset == 5
                && b == "b"
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
    /// Checks custom macros consume parameterized definitions and optional arguments.
    fn tex_parser_supports_custom_macro_parameters_and_optionals() {
        assert_eq!(
            super::tex::render(
                r"\newcommand{\hello}[2]{Hello #1, #2!} \hello{world}{there}",
                "title"
            ),
            "Hello world, there!"
        );
        assert_eq!(
            super::tex::render(
                r"\newcommand{\greet}[2][Hi]{#1 #2} \greet[Howdy]{friend}",
                "title"
            ),
            "Howdy friend"
        );
        assert_eq!(
            super::tex::render(r"\newcommand{\greet}[2][Hi]{#1 #2} \greet{friend}", "title"),
            "Hi friend"
        );
    }

    #[test]
    /// Checks nested environments become nested AST nodes before rich-text rendering.
    fn tex_parser_nests_environment_nodes() {
        assert_eq!(
            super::tex::render(
                r"\begin{quotation}start \begin{em}inside\end{em} end\end{quotation}",
                "richtext"
            ),
            "<blockquote>start <i>inside</i> end</blockquote>"
        );
    }

    #[test]
    /// Checks declaration-style markup, list items, and quote macros render in their TeX modes.
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
            super::tex::render("An {unusual name}", "title"),
            "An <span class=\"nocase\">unusual name</span>"
        );
        assert_eq!(
            super::tex::render("An $n$", "title"),
            "An <span class=\"nocase\">n</span>"
        );
    }

    #[test]
    /// Checks text ligature conversion against a shared fixture and its TypeScript snapshot.
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
    /// Checks common text markup macros against the existing TypeScript fixture snapshot.
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
        let parsed = parse_normalized(
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

        let unbraced = parse_normalized(r"@article{u,title={ $\frac n 2$ }}", Options::default());
        let braced = parse_normalized(r"@article{b,title={ $\frac{n}{2}$ }}", Options::default());
        let unbraced_title = &unbraced.entries[0].fields["title"];
        let braced_title = &braced.entries[0].fields["title"];
        assert_eq!(unbraced_title, braced_title);
        assert_eq!(unbraced_title, &FieldValue::Text("ⁿ⁄₂".into()));
    }

    #[test]
    /// Verifies callers can use the raw parser without applying field normalization.
    fn verbatim_parser_is_callable_without_normalization() {
        let source = include_str!("../../test/better-bibtex/import/Better BibTeX.014.bib");
        let raw = super::parse_verbatim(source, Options::default());
        assert_eq!(
            raw.entries[0].fields["title"],
            r"\textbackslash\textbackslash\{\}: \\{}"
        );
        let normalized = parse_normalized(source, Options::default());
        assert!(matches!(
            &normalized.entries[0].fields["title"],
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
    /// Checks quotation rendering against its fragment in the existing TypeScript default snapshot.
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
    /// Matches Unicode quote and dash rendering against the default TypeScript snapshot.
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
    /// Checks duplicate keyword fields merge, sort, and deduplicate consistently.
    fn normalizes_duplicate_keyword_fields() {
        let parsed = parse_normalized(
            "@article{k, keywords={zeta, alpha}, keywords={beta; zeta}}",
            Options::default(),
        );
        assert_eq!(
            parsed.entries[0].fields["keywords"],
            FieldValue::List(vec!["alpha".into(), "beta".into(), "zeta".into()])
        );
        assert_eq!(parsed.entries[0].mode["keywords"], "verbatimlist");
    }

    #[test]
    /// Checks object/source string preloads and the maximum-entry stop condition.
    fn supports_preloaded_strings_and_max_entry_limit() {
        let options = Options {
            max_entries: Some(1),
            strings: [("custom".to_string(), "From options".to_string())].into(),
            strings_source: Some("@string{source = {From source}}".to_string()),
        };
        let parsed = parse(
            "@article{one, journal=custom, title=source}\n@article{two}",
            options,
        );
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].fields["journal"], "From options");
        assert_eq!(parsed.entries[0].fields["title"], "From source");
        assert_eq!(parsed.strings["SOURCE"], "From source");
    }

    #[test]
    /// Checks comment forms, concatenated preambles, and recovery at the next directive.
    fn parses_comments_preambles_and_recovers_from_bad_entries() {
        let parsed = super::parse_verbatim(
            "% ignored @article{not-an-entry}\n@comment{block {comment}}\n@comment line comment\n@preamble{\"prefix\" # {suffix}}\n@article{bad, title={unclosed\n@book{good, title={ok}}",
            Options::default(),
        );
        assert_eq!(parsed.comments, ["block {comment}", "line comment"]);
        assert_eq!(parsed.preambles, ["prefixsuffix"]);
        assert_eq!(parsed.errors.len(), 1);
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[1].key, "good");
        assert_eq!(parsed.entries[1].fields["title"], "ok");
    }
}
