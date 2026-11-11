//! Unicode-to-LaTeX conversion using tables compiled from config.ssv.

use indexmap::{IndexMap, IndexSet};
use serde::Deserialize;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
use wasm_bindgen::prelude::*;

/// The two TeX output modes; conversion starts in text mode.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
  Text,
  Math,
}

/// A borrowed entry in the generated, immutable character tables.
#[derive(Clone, Copy)]
struct StaticChar {
  text: Option<&'static str>,
  math: Option<&'static str>,
  macrospacer: bool,
  stopgap: bool,
  combining: bool,
  alt: &'static [&'static str],
}

/// Sorted static entries support allocation-free binary search.
type StaticCharMap = &'static [(&'static str, StaticChar)];

/// Base and package maps compiled directly from config.ssv.
struct StaticMap {
  base: StaticCharMap,
  packages: &'static [(&'static str, StaticCharMap)],
}

include!(concat!(env!("OUT_DIR"), "/tables.rs"));

/// A character's text/math representations and conversion metadata.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct TeXChar {
  pub math: Option<String>,
  pub text: Option<String>,
  #[serde(default)]
  pub macrospacer: bool,
  #[serde(default)]
  pub stopgap: bool,
  #[serde(default)]
  pub combining: bool,
  pub alt: Option<Vec<String>>,
}

/// Character or normalized-sequence mappings.
pub type CharMap = IndexMap<String, TeXChar>;

/// Package precedence, mode preferences, ASCII overrides, and custom entries.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct MapOptions {
  #[serde(default)]
  pub packages: Vec<String>,
  pub math: Option<String>,
  pub text: Option<String>,
  pub ascii: Option<String>,
  pub charmap: Option<CharMap>,
}

/// Math grouping, internal separator preservation, and accumulated package hints.
#[derive(Debug, Default)]
pub struct TranslateOptions {
  pub bracemath: bool,
  pub preservemacrospacers: bool,
  pub packages: IndexSet<String>,
}

impl Mode {
  /// Return the opposite mode when the current representation is unavailable.
  fn other(self) -> Self {
    match self {
      Self::Text => Self::Math,
      Self::Math => Self::Text,
    }
  }
}

impl From<StaticChar> for TeXChar {
  /// Copy only a selected map's static entries into mutable per-instance data.
  fn from(entry: StaticChar) -> Self {
    Self {
      text: entry.text.map(str::to_owned),
      math: entry.math.map(str::to_owned),
      macrospacer: entry.macrospacer,
      stopgap: entry.stopgap,
      combining: entry.combining,
      alt: (!entry.alt.is_empty()).then(|| entry.alt.iter().map(|name| (*name).to_owned()).collect()),
    }
  }
}

impl TeXChar {
  /// Treat empty strings as missing, matching JavaScript truthiness checks.
  fn get(&self, mode: Mode) -> Option<&str> {
    match mode {
      Mode::Text => self.text.as_deref(),
      Mode::Math => self.math.as_deref(),
    }
    .filter(|text| !text.is_empty())
  }

  /// Create a mode-only entry, deliberately discarding other metadata.
  fn in_mode(mode: Mode, text: String) -> Self {
    match mode {
      Mode::Text => Self { text: Some(text), ..Self::default() },
      Mode::Math => Self { math: Some(text), ..Self::default() },
    }
  }
}

/// Recognize a complete ASCII TeX control word, excluding its argument or suffix.
fn is_control_word(text: &str) -> bool {
  // Original regex: /^\\[a-z]+$/i
  text.strip_prefix('\\').is_some_and(|command| !command.is_empty() && command.bytes().all(|byte| byte.is_ascii_alphabetic()))
}

/// Recognize the original control-word suffix alphabet, which also includes 0 and 1.
fn ends_control_word(text: &str) -> bool {
  // Original regex: /\\[0-1a-z]+$/i
  text.rsplit_once('\\').is_some_and(|(_, command)| !command.is_empty() && command.bytes().all(|byte| byte.is_ascii_alphabetic() || matches!(byte, b'0' | b'1')))
}

