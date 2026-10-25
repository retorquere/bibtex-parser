//! Recognize title tokens without changing their source text. Rule priority determines both
//! token categories and sentence-casing decisions in `tex`. Handwritten recognizers match
//! prefixes; `recognize` selects the first successful rule, not the longest across categories.
//! Unicode scans reuse the existing category predicates instead of generating duplicate tables.
//! Recognition uses UTF-8 slices; token emission converts lengths to half-open Unicode scalar ranges.

use std::sync::OnceLock;

use unicode_general_category::{GeneralCategory, get_general_category};

/// Return the nonempty prefix satisfying a scalar predicate, stopping only at UTF-8 boundaries.
fn prefix_while(source: &str, mut predicate: impl FnMut(char) -> bool) -> Option<&str> {
    let end = source
        .find(|character| !predicate(character))
        .unwrap_or(source.len());
    (end > 0).then_some(&source[..end])
}

/// Recognize a complete tag through its first closing `>`; an unfinished opener consumes nothing.
fn markup(source: &str) -> Option<&str> {
    source.strip_prefix('<')?;
    let end = source.find('>')?;
    Some(&source[..end + 1])
}

/// Count leading ASCII digits in bytes; the returned offset is also a valid UTF-8 boundary.
fn ascii_digits(source: &str) -> usize {
    source.bytes().take_while(u8::is_ascii_digit).count()
}

/// Recognize lowercase ASCII ordinal suffixes only at a complete word boundary.
fn ordinal(source: &str) -> Option<&str> {
    let digits = ascii_digits(source);
    if digits == 0 || !matches!(source.get(digits..digits + 2)?, "st" | "nd" | "rd" | "th") {
        return None;
    }
    bounded(source, Some(&source[..digits + 2]))
}

/// Recognize an `@` handle with at least two ASCII alphanumeric/hyphen characters and a word boundary.
fn handle(source: &str) -> Option<&str> {
    let suffix = source.strip_prefix('@')?;
    let text = prefix_while(suffix, |character| {
        character.is_ascii_alphanumeric() || character == '-'
    })?;
    if text.len() < 2 {
        return None;
    }
    bounded(source, Some(&source[..text.len() + 1]))
}

/// Return a maximal Unicode word prefix, rejecting non-word starters.
/// Shared predicates keep recognition and casing on the same Unicode category tables.
fn word_run(source: &str) -> Option<&str> {
    prefix_while(source, is_word_character)
}

/// Extend an uppercase starter through dotted initials; fewer than two pairs reject the rule.
/// The caller checks the final word boundary before accepting the complete initialism.
fn initialism(source: &str) -> Option<&str> {
    let mut characters = source.char_indices();
    let mut end = 0;
    let mut pairs = 0;
    while let Some((_, character)) = characters.next()
        && character.is_uppercase()
        && let Some((offset, '.')) = characters.next()
    {
        end = offset + 1;
        pairs += 1;
    }
    (pairs >= 2).then_some(&source[..end])
}

/// Accept a prefix only before end-of-input or a non-word scalar, without consuming the boundary.
fn bounded<'source>(source: &'source str, text: Option<&'source str>) -> Option<&'source str> {
    let text = text?;
    (!source[text.len()..]
        .chars()
        .next()
        .is_some_and(is_word_character))
    .then_some(text)
}

/// English prepositions shared with the TypeScript tokenizer, decoded once from embedded JSON.
static PREPOSITIONS: OnceLock<Vec<&'static str>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SentenceTokenKind {
    Word,
    Domain,
    Whitespace,
    Number,
    Email,
    Handle,
    Website,
    Markup,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SentenceTokenSubtype {
    Word,
    Preposition,
    Acronym,
    Contraction,
    Ordinal,
}

#[derive(Debug, Clone)]
pub(crate) struct SentenceToken {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) kind: SentenceTokenKind,
    pub(crate) subtype: SentenceTokenSubtype,
    pub(crate) shape: String,
    pub(crate) sentence_start: bool,
    pub(crate) sub_sentence_start: bool,
}

impl SentenceToken {
    /// Recover this token's original characters without normalizing the surrounding source.
    pub(crate) fn text(&self, characters: &[char]) -> String {
        characters[self.start..self.end].iter().collect()
    }

