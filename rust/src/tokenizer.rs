//! Recognize title tokens without changing their source text. Rule priority determines both
//! exported token categories and sentence-casing decisions in `tex`. Internal ranges are
//! half-open Unicode scalar indices; only public token serialization converts them to UTF-16.

use serde::Serialize;
use unicode_general_category::{GeneralCategory, get_general_category};

/// English prepositions used by the TypeScript tokenizer, checked longest match first.
const PREPOSITIONS: &[&str] = &[
    "a",
    "about",
    "above",
    "according to",
    "across",
    "after",
    "against",
    "ahead of",
    "along",
    "although",
    "among",
    "an",
    "and",
    "apart from",
    "around",
    "as for",
    "as if",
    "as long as",
    "as of",
    "as per",
    "as regards",
    "as soon as",
    "as",
    "aside from",
    "at",
    "back to",
    "because of",
    "because",
    "before",
    "behind",
    "below",
    "beneath",
    "beside",
    "between",
    "but",
    "by",
    "close to",
    "down",
    "due to",
    "during",
    "except for",
    "far from",
    "for",
    "from",
    "if",
    "in",
    "inside of",
    "inside",
    "instead of",
    "into",
    "like",
    "near",
    "next to",
    "nor",
    "of",
    "off",
    "on",
    "onto",
    "or",
    "out",
    "outside of",
    "over",
    "owing to",
    "prior to",
    "pursuant to",
    "regardless of",
    "right of",
    "since",
    "so",
    "subsequent to",
    "the",
    "through",
    "to",
    "towards",
    "under",
    "underneath",
    "unless",
    "until",
    "up",
    "upon",
    "when",
    "while",
    "with",
    "within",
    "without",
    "yet",
];

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Token {
    #[serde(rename = "type")]
    kind: String,
    subtype: String,
    text: String,
    start: usize,
    end: usize,
    shape: String,
    sentence_start: bool,
    sub_sentence_start: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    hyphenated: Option<Vec<Token>>,
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
/// the same branches as `tokenizer.ts`. Direct edge cases live in
/// `sentence_case_matches_tokenizer_rules`; shared parser cases live in
/// `test/other/sentence-case-utf16.bib` and its default snapshot. Token priority keeps letter-started
/// runs ahead of number matching, uses ASCII-only ordinal/version digits, and recognizes URLs only
/// with letter-bearing dotted host labels; only reference word-like tokens clear pending starts.
pub(crate) fn sentence_tokens(
    characters: &[char],
    preserve_sub_sentence: bool,
    recognize_markup: bool,
) -> Vec<SentenceToken> {
    let (mut position, mut sentence_start, mut sub_sentence_start) = (0, true, false);
    let mut tokens = Vec::new();
    while position < characters.len() {
        let start = position;
        let (end, kind, subtype) = if recognize_markup
            && characters[position] == '<'
            && let Some(relative_end) = characters[position..].iter().position(|ch| *ch == '>')
        {
            (
                position + relative_end + 1,
                SentenceTokenKind::Markup,
                SentenceTokenSubtype::Word,
            )
        } else if is_case_whitespace(characters[position]) {
            let mut end = position + 1;
            while end < characters.len() && is_case_whitespace(characters[end]) {
                end += 1;
            }
            (
                end,
                SentenceTokenKind::Whitespace,
                SentenceTokenSubtype::Word,
            )
        } else if let Some(end) = website_end(characters, position) {
            (end, SentenceTokenKind::Website, SentenceTokenSubtype::Word)
        } else if let Some(end) = email_end(characters, position) {
            (end, SentenceTokenKind::Email, SentenceTokenSubtype::Word)
        } else if let Some(end) = handle_end(characters, position) {
            (end, SentenceTokenKind::Handle, SentenceTokenSubtype::Word)
        } else if !inside_markup(characters, position)
            && let Some(end) = preposition_end(characters, position)
        {
            (
                end,
                SentenceTokenKind::Word,
                SentenceTokenSubtype::Preposition,
            )
        } else if let Some(end) = acronym_end(characters, position) {
            (end, SentenceTokenKind::Word, SentenceTokenSubtype::Acronym)
        } else if let Some(end) = ordinal_end(characters, position) {
            (end, SentenceTokenKind::Word, SentenceTokenSubtype::Ordinal)
        // TypeScript's number rule is ASCII-only and follows letter-started words like `v2`.
        } else if !is_unicode_letter(characters[position])
            && let Some(end) = number_end(characters, position)
        {
            (end, SentenceTokenKind::Number, SentenceTokenSubtype::Word)
        } else if let Some(mut end) = word_token_end(characters, position) {
            let mut subtype = SentenceTokenSubtype::Word;
            if end < characters.len() && matches!(characters[end], '\'' | '\u{2019}') {
                let contraction_end = word_end(characters, end + 1);
                if contraction_end > end + 1 {
                    end = contraction_end;
                    subtype = SentenceTokenSubtype::Contraction;
                }
            }
            let mut domain_end = end;
            while domain_end + 1 < characters.len() && characters[domain_end] == '.' {
                let label_start = domain_end + 1;
                let label_end = word_end(characters, label_start);
                // TypeScript's domain rule requires at least one letter in every dotted label.
                if label_end == label_start
                    || !characters[label_start..label_end]
                        .iter()
                        .any(|character| is_unicode_letter(*character))
                {
                    break;
                }
                domain_end = label_end;
            }
            if domain_end > end {
                (domain_end, SentenceTokenKind::Domain, subtype)
            } else {
                (end, SentenceTokenKind::Word, subtype)
            }
        } else {
            let end = if position + 3 <= characters.len()
                && characters[position..position + 3] == ['.', '.', '.']
            {
                position + 3
            } else {
                position + 1
            };
            (end, SentenceTokenKind::Other, SentenceTokenSubtype::Word)
        };

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

/// Tokenize text using the TypeScript `tokenize()` result shape.
/// Unlike title rendering, this public API does not hide HTML tags behind markup tokens.
/// Hyphenated runs become one token while retaining their component tokens for callers.
pub(crate) fn tokenize(text: &str) -> Vec<Token> {
    let characters: Vec<char> = text.chars().collect();
    let tokens = sentence_tokens(&characters, true, false);
    let mut result = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        if let Some(end) = hyphenated_end(&tokens, &characters, index) {
            let parts = tokens[index..=end]
                .iter()
                .map(|token| public_token(token, &characters, None))
                .collect();
            let shape = tokens[index..=end]
                .iter()
                .map(|token| token.shape.as_str())
                .collect();
            let combined = SentenceToken {
                start: tokens[index].start,
                end: tokens[end].end,
                kind: tokens[index].kind,
                subtype: tokens[index].subtype,
                shape,
                sentence_start: tokens[index].sentence_start,
                sub_sentence_start: tokens[index].sub_sentence_start,
            };
            result.push(public_token(&combined, &characters, Some(parts)));
            index = end + 1;
        } else {
            result.push(public_token(&tokens[index], &characters, None));
            index += 1;
        }
    }
    result
}

/// Convert internal categories and half-open scalar ranges to the JavaScript token contract.
/// Public `end` is inclusive and measured in UTF-16 code units, including surrogate pairs.
fn public_token(
    token: &SentenceToken,
    characters: &[char],
    hyphenated: Option<Vec<Token>>,
) -> Token {
    let text = token.text(characters);
    let (kind, subtype) = match token.kind {
        SentenceTokenKind::Word => (
            "word",
            match token.subtype {
                SentenceTokenSubtype::Word => "",
                SentenceTokenSubtype::Preposition => "preposition",
                SentenceTokenSubtype::Acronym => "acronym",
                SentenceTokenSubtype::Contraction => "contraction",
                SentenceTokenSubtype::Ordinal => "ordinal",
            },
        ),
        SentenceTokenKind::Domain => ("domain", ""),
        SentenceTokenKind::Whitespace => ("whitespace", ""),
        SentenceTokenKind::Number => ("number", ""),
        SentenceTokenKind::Email => ("email", ""),
        SentenceTokenKind::Handle => ("handle", ""),
        SentenceTokenKind::Website => ("website", ""),
        SentenceTokenKind::Markup => ("word", ""),
        SentenceTokenKind::Other => {
            let next_is_whitespace =
                token.end == characters.len() || is_case_whitespace(characters[token.end]);
            if text == "..." {
                ("punctuation", "ellipsis")
            } else if text == ":" && next_is_whitespace {
                ("punctuation", "colon")
            } else if text.len() == 1
                && matches!(text.as_str(), "." | "!" | "?")
                && next_is_whitespace
            {
                ("punctuation", "end")
            } else if text
                .chars()
                .all(is_unicode_punctuation)
            {
                ("punctuation", "")
            } else {
                ("other", "")
            }
        }
    };
    let start = characters[..token.start]
        .iter()
        .map(|character| character.len_utf16())
        .sum();
    let end = characters[..token.end]
        .iter()
        .map(|character| character.len_utf16())
        .sum::<usize>()
        .saturating_sub(1);
    Token {
        kind: kind.to_string(),
        subtype: subtype.to_string(),
        text,
        start,
        end,
        shape: token.shape.clone(),
        sentence_start: token.sentence_start,
        sub_sentence_start: token.sub_sentence_start,
        hyphenated,
    }
}

fn is_unicode_punctuation(character: char) -> bool {
    matches!(
        get_general_category(character),
        GeneralCategory::ConnectorPunctuation
            | GeneralCategory::DashPunctuation
            | GeneralCategory::OpenPunctuation
            | GeneralCategory::ClosePunctuation
            | GeneralCategory::InitialPunctuation
            | GeneralCategory::FinalPunctuation
            | GeneralCategory::OtherPunctuation
    )
}

/// Detect words inside an HTML-style markup element, which TS tokenizes as word-joiner text.
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
fn preposition_end(characters: &[char], start: usize) -> Option<usize> {
    if !characters[start].is_alphabetic() {
        return None;
    }
    PREPOSITIONS
        .iter()
        .filter_map(|preposition| match_preposition(characters, start, preposition))
        .max()
}

/// Match one preposition case-insensitively, allowing TypeScript whitespace between its words.
fn match_preposition(characters: &[char], start: usize, preposition: &str) -> Option<usize> {
    let mut index = start;
    for expected in preposition.chars() {
        if expected == ' ' {
            if index >= characters.len() || !is_case_whitespace(characters[index]) {
                return None;
            }
            while index < characters.len() && is_case_whitespace(characters[index]) {
                index += 1;
            }
        } else if index >= characters.len() || !characters[index].eq_ignore_ascii_case(&expected) {
            return None;
        } else {
            index += 1;
        }
    }
    (index == characters.len() || !is_word_character(characters[index])).then_some(index)
}

/// Recognize dotted initialisms and lowercase `v.`/`vs.` aliases used by the reference tokenizer.
/// Uppercase `VS.` is intentionally left as punctuation plus a word; the shared fixture and direct
/// sentence-case regressions cover this case-sensitive distinction.
fn acronym_end(characters: &[char], start: usize) -> Option<usize> {
    for abbreviation in ["vs.", "v."] {
        let end = start + abbreviation.chars().count();
        if end <= characters.len()
            && characters[start..end]
                .iter()
                .zip(abbreviation.chars())
                .all(|(actual, expected)| *actual == expected)
            && end < characters.len()
            && is_case_whitespace(characters[end])
        {
            return Some(end);
        }
    }
    let mut index = start;
    let mut pairs = 0;
    while index + 1 < characters.len()
        && characters[index].is_uppercase()
        && characters[index + 1] == '.'
    {
        pairs += 1;
        index += 2;
    }
    (pairs >= 2 && (index == characters.len() || !is_word_character(characters[index])))
        .then_some(index)
}

/// Recognize lowercase ASCII integer ordinals such as `21st` before the general number token.
/// Uppercase suffixes remain separate tokens, matching the case-sensitive TypeScript rule; the
/// direct sentence-case cases exercise ordinal handling.
fn ordinal_end(characters: &[char], start: usize) -> Option<usize> {
    if !characters[start].is_ascii_digit() {
        return None;
    }
    let digits_end = number_digits_end(characters, start);
    for suffix in ["st", "nd", "rd", "th"] {
        let end = digits_end + suffix.len();
        if end <= characters.len()
            && characters[digits_end..end]
                .iter()
                .zip(suffix.chars())
                .all(|(actual, expected)| *actual == expected)
            && (end == characters.len() || !is_word_character(characters[end]))
        {
            return Some(end);
        }
    }
    None
}

/// Recognize ASCII digits and their optional lowercase `v` version prefix.
/// Letter-starting version text is dispatched as a word before this rule, matching lexer priority;
/// `The v2.1 Results` in the shared fixture locks that behavior.
fn number_end(characters: &[char], start: usize) -> Option<usize> {
    let number_start = if characters[start] == 'v'
        && characters
            .get(start + 1)
            .is_some_and(|character| character.is_numeric())
    {
        start + 1
    } else {
        start
    };
    if !characters[number_start].is_ascii_digit() {
        return None;
    }
    let mut end = number_digits_end(characters, number_start);
    while end + 1 < characters.len() && characters[end] == '.' && characters[end + 1].is_numeric() {
        end = number_digits_end(characters, end + 1);
    }
    (end == characters.len() || !is_word_character(characters[end])).then_some(end)
}

/// Consume the consecutive digits used by number and ordinal token recognition.
fn number_digits_end(characters: &[char], start: usize) -> usize {
    let mut end = start;
    while end < characters.len() && characters[end].is_ascii_digit() {
        end += 1;
    }
    end
}

/// Recognize an ASCII email address before generic words or domains can split its components.
fn email_end(characters: &[char], start: usize) -> Option<usize> {
    if !characters[start].is_ascii_alphanumeric() {
        return None;
    }
    let mut end = start;
    while end < characters.len()
        && (characters[end].is_ascii_alphanumeric()
            || matches!(characters[end], '.' | '_' | '%' | '+' | '-' | '@'))
    {
        end += 1;
    }
    let candidate: String = characters[start..end].iter().collect();
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
    .then_some(end)
}

/// Recognize a social handle with at least two ASCII alphanumeric or hyphen characters.
fn handle_end(characters: &[char], start: usize) -> Option<usize> {
    if characters[start] != '@' {
        return None;
    }
    let mut end = start + 1;
    while end < characters.len()
        && (characters[end].is_ascii_alphanumeric() || characters[end] == '-')
    {
        end += 1;
    }
    (end - start >= 3 && (end == characters.len() || !is_word_character(characters[end])))
        .then_some(end)
}

/// Consume Unicode letters, numbers, combining marks, soft hyphens, and word joiners.
fn word_end(characters: &[char], start: usize) -> usize {
    let mut end = start;
    while end < characters.len() && is_word_character(characters[end]) {
        end += 1;
    }
    end
}

/// Return the end of a Unicode word token, which must contain at least one letter.
///
/// `start` is the first code point in a run of TypeScript `LNM` characters. Numeric-only and
/// mark-only runs are left to the number or fallback lexer branches, while mixed runs containing
/// a Unicode letter match the reference `W` pattern. Unicode-number cases in
/// `sentence_case_matches_tokenizer_rules` and the shared sentence-case fixture exercise this
/// distinction.
fn word_token_end(characters: &[char], start: usize) -> Option<usize> {
    let end = word_end(characters, start);
    characters[start..end]
        .iter()
        .any(|character| is_unicode_letter(*character))
        .then_some(end)
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

/// Compare an ASCII marker against a character slice without allocating a temporary string.
fn starts_with_ascii(characters: &[char], start: usize, marker: &str) -> bool {
    let marker: Vec<char> = marker.chars().collect();
    characters
        .get(start..start + marker.len())
        .is_some_and(|candidate| {
            candidate
                .iter()
                .zip(marker.iter())
                .all(|(actual, expected)| actual == expected)
        })
}

/// Recognize the reference URL token only when its host contains valid dotted letter labels.
///
/// `start` points at lowercase `http://` or `https://`. Each host label must contain a Unicode
/// letter, matching the tokenizer's `W(?:[.]W)+` rule; malformed hosts fall back to ordinary
/// tokens. The URL then extends to TypeScript whitespace, excluding terminal sentence punctuation.
/// The malformed-host entry in `test/other/sentence-case-utf16.bib` exercises the fallback branch.
fn website_end(characters: &[char], start: usize) -> Option<usize> {
    let scheme_length = if starts_with_ascii(characters, start, "https://") {
        8
    } else if starts_with_ascii(characters, start, "http://") {
        7
    } else {
        return None;
    };
    let host_start = start + scheme_length;
    let mut host_end = host_start;
    while host_end < characters.len()
        && (is_word_character(characters[host_end]) || characters[host_end] == '.')
    {
        host_end += 1;
    }
    let host: String = characters[host_start..host_end].iter().collect();
    let host = host.trim_end_matches('.');
    let labels: Vec<_> = host.split('.').collect();
    if labels.len() < 2
        || labels
            .iter()
            .any(|label| label.is_empty() || !label.chars().any(is_unicode_letter))
    {
        return None;
    }

    let mut end = start;
    while end < characters.len() && !is_case_whitespace(characters[end]) {
        end += 1;
    }
    while end > start && matches!(characters[end - 1], '.' | '!' | '?') {
        end -= 1;
    }
    Some(end)
}