/// Match JavaScript's dot exclusions without excluding other Unicode whitespace.
fn js_line_terminator(character: char) -> bool {
  // Original regex atom: . (without the s flag)
  matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// Preserve an accent's argument group or control word inside an additional group.
fn grouped_accent(text: &str) -> bool {
  // Original regex: /^\\[`\'^~"=.](?:\{.*\}|\\[a-z]+)$/i
  let [b'\\', accent, ..] = text.as_bytes() else {
    return false;
  };
  if !b"`'^~\"=.".contains(accent) {
    return false;
  }
  let argument = &text[2..];
  (argument.starts_with('{') && argument.ends_with('}') && !argument.chars().any(js_line_terminator)) || is_control_word(argument)
}

/// Identify the creator forms that must count as one BibTeX character.
fn creator_group(text: &str) -> bool {
  // Original regexes, in order:
  // /[^{]\{/
  // /^\\[`\'~"=.][a-z]$/i
  // /^\\[\^]\\[ij]$/
  // /^\\[kr]\{[a-zA-Z]\}$/
  // /\\[0-1a-z]+$/i
  let bytes = text.as_bytes();
  bytes.windows(2).any(|pair| pair[0] != b'{' && pair[1] == b'{')
    || matches!(bytes, [b'\\', accent, letter] if b"`'~\"=.".contains(accent) && letter.is_ascii_alphabetic())
    || matches!(bytes, [b'\\', b'^', b'\\', b'i' | b'j'])
    || matches!(bytes, [b'\\', b'k' | b'r', b'{', letter, b'}'] if letter.is_ascii_alphabetic())
    || ends_control_word(text)
}

/// Match ECMAScript whitespace, including BOM but excluding Unicode NEL.
fn js_whitespace(character: char) -> bool {
  // Original regex atom: \s
  matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// Replace internal macro-boundary markers with TeX-safe spacing or grouping.
#[wasm_bindgen]
pub fn replace_macro_spacers(latex: &str) -> String {
  // Original replacements, in order:
  // .replace(/\0(\s)/g, '{}$1')
  // .replace(/\0\s+/g, '\\_')
  // .replace(/\0([^;.,!?${}_^\\/])/g, ' $1')
  // .replace(/\0/g, '')
  // Keep the passes separate: an adjacent marker must see inserted braces,
  // not the whitespace that originally followed the next marker.
  let mut grouped = String::with_capacity(latex.len());
  let mut characters = latex.chars().peekable();
  while let Some(character) = characters.next() {
    if character == '\0' && characters.peek().is_some_and(|next| js_whitespace(*next)) {
      grouped.push_str("{}");
      grouped.push(characters.next().unwrap());
    } else {
      grouped.push(character);
    }
  }
  // The first pass has removed every marker followed by whitespace, so the
  // original second replacement (NUL plus whitespace -> backslash underscore) is unreachable.
  let mut output = String::with_capacity(grouped.len());
  let mut characters = grouped.chars().peekable();
  while let Some(character) = characters.next() {
    if character != '\0' {
      output.push(character);
    } else if characters.peek().is_some_and(|next| !";.,!?${}_^\\/".contains(*next)) {
      output.push(' ');
      // The final cleanup removes even a marker consumed as the following character.
      let next = characters.next().unwrap();
      if next != '\0' {
        output.push(next);
      }
    }
  }
  output
}

/// Match just-permutations' recursive insertion order, including repeated marks.
fn permutations(characters: &[char]) -> Vec<Vec<char>> {
  match characters {
    [] => Vec::new(),
    [single] => vec![vec![*single]],
    [first, rest @ ..] => permutations(rest)
      .into_iter()
      .flat_map(|partial| {
        (0..=partial.len()).map(move |index| {
          let mut permutation = partial.clone();
          permutation.insert(index, *first);
          permutation
        })
      })
      .collect(),
  }
}

/// Borrow the original matcher's tie, combined, or single-character captures.
#[derive(Default)]
struct InputUnit<'a> {
  matched: &'a str,
  tie: Option<&'a str>,
  combined: Option<&'a str>,
  single: &'a str,
  base: &'a str,
  marks: &'a str,
}

/// Scan NFD input without allocating captures; skip unmatched line terminators.
struct InputUnits<'a>(&'a str);