    /// Count UTF-16 code units for the TypeScript string-length guess heuristic.
    pub(crate) fn text_len(&self, characters: &[char]) -> usize {
        characters[self.start..self.end]
            .iter()
            .map(|character| character.len_utf16())
            .sum()
    }
}

/// Tokenize title text while tracking the TypeScript sentence and colon-start state.
///
/// `characters` is the rendered field split into Unicode scalar values. Markup tags, whitespace,
/// and punctuation remain distinct; preposition phrases, contractions, acronyms, domains, URLs,
/// handles, numbers, and ordinals receive separate token kinds so casing and guessing can follow
/// the same branches as `tokenizer.ts`. Direct edge cases live in this module's tests;
/// shared parser cases live in
/// `test/other/sentence-case-utf16.bib` and its default snapshot. Token priority keeps letter-started
/// runs ahead of number matching, uses ASCII-only ordinal/version digits, and recognizes URLs only
/// with letter-bearing dotted host labels; only reference word-like tokens clear pending starts.
pub(crate) fn sentence_tokens(
    characters: &[char],
    preserve_sub_sentence: bool,
    recognize_markup: bool,
) -> Vec<SentenceToken> {
    let (mut position, mut sentence_start, mut sub_sentence_start) = (0, true, false);
    let source: String = characters.iter().collect();
    let mut remaining = source.as_str();
    let mut tokens = Vec::new();
    while position < characters.len() {
        let start = position;
        let (text, kind, subtype) = recognize(remaining, characters, position, recognize_markup);
        // Matchers return byte slices; only emitted ranges use Unicode scalar indices.
        let end = start + text.chars().count();
        remaining = &remaining[text.len()..];

        let token = SentenceToken {
            start,
            end,
            kind,
            subtype,
            shape: token_shape(&characters[start..end]),
            sentence_start: kind == SentenceTokenKind::Word && sentence_start,
            sub_sentence_start: kind == SentenceTokenKind::Word && sub_sentence_start,
        };
        let token_text = token.text(characters);
        if kind == SentenceTokenKind::Other {
            // Only terminal punctuation before whitespace/end resets sentence or colon state.
            if token_text.len() == 1
                && matches!(characters[start], '.' | '!' | '?')
                && (end == characters.len() || is_case_whitespace(characters[end]))
            {
                sentence_start = true;
            } else if preserve_sub_sentence
                && characters[start] == ':'
                && end < characters.len()
                && is_case_whitespace(characters[end])
            {
                sub_sentence_start = true;
            }
        }
        // These lexer categories consume pending starts; punctuation, whitespace, and fallback
        // tokens leave the state available for the next word.
        if matches!(
            kind,
            SentenceTokenKind::Word
                | SentenceTokenKind::Number
                | SentenceTokenKind::Email
                | SentenceTokenKind::Handle
                | SentenceTokenKind::Domain
                | SentenceTokenKind::Website
        ) {
            sentence_start = false;
            sub_sentence_start = false;
        }
        tokens.push(token);
        position = end.max(position + 1);
    }
    tokens
}

/// Select the first successful token rule; later rules never win merely by matching more bytes.
/// `position` is a scalar offset into `characters`, while `source` is its remaining UTF-8 suffix.
/// The final punctuation fallback guarantees a nonempty prefix for every nonempty source.
fn recognize<'source>(
    source: &'source str,
    characters: &[char],
    position: usize,
    recognize_markup: bool,
) -> (&'source str, SentenceTokenKind, SentenceTokenSubtype) {
    use SentenceTokenKind as Kind;
    use SentenceTokenSubtype as Subtype;

    if recognize_markup && let Some(text) = markup(source) {
        (text, Kind::Markup, Subtype::Word)
    } else if let Some(text) = prefix_while(source, is_case_whitespace) {
        (text, Kind::Whitespace, Subtype::Word)
    } else if let Some(text) = website(source) {
        (text, Kind::Website, Subtype::Word)
    } else if let Some(text) = email(source) {
        (text, Kind::Email, Subtype::Word)
    } else if let Some(text) = handle(source) {
        (text, Kind::Handle, Subtype::Word)
    } else if !inside_markup(characters, position)
        && let Some(text) = preposition(source)
    {
        // Markup content remains ordinary text; outside it, prepositions outrank domains/contractions.
        (text, Kind::Word, Subtype::Preposition)
    } else if let Some(text) = acronym(source) {
        (text, Kind::Word, Subtype::Acronym)
    } else if let Some(text) = ordinal(source) {
        (text, Kind::Word, Subtype::Ordinal)
    } else if let Some(text) = number(source) {
        (text, Kind::Number, Subtype::Word)
    } else if let Some(token) = word(source) {
        token
    } else {
        let end = if source.starts_with("...") {
            3
        } else {
            characters[position].len_utf8()
        };
        (&source[..end], Kind::Other, Subtype::Word)
    }
}