impl<'a> Iterator for InputUnits<'a> {
  type Item = InputUnit<'a>;

  /// Prefer the special tie, then an optional base plus marks, then a JS-dot character.
  fn next(&mut self) -> Option<Self::Item> {
    // Original regex:
    // /(?<match>(?<tie>i\uFE20a\uFE21)|(?<combined>(?<base>[^\p{M}]?)(?<cccs>\p{M}+))|(?<single>.))/gu
    const TIE: &str = "i\u{fe20}a\u{fe21}";
    loop {
      let remaining = self.0;
      let first = remaining.chars().next()?;
      let mut unit = InputUnit::default();
      if remaining.starts_with(TIE) {
        unit.matched = &remaining[..TIE.len()];
        unit.tie = Some(unit.matched);
      } else {
        let base_end = if is_combining_mark(first) { 0 } else { first.len_utf8() };
        let marks_end = remaining[base_end..]
          .char_indices()
          .take_while(|(_, character)| is_combining_mark(*character))
          .last()
          .map_or(base_end, |(index, character)| base_end + index + character.len_utf8());
        if marks_end > base_end {
          // A terminator can be a base when marks follow it, unlike a lone terminator.
          unit.matched = &remaining[..marks_end];
          unit.combined = Some(unit.matched);
          unit.base = &remaining[..base_end];
          unit.marks = &remaining[base_end..marks_end];
        } else {
          unit.matched = &remaining[..first.len_utf8()];
          unit.single = unit.matched;
        }
      }
      self.0 = &remaining[unit.matched.len()..];
      if unit.combined.is_none() && unit.tie.is_none() && js_line_terminator(first) {
        continue;
      }
      return Some(unit);
    }
  }
}

/// Unpack a trailing one-code-unit script immediately before a math closing delimiter.
fn unpack_script(latex: &mut String) {
  // Original regex: /([\^_])\{(.)\}(\$\}?)$/
  let end = if latex.ends_with("$}") {
    latex.len() - 2
  } else if latex.ends_with('$') {
    latex.len() - 1
  } else {
    return;
  };
  let Some(content) = latex[..end].strip_suffix('}') else {
    return;
  };
  let Some(argument) = content.chars().next_back() else {
    return;
  };
  // JS's non-Unicode dot matches a single UTF-16 code unit, not an astral scalar.
  if argument.len_utf16() != 1 || js_line_terminator(argument) {
    return;
  }
  let argument_start = content.len() - argument.len_utf8();
  let Some(start) = argument_start.checked_sub(2) else {
    return;
  };
  if matches!(&latex.as_bytes()[start..argument_start], [b'^' | b'_', b'{']) {
    let replacement = format!("{}{argument}", char::from(latex.as_bytes()[start]));
    latex.replace_range(start..end, &replacement);
  }
}

/// Merge adjacent matching scripts only when the final argument is one JS-dot code unit.
fn merge_scripts(latex: &mut String) {
  // Original regex: /(([\^_])\{[^{}]+)\}\2{(.\})$/
  let Some(content) = latex.strip_suffix('}') else {
    return;
  };
  let Some(argument) = content.chars().next_back() else {
    return;
  };
  if argument.len_utf16() != 1 || js_line_terminator(argument) {
    return;
  }
  let argument_start = content.len() - argument.len_utf8();
  let Some(start) = argument_start.checked_sub(2) else {
    return;
  };
  let bytes = latex.as_bytes();
  if !matches!(&bytes[start..argument_start], [b'^' | b'_', b'{']) || start == 0 || bytes[start - 1] != b'}' {
    return;
  }
  // The nearest preceding brace must open a nonempty argument without nested groups.
  let Some(open) = latex[..start - 1].rfind(['{', '}']) else {
    return;
  };
  if bytes[open] == b'{' && open > 0 && open + 1 < start - 1 && bytes[open - 1] == bytes[start] {
    latex.replace_range(start - 1..argument_start, "");
  }
}

/// An isolated Unicode-to-TeX map with creator and minimal-mode policies.
pub struct Transform {
  map: CharMap,
  creator: bool,
  minimal: bool,
}

impl Transform {
  /// Load package layers before preferences, ASCII overrides, and custom entries.
  pub fn new(mode: &str, options: MapOptions) -> Result<Self, String> {
    let creator = mode == "bibtex-creator";
    let minimal = mode == "minimal";
    // Creator mode uses the bibtex table, then applies creator-specific grouping below.
    let base = match mode {
      "bibtex" | "bibtex-creator" => &BIBTEX,
      "biblatex" => &BIBLATEX,
      "minimal" => &MINIMAL,
      _ => return Err(format!("unknown translation mode: {mode}")),
    };
    // Work on a deep copy so per-instance adjustments do not mutate shared table data.
    let mut map: CharMap = base.base.iter().map(|(key, entry)| ((*key).to_owned(), (*entry).into())).collect();
    // Package maps are layered in the requested order; later maps override earlier entries.
    for package in options.packages {
      if let Ok(index) = base.packages.binary_search_by_key(&package.as_str(), |(name, _)| *name) {
        map.extend(base.packages[index].1.iter().map(|(key, entry)| ((*key).to_owned(), (*entry).into())));
      }
    }
    for (preferred, forced) in [(Mode::Text, options.text), (Mode::Math, options.math)] {
      // Keep only the requested output mode for explicitly preferred characters.
      for character in forced.unwrap_or_default().chars() {
        let entry = map.get_mut(&character.to_string()).ok_or_else(|| format!("no mapping for preferred character: {character}"))?;
        let value = match preferred {
          Mode::Text => &entry.text,
          Mode::Math => &entry.math,
        };
        if let Some(value) = value {
          *entry = TeXChar::in_mode(preferred, value.clone());
        }
      }
    }
    // ASCII overrides restore bibtex mappings even when another map was selected.
    for character in options.ascii.unwrap_or_default().chars() {
      let key = character.to_string();
      if let Ok(index) = BIBTEX.base.binary_search_by_key(&key.as_str(), |(key, _)| *key) {
        map.insert(key, BIBTEX.base[index].1.into());
      }
    }
    if let Some(custom) = options.charmap {
      // Store custom entries under both normalization forms used by conversion.
      for (unicode, entry) in custom {
        map.insert(unicode.nfc().collect(), entry.clone());
        map.insert(unicode.nfd().collect(), entry);
      }
    }
    // Mark mappings that need a separator after a TeX control word.
    for entry in map.values_mut() {
      if entry.combining || entry.text.as_deref().is_some_and(ends_control_word) {
        entry.macrospacer = true;
      }
    }
    Ok(Self { map, creator, minimal })
  }

  /// Apply creator-mode grouping or retain a marker for later control-word spacing.
  fn braceorspace(&self, mode: Mode, text: &str, macrospacer: bool) -> String {
    // Preserve the argument group and add the outer group, for example \~{\^e} becomes {\~{\^e}}.
    if mode == Mode::Text && grouped_accent(text) {
      return format!("{{{text}}}");
    }
    // https://github.com/retorquere/zotero-better-bibtex/issues/1189
    // Needed so that composite characters are counted as single characters
    // for in-text citation generation. This messes with the {} cleanup
    // so the resulting TeX will be more verbose; doing this only for
    // bibtex because biblatex doesn't appear to need it.
    //
    // Only testing .text because that's the only place (so far)
    // that these have turned up.
    if mode == Mode::Text && self.creator {
      // These patterns identify TeX forms that bibtex creator must count as one unit.
      if creator_group(text) {
        return format!("{{{text}}}");
      }
      // Empty accent arguments count as a single character when wrapped as a group.
      // Original regex: /^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i
      if let Some(command) = text.strip_prefix('\\').and_then(|text| text.strip_suffix("{}")) {
        if ["L", "O", "AE", "AA", "DH", "DJ", "OE", "SS", "TH", "NG"].iter().any(|name| command.eq_ignore_ascii_case(name)) {
          return format!("{{\\{command}}}");
        }
      }
      // Separate a one-character accent argument so bibtex creator counts it as one unit.
      // Original regex: /^\\([a-z])\{([a-z0-9])\}$/i
      if let [b'\\', command, b'{', argument, b'}'] = text.as_bytes() {
        if command.is_ascii_alphabetic() && argument.is_ascii_alphanumeric() {
          return format!("{{\\{} {}}}", char::from(*command), char::from(*argument));
        }
      }
      // Group remaining composite TeX expressions unless already enclosed in braces.
      // Original regexes: /[\\_^]/ and /(^\{)|(\}$)/
      if text.encode_utf16().count() > 2 && text.contains(['\\', '_', '^']) && !text.starts_with('{') && !text.ends_with('}') {
        return format!("{{{text}}}");
      }
    }
    format!("{text}{}", if macrospacer { "\0" } else { "" })
  }