/// Recognize a letter-bearing word, then extend it through a contraction and dotted word labels.
/// Each domain label needs a letter; a domain retains the initial word's contraction subtype.
fn word(source: &str) -> Option<(&str, SentenceTokenKind, SentenceTokenSubtype)> {
    let text = word_run(source)?;
    if !text.chars().any(is_unicode_letter) {
        return None;
    }
    let mut end = text.len();
    let mut subtype = SentenceTokenSubtype::Word;
    if let Some(quote @ ('\'' | '\u{2019}')) = source[end..].chars().next()
        && let Some(contraction) = word_run(&source[end + quote.len_utf8()..])
    {
        // The reference accepts any word run after the apostrophe, including numeric-only suffixes.
        end += quote.len_utf8() + contraction.len();
        subtype = SentenceTokenSubtype::Contraction;
    }
    let mut kind = SentenceTokenKind::Word;
    while let Some(suffix) = source[end..].strip_prefix('.')
        && let Some(label) = word_run(suffix)
        && label.chars().any(is_unicode_letter)
    {
        end += 1 + label.len();
        kind = SentenceTokenKind::Domain;
    }
    Some((&source[..end], kind, subtype))
}

/// Detect words inside an HTML-style markup element, which TS tokenizes as word-joiner text.
///
/// Only complete tags before `start` affect depth: closing tags decrement it, declarations beginning
/// with `!` are ignored, and other opening tags increment it. This lightweight scan only prevents
/// preposition recognition inside markup; it is not a general HTML parser.
fn inside_markup(characters: &[char], start: usize) -> bool {
    let (mut position, mut depth) = (0, 0usize);
    while position < start {
        if characters[position] == '<'
            && let Some(relative_end) = characters[position..start]
                .iter()
                .position(|character| *character == '>')
        {
            let end = position + relative_end;
            if characters.get(position + 1) == Some(&'/') {
                depth = depth.saturating_sub(1);
            } else if characters.get(position + 1) != Some(&'!') {
                depth += 1;
            }
            position = end + 1;
            continue;
        }
        position += 1;
    }
    depth > 0
}

/// Find a TypeScript-style hyphenated run that ends before a non-word, non-hyphen token.
///
/// The first index identifies the initial word, and the returned index identifies the final
/// component. A following punctuation or whitespace token forms the boundary; another word or
/// hyphen does not. The combined run is one token for both guess and casing, preserving the first
/// component's subtype and capitalization state just like `tokenizer.ts`. The direct tokenizer
/// test and shared `sentence-case-utf16.bib` snapshot cover these grouping decisions.
pub(crate) fn hyphenated_end(
    tokens: &[SentenceToken],
    characters: &[char],
    start: usize,
) -> Option<usize> {
    if tokens.get(start)?.kind != SentenceTokenKind::Word {
        return None;
    }
    let mut end = start;
    while end + 2 < tokens.len()
        && tokens[end + 1].kind == SentenceTokenKind::Other
        && matches!(
            token_text(&tokens[end + 1], characters).as_str(),
            "-" | "\u{2013}"
        )
        && tokens[end + 2].kind == SentenceTokenKind::Word
    {
        end += 2;
    }
    let boundary = end + 1 == tokens.len()
        || (tokens[end + 1].kind != SentenceTokenKind::Word
            && !(tokens[end + 1].kind == SentenceTokenKind::Other
                && matches!(
                    token_text(&tokens[end + 1], characters).as_str(),
                    "-" | "\u{2013}"
                )));
    (end > start && boundary).then_some(end)
}