  /// Apply one combining mark, preferring explicit complete-sequence mappings.
  fn apply(&self, base: &TeXChar, marks: &str) -> Option<TeXChar> {
    // Prefer exact mappings for the complete text/math sequence over synthesized accents.
    for mode in [Mode::Text, Mode::Math] {
      if let Some(resolved) = base.get(mode).and_then(|text| self.map.get(&format!("{text}{marks}"))) {
        return Some(resolved.clone());
      }
    }
    // Otherwise use the combining-mark entry, which specifies its TeX macro and output mode.
    let (_, mode, command) = COMBINING.get(COMBINING.binary_search_by_key(&marks, |(key, _, _)| *key).ok()?)?;
    // Apply the entry only if the base mapping supports its output mode.
    let character = base.get(*mode)?;
    // Original regex: /[a-z]/i
    let is_macro = command.bytes().any(|byte| byte.is_ascii_alphabetic());
    // A bare TeX control word represents one character despite its string length.
    let is_single = character.chars().count() == 1 || is_control_word(character);
    let tex = if is_macro && is_single {
      format!("\\{command} {character}")
    } else if is_macro || !is_single {
      format!("\\{command}{{{character}}}")
    } else {
      format!("\\{command}{character}")
    };
    Some(TeXChar::in_mode(*mode, tex))
  }

  /// Transform NFD input to NFC LaTeX, accumulating package suggestions in options.
  pub fn tolatex(&self, text: &str, options: &mut TranslateOptions) -> String {
    // Output starts in text mode; each mapping may require switching modes.
    let mut mode = Mode::Text;
    // Delimiters used when switching into each mode, optionally protected by braces.
    let delimiter = |mode| match (mode, options.bracemath) {
      (Mode::Math, true) => "{$",
      (Mode::Math, false) => "$",
      (Mode::Text, true) => "$}",
      (Mode::Text, false) => "$",
    };
    let mut latex = String::new();
    // ccc = combining character code(s)
    // Capture either the special tie sequence, a base plus combining character codes, or one character.
    for InputUnit { matched, single, tie, combined, base, marks } in InputUnits(&text.nfd().collect::<String>()) {
      let mapped = if self.minimal {
        // Minimal mode intentionally performs only direct per-character table lookups.
        self.map.get(single).cloned()
      } else if tie.is_some_and(|tie| !self.map.contains_key(tie)) {
        // The tie sequence has a readable fallback when no explicit tie mapping exists.
        Some(TeXChar::in_mode(Mode::Text, "ia".into()))
      } else if let Some(entry) = tie.and_then(|key| self.map.get(key)).or_else(|| combined.and_then(|key| self.map.get(key))).or_else(|| self.map.get(single)) {
        // Exact full-sequence mappings take precedence over decomposing and composing marks.
        Some(entry.clone())
      } else if combined.is_some() {
        // For an unmapped base-plus-marks sequence, try mark orderings and partial combinations.
        // CCCs are the captured combining-mark characters; permutations handle order-sensitive recipes.
        let marks: Vec<char> = marks.chars().collect();
        let base = self.map.get(base).cloned().unwrap_or_else(|| TeXChar {
          text: Some(base.into()),
          math: Some(base.into()),
          ..TeXChar::default()
        });
        // Consume the longest prefix that can be mapped, leaving remaining marks for sequential application.
        let permutations = permutations(&marks);
        let resolved = (0..=marks.len())
          .rev()
          .find_map(|length| permutations.iter().find_map(|order| self.apply(&base, &order[..length].iter().collect::<String>()).map(|entry| (entry, order[length..].to_vec()))));
        let (entry, remaining) = resolved.unwrap_or((base, marks));
        remaining.into_iter().try_fold(entry, |entry, mark| self.apply(&entry, &mark.to_string()))
      } else {
        // No known mapping path applies; preserve the original matched input below.
        None
      };
      // Preserve unsupported characters verbatim rather than dropping them.
      let mapped = mapped.unwrap_or_else(|| TeXChar::in_mode(Mode::Text, matched.into()));
      // in and out of math mode
      let switched = mapped.get(mode).is_none();
      if switched {
        // A mapping absent from the current mode requires switching before appending it.
        mode = mode.other();
        latex.push_str(delimiter(mode));
      }
      // if we just switched out of math mode, and there's a lone sup/sub at the end, unpack it.
      // The extra option brace is for when we're not in bracemath mode (see switchTo)
      // This undo is limited to a trailing single-character script to keep ordinary groups intact.
      if switched && mode == Mode::Text {
        unpack_script(&mut latex);
      }
      // macrospacer \0 clean up below
      // A mapping may have no representation in the final active mode; skip that unit.
      let Some(text) = mapped.get(mode) else {
        continue;
      };
      latex.push_str(&self.braceorspace(mode, text, mapped.macrospacer));
      // only try to merge sup/sub if we were already in math mode, because if we were previously in text mode, testing for _^ is tricky.
      // Merge adjacent scripts only when no mode transition makes their grouping ambiguous.
      if !switched && mode == Mode::Math {
        merge_scripts(&mut latex);
      }
      if let Some(packages) = mapped.alt {
        // Report packages required for the selected alternate mapping to the caller.
        options.packages.extend(packages);
      }
    }
    // might still be in math mode at the end
    if mode == Mode::Math {
      latex.push_str(delimiter(Mode::Text));
    }
    if !options.preservemacrospacers {
      latex = replace_macro_spacers(&latex);
    }
    latex.nfc().collect()
  }
}

/// Thin WASM boundary; the Node adapter preserves the public JavaScript API.
#[wasm_bindgen]
pub struct RawTransform(Transform);

#[wasm_bindgen]
impl RawTransform {
  /// Decode mapping options once, then retain the Rust transformer in WASM.
  #[wasm_bindgen(constructor)]
  pub fn new(mode: &str, options: &str) -> Result<RawTransform, JsError> {
    Ok(Self(Transform::new(mode, serde_json::from_str(options)?).map_err(|error| JsError::new(&error))?))
  }

  /// Return translated text and hints without routing conversion through JavaScript.
  pub fn translate(&self, text: &str, bracemath: bool, preservemacrospacers: bool) -> String {
    let mut options = TranslateOptions {
      bracemath,
      preservemacrospacers,
      ..TranslateOptions::default()
    };
    let latex = self.0.tolatex(text, &mut options);
    serde_json::json!({ "latex": latex, "packages": options.packages }).to_string()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Cover grouping, normalization, math transitions, minimal passthrough, and spacing.
  #[test]
  fn translation_regressions() {
    for (mode, input, expected) in [
      ("biblatex", "££p", "\\pounds\\pounds p"),
      ("biblatex", "K\u{0305}", "$\\overline K$"),
      ("bibtex-creator", "Nguyễn, Xuân Thắng", "Nguy{\\~{\\^e}}n, Xu{\\^a}n Th{\\'{\\u a}}ng"),
      ("biblatex", "a\nb\rc\u{2028}d", "abcd"),
      ("minimal", "ñ", "ñ"),
    ] {
      assert_eq!(Transform::new(mode, MapOptions::default()).unwrap().tolatex(input, &mut TranslateOptions::default()), expected);
    }
  }

  /// Match JS whitespace and ordered replacement behavior for adjacent markers.
  #[test]
  fn macro_spacers() {
    assert_eq!(replace_macro_spacers("\\S\0 next\0, x\0y\0"), "\\S{} next, x y");
    assert_eq!(replace_macro_spacers("\0\u{feff}\0\u{0085}\0\0x"), "{}\u{feff} \u{0085} x");
    assert_eq!(replace_macro_spacers("\0\0 "), "{} ");
  }
}