/// Build the tokenizer's case-shape string using TypeScript's number, case, and Unicode-category order.
/// Direct sentence-case cases and the shared sentence-case fixture cover its letter, number, and
/// punctuation shapes.
fn token_shape(characters: &[char]) -> String {
    let mut shape = String::new();
    for character in characters {
        let category = get_general_category(*character);
        shape.push(if is_unicode_number(*character) {
            'd'
        } else if character.to_lowercase().eq(character.to_uppercase()) {
            *character
        } else if matches!(
            category,
            GeneralCategory::UppercaseLetter | GeneralCategory::TitlecaseLetter
        ) {
            'X'
        } else if matches!(
            category,
            GeneralCategory::LowercaseLetter
                | GeneralCategory::ModifierLetter
                | GeneralCategory::OtherLetter
        ) {
            'x'
        } else {
            *character
        });
    }
    shape
}

/// Recover one token's original text using its internal half-open character range.
pub(crate) fn token_text(token: &SentenceToken, characters: &[char]) -> String {
    token.text(characters)
}

/// Consume an English preposition or multiword preposition at the current word boundary.
/// Compare all boundary-valid phrases so a rejected longer phrase can fall back to a shorter one.
/// The embedded list is decoded on first use; invalid bundled JSON is a build-data error and panics.
fn preposition(source: &str) -> Option<&str> {
    if !source.chars().next()?.is_alphabetic() {
        return None;
    }
    PREPOSITIONS
        .get_or_init(|| {
            serde_json::from_str(include_str!("../data/prepositions.json"))
                .expect("prepositions.json is a valid preposition list")
        })
        .iter()
        .filter_map(|preposition| match_preposition(source, preposition))
        .max_by_key(|text| text.len())
}

/// Match one preposition case-insensitively, allowing TypeScript whitespace between its words.
fn match_preposition<'source>(source: &'source str, preposition: &str) -> Option<&'source str> {
    let mut remaining = source;
    for expected in preposition.chars() {
        if expected == ' ' {
            let rest = remaining.trim_start_matches(is_case_whitespace);
            if rest.len() == remaining.len() {
                return None;
            }
            remaining = rest;
        } else {
            let actual = remaining.chars().next()?;
            if !actual.eq_ignore_ascii_case(&expected) {
                return None;
            }
            remaining = &remaining[actual.len_utf8()..];
        }
    }
    (!remaining.chars().next().is_some_and(is_word_character))
        .then_some(&source[..source.len() - remaining.len()])
}

/// Recognize dotted initialisms and lowercase `v.`/`vs.` aliases used by the reference tokenizer.
/// Uppercase `VS.` is intentionally left as punctuation plus a word; the shared fixture and direct
/// sentence-case regressions cover this case-sensitive distinction.
fn acronym(source: &str) -> Option<&str> {
    for abbreviation in ["vs.", "v."] {
        if let Some(remainder) = source.strip_prefix(abbreviation)
            && remainder.chars().next().is_some_and(is_case_whitespace)
        {
            return Some(&source[..abbreviation.len()]);
        }
    }
    bounded(source, initialism(source))
}

/// Recognize a boundary-terminated ASCII integer/version without accepting a partial Unicode suffix.
/// Letter-started versions such as `v2` belong to the ordinary word rule, not this numeric rule.
fn number(source: &str) -> Option<&str> {
    let mut end = ascii_digits(source);
    if end == 0 {
        return None;
    }
    while let Some(suffix) = source[end..].strip_prefix('.') {
        let digits = ascii_digits(suffix);
        if digits == 0 {
            // Leave terminal punctuation untouched; the Unicode-numeric rejection below is stricter.
            break;
        }
        end += 1 + digits;
    }
    let text = bounded(source, Some(&source[..end]))?;
    if let Some(remainder) = source[text.len()..].strip_prefix('.')
        && remainder.chars().next().is_some_and(char::is_numeric)
    {
        // A Unicode numeric suffix invalidates the whole number, rather than accepting its prefix.
        return None;
    }
    Some(text)
}

/// Recognize an ASCII email address before generic words or domains can split its components.
fn email(source: &str) -> Option<&str> {
    if !source.chars().next()?.is_ascii_alphanumeric() {
        return None;
    }
    // Validate the entire maximal candidate, never a valid prefix of a malformed longer address.
    let candidate = prefix_while(source, |character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '%' | '+' | '-' | '@')
    })?;
    let (local, host) = candidate.split_once('@')?;
    (local
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "._%+-".contains(character))
        && host.contains('.')
        && host
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-".contains(character))
        && !host.starts_with('.')
        && !host.ends_with('.'))
    .then_some(candidate)
}

/// Recognize all Unicode letters, numbers, and marks used by the TypeScript `LNM` pattern.
/// Unicode mark and number entries in the direct tokenizer test and shared sentence-case fixture
/// cover the category branches.
fn is_word_character(character: char) -> bool {
    is_unicode_letter(character)
        || is_unicode_number(character)
        || is_unicode_mark(character)
        || matches!(character, '\u{00ad}' | '\u{2060}')
}

/// Identify Unicode letter categories used by the TypeScript `\p{L}` class.
/// The direct sentence-case test and combining-mark fixture entry exercise non-ASCII letter runs.
fn is_unicode_letter(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
    )
}

/// Identify Unicode number categories used by the TypeScript `\p{N}` class.
/// The direct sentence-case test and Unicode-number fixture entry exercise this predicate.
fn is_unicode_number(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::DecimalNumber
            | GeneralCategory::LetterNumber
            | GeneralCategory::OtherNumber
    )
}

/// Identify all Unicode mark categories used by the TypeScript `\p{M}` class.
/// The direct sentence-case test and combining-mark fixture entry exercise this predicate.
fn is_unicode_mark(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::NonspacingMark
            | GeneralCategory::SpacingMark
            | GeneralCategory::EnclosingMark
    )
}

/// Recognize the exact whitespace characters accepted by the TypeScript sentence tokenizer.
pub(crate) fn is_case_whitespace(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n' | '\r' | '\u{00a0}')
}

/// Recognize the reference URL token only when its host contains valid dotted letter labels.
///
/// `source` starts with lowercase `http://` or `https://`. Each host label must contain a Unicode
/// letter, matching the tokenizer's `W(?:[.]W)+` rule; malformed hosts fall back to ordinary
/// tokens. The URL then extends to TypeScript whitespace, excluding terminal sentence punctuation.
/// The malformed-host entry in `test/other/sentence-case-utf16.bib` exercises the fallback branch.
fn website(source: &str) -> Option<&str> {
    let rest = source
        .strip_prefix("https://")
        .or_else(|| source.strip_prefix("http://"))?;
    let host_end = rest
        .find(|character| !is_word_character(character) && character != '.')
        .unwrap_or(rest.len());
    let host = rest[..host_end].trim_end_matches('.');
    let labels: Vec<_> = host.split('.').collect();
    if labels.len() < 2
        || labels
            .iter()
            .any(|label| label.is_empty() || !label.chars().any(is_unicode_letter))
    {
        return None;
    }

    Some(
        prefix_while(source, |character| !is_case_whitespace(character))?
            .trim_end_matches(['.', '!', '?']),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Measure first-use and warmed tokenization separately; run explicitly with release optimizations.
    /// Seven trials alternate traversal order and report the median to reduce scheduling/order noise.
    /// `TOKENIZER_BENCH_ITERATIONS` overrides the 2,000-iteration default; invalid values fail loudly.
    #[test]
    #[ignore = "manual tokenizer benchmark; use --release --ignored --nocapture"]
    fn benchmark_tokenization() {
        use std::hint::black_box;
        use std::time::Instant;

        let inputs: Vec<Vec<char>> = include_str!("../../test/other/sentence-case-utf16.bib")
            .lines()
            .chain([
                "A TITLE: AN EXPLANATION",
                "The Effect of DNA on RNA in Cells",
                "According to the State-of-the-Art Results",
                "Email a+b@example.org or Visit https://example.org/path?!",
                "An Ex<i>ample</i> with \u{1f600} and \u{301}\u{e9} Unicode",
            ])
            .map(|source| source.chars().collect())
            .collect();
        let started = Instant::now();
        black_box(sentence_tokens(black_box(&inputs[0]), true, true));
        println!("first tokenization: {:?}", started.elapsed());

        let iterations = std::env::var("TOKENIZER_BENCH_ITERATIONS")
            .map(|value| {
                value
                    .parse::<usize>()
                    .expect("benchmark iterations must be an integer")
            })
            .unwrap_or(2_000);
        let mut trials = Vec::new();
        for trial in 0..7 {
            let started = Instant::now();
            for iteration in 0..iterations {
                for offset in 0..inputs.len() {
                    let index = if (trial + iteration) % 2 == 0 {
                        offset
                    } else {
                        inputs.len() - offset - 1
                    };
                    black_box(sentence_tokens(black_box(&inputs[index]), true, true));
                }
            }
            trials.push(started.elapsed());
        }
        trials.sort();
        println!(
            "{} inputs x {iterations} iterations; trials: {trials:?}; median: {:?}",
            inputs.len(),
            trials[3]
        );
    }

    #[test]
    /// Lock down first-rule precedence, rejected boundaries, and Unicode callback fallbacks.
    fn recognition_priority_and_boundaries() {
        use SentenceTokenKind::*;
        use SentenceTokenSubtype as Subtype;

        for (source, text, kind, subtype) in [
            (
                "according\tto Results",
                "according\tto",
                Word,
                Subtype::Preposition,
            ),
            ("as long asx", "as", Word, Subtype::Preposition),
            ("inside.example", "inside", Word, Subtype::Preposition),
            ("and's", "and", Word, Subtype::Preposition),
            ("DNA Results", "DNA", Word, Subtype::Word),
            ("U.S.A. Results", "U.S.A.", Word, Subtype::Acronym),
            (
                "\u{24b6}.\u{24b6}.",
                "\u{24b6}.\u{24b6}.",
                Word,
                Subtype::Acronym,
            ),
            ("vs. Results", "vs.", Word, Subtype::Acronym),
            ("vs.", "vs", Word, Subtype::Word),
            ("VS. Results", "VS", Word, Subtype::Word),
            ("21st Results", "21st", Word, Subtype::Ordinal),
            ("21ST Results", "21ST", Word, Subtype::Word),
            ("v2.1 Results", "v2", Word, Subtype::Word),
            ("2.1 Results", "2.1", Number, Subtype::Word),
            ("2.\u{663}", "2", Other, Subtype::Word),
            (
                "don't.example",
                "don't.example",
                Domain,
                Subtype::Contraction,
            ),
            ("x'123", "x'123", Word, Subtype::Contraction),
            (
                "\u{301}\u{e9}2.example",
                "\u{301}\u{e9}2.example",
                Domain,
                Subtype::Word,
            ),
            ("\u{b2}Title", "\u{b2}Title", Word, Subtype::Word),
            ("\u{b2} Results", "\u{b2}", Other, Subtype::Word),
            ("a+b@example.org", "a+b@example.org", Email, Subtype::Word),
            ("@ab Results", "@ab", Handle, Subtype::Word),
            ("@ab\u{e9}", "@", Other, Subtype::Word),
            (
                "https://\u{e9}.example/path?!",
                "https://\u{e9}.example/path",
                Website,
                Subtype::Word,
            ),
            ("http://a.b.2/path", "http", Word, Subtype::Word),
            ("... Results", "...", Other, Subtype::Word),
        ] {
            let characters: Vec<char> = source.chars().collect();
            let tokens = sentence_tokens(&characters, true, true);
            let token = &tokens[0];
            assert_eq!(
                (token.text(&characters), token.kind, token.subtype),
                (text.to_owned(), kind, subtype),
                "{source:?}",
            );
        }
    }

    #[test]
    /// Verify scalar offsets and pending sentence/colon starts across markup and astral characters.
    fn scalar_offsets_markup_and_pending_starts() {
        let characters: Vec<char> = "\u{1f600} <i>Inside</i>: Next. Final".chars().collect();
        let tokens = sentence_tokens(&characters, true, true);
        let words: Vec<_> = tokens
            .iter()
            .filter(|token| token.kind == SentenceTokenKind::Word)
            .map(|token| {
                (
                    token.start,
                    token.end,
                    token.subtype,
                    token.sentence_start,
                    token.sub_sentence_start,
                )
            })
            .collect();
        assert_eq!(
            words,
            vec![
                (5, 11, SentenceTokenSubtype::Word, true, false),
                (17, 21, SentenceTokenSubtype::Word, false, true),
                (23, 28, SentenceTokenSubtype::Word, true, false),
            ]
        );
    }
}
