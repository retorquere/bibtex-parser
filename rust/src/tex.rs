//! Parse field fragments into a source-spanned TeX AST, then render them according to field mode.
//! Parsing owns groups, environments, macro arguments, and literal command boundaries. Rendering
//! owns Unicode conversion, supported markup, and unsupported-command policy. Title casing runs
//! afterward, using temporary root-group markers to restore author-supplied case protection.

use crate::tokenizer::{
    SentenceToken, SentenceTokenKind, SentenceTokenSubtype, hyphenated_end, is_case_whitespace,
    sentence_tokens, token_text,
};
use std::collections::{HashMap, HashSet};

/// Locate the literal contents of `\verb` or `\path` starting at a backslash.
///
/// The character immediately after the name must be non-alphanumeric. It closes its own
/// literal, except that `\path{...}` closes on `}`. The first closing delimiter wins:
/// braces do not nest, backslashes do not escape delimiters, and `*` is a delimiter.
/// The returned character-index range excludes both delimiters; `range.end + 1` is the
/// first character after the command. Missing delimiters return `None` without consuming input.
///
/// Both BibTeX value scanning and TeX AST construction use this rule so literal braces,
/// quotes, dollars, and comments cannot be interpreted before the TeX parser sees them.
pub(crate) fn verbatim_range(chars: &[char], start: usize) -> Option<std::ops::Range<usize>> {
    let source = chars.get(start..)?;
    let path = source.starts_with(&['\\', 'p', 'a', 't', 'h']);
    if !path && !source.starts_with(&['\\', 'v', 'e', 'r', 'b']) {
        return None;
    }
    let delimiter_position = start + 5;
    let delimiter = *chars.get(delimiter_position)?;
    if delimiter.is_alphanumeric() {
        return None;
    }
    let closing_delimiter = if path && delimiter == '{' {
        '}'
    } else {
        delimiter
    };
    let content_start = delimiter_position + 1;
    let content_end = content_start
        + chars[content_start..]
            .iter()
            .position(|character| *character == closing_delimiter)?;
    Some(content_start..content_end)
}

/// A source position with a UTF-16 offset and 1-based line and column coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SourcePosition {
    /// UTF-16 code-unit offset from the beginning of the source.
    pub(crate) offset: usize,
    /// 1-based source line.
    pub(crate) line: usize,
    /// 1-based UTF-16 column within the source line.
    pub(crate) column: usize,
}

/// The half-open source range occupied by a TeX AST node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SourceSpan {
    /// Inclusive start position.
    pub(crate) start: SourcePosition,
    /// Exclusive end position.
    pub(crate) end: SourcePosition,
}

/// A TeX parse result whose span covers the complete source fragment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Ast {
    /// Top-level source nodes in input order.
    pub(crate) content: Vec<Node>,
    /// Full source range, including whitespace and comments.
    pub(crate) span: SourceSpan,
}

/// A structural node in the TeX fragment parser's syntax tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Node {
    /// Ordinary source characters kept together until a syntax boundary.
    String(String, SourceSpan),
    /// A run of inter-token spacing, preserving separators that are not syntax.
    Whitespace(String, SourceSpan),
    /// A paragraph break or blank-line separator between TeX segments.
    Parbreak(SourceSpan),
    /// A TeX comment and its parser metadata; its span may include leading space or one line ending.
    Comment {
        /// Text after `%`, excluding the line ending.
        content: String,
        /// Source range, possibly including leading whitespace or one line ending.
        span: SourceSpan,
        /// Whether the comment follows content on the same line.
        sameline: bool,
        /// Whether horizontal whitespace precedes `%` on the same line.
        leading_whitespace: bool,
        /// Whether a separate paragraph-break node follows the comment.
        suffix_parbreak: bool,
    },
    /// A braced group whose delimiters are retained until rendering.
    Group(Vec<Node>, SourceSpan),
    /// A custom macro replacement visited as an argument subtree, not as field-root nodes.
    Expansion(Vec<Node>, SourceSpan),
    /// A math fragment whose macros use math-mode mappings and arity rules.
    InlineMath(Vec<Node>, SourceSpan),
    /// A matched environment's name and recursively parsed body.
    Environment {
        name: String,
        content: Vec<Node>,
        span: SourceSpan,
    },
    /// Literal contents delimited by the TeX `\verb` or `\path` macro.
    Verb(String, SourceSpan),
    /// A macro node with its name, parsed arguments, and command span.
    Macro {
        name: String,
        arguments: Vec<Vec<Node>>,
        span: SourceSpan,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MathDelimiter {
    Dollar,
    Parenthesis,
    Bracket,
}

#[derive(Debug, Clone, Copy)]
/// One entry in the `unicode2latex` conversion table.
struct UnicodeMapping {
    key: &'static str,
    text: Option<&'static str>,
    math: Option<&'static str>,
    combining: Option<&'static str>,
}

include!("unicode_tables.rs");

/// Recursive-descent parser state for one TeX fragment.
struct Parser {
    chars: Vec<char>,
    positions: Vec<SourcePosition>,
    position: usize,
    /// Active environment names; inner parsers return parent terminators without consuming them.
    environment_ends: Vec<String>,
    macro_definitions: HashMap<String, Vec<Node>>,
}

impl Parser {
    /// Create a character-indexed parser over a field value.
    fn new(source: &str) -> Self {
        Self::new_with_macro_definitions(source, HashMap::new())
    }

    /// Initialize a scalar-indexed parser with reusable macros and UTF-16 source-boundary metadata.
    /// Offsets start at zero; lines and columns start at one, and columns count UTF-16 code units.
    fn new_with_macro_definitions(
        source: &str,
        macro_definitions: HashMap<String, Vec<Node>>,
    ) -> Self {
        let chars: Vec<char> = source.chars().collect();
        let mut positions = Vec::with_capacity(chars.len() + 1);
        let (mut offset, mut line, mut column) = (0, 1, 1);
        positions.push(SourcePosition {
            offset,
            line,
            column,
        });
        for ch in &chars {
            offset += ch.len_utf16();
            if *ch == '\n' {
                line += 1;
                column = 1;
            } else {
                column += ch.len_utf16();
            }
            positions.push(SourcePosition {
                offset,
                line,
                column,
            });
        }
        Self {
            chars,
            positions,
            position: 0,
            environment_ends: Vec::new(),
            macro_definitions,
        }
    }

    /// Convert character-indexed parser bounds into a UTF-16 source range.
    fn span(&self, start: usize, end: usize) -> SourceSpan {
        SourceSpan {
            start: self.positions[start],
            end: self.positions[end],
        }
    }

    /// Translate a UTF-16 source offset back to the parser's character index.
    /// Panics if the offset is not one of the recorded scalar boundaries.
    fn char_index(&self, offset: usize) -> usize {
        self.positions
            .binary_search_by_key(&offset, |position| position.offset)
            .expect("source positions are recorded at every character boundary")
    }

    /// Return a node's span when comment metadata needs to inspect its predecessor.
    fn node_span(&self, node: &Node) -> SourceSpan {
        match node {
            Node::String(_, span)
            | Node::Whitespace(_, span)
            | Node::Parbreak(span)
            | Node::Group(_, span)
            | Node::Expansion(_, span)
            | Node::InlineMath(_, span)
            | Node::Verb(_, span) => *span,
            Node::Comment { span, .. }
            | Node::Environment { span, .. }
            | Node::Macro { span, .. } => *span,
        }
    }

    /// Parse nodes until EOF or a terminator owned by this recursive context is reached.
    /// Group and math closes consume their delimiters; environment recovery can hand an outer
    /// terminator back to its owner. The boolean reports a matched close, not merely EOF.
    fn sequence(
        &mut self,
        grouped: bool,
        math: Option<MathDelimiter>,
        environment_end: Option<&str>,
    ) -> (Vec<Node>, bool) {
        let mut nodes = Vec::new();
        let mut text = String::new();
        let mut text_start = None;
        let mut closed = false;
        while self.position < self.chars.len() {
            match self.chars[self.position] {
                // A closing brace ends only a nested sequence; at top level it remains text.
                '}' if grouped => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    self.position += 1;
                    closed = true;
                    break;
                }
                '$' if math == Some(MathDelimiter::Dollar) => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    self.position += 1;
                    closed = true;
                    break;
                }
                '$' if math.is_none() => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    self.position += 1;
                    let (content, _) =
                        self.sequence(false, Some(MathDelimiter::Dollar), environment_end);
                    nodes.push(Node::InlineMath(content, self.span(start, self.position)));
                }
                '\\' if math == Some(MathDelimiter::Parenthesis)
                    && self.chars.get(self.position + 1) == Some(&')') =>
                {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    self.position += 2;
                    closed = true;
                    break;
                }
                '\\' if math == Some(MathDelimiter::Bracket)
                    && self.chars.get(self.position + 1) == Some(&']') =>
                {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    self.position += 2;
                    closed = true;
                    break;
                }
                '\\' if math.is_none() && self.chars.get(self.position + 1) == Some(&'(') => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    self.position += 2;
                    let (content, _) =
                        self.sequence(false, Some(MathDelimiter::Parenthesis), environment_end);
                    nodes.push(Node::InlineMath(content, self.span(start, self.position)));
                }
                '\\' if math.is_none() && self.chars.get(self.position + 1) == Some(&'[') => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    self.position += 2;
                    let (content, _) =
                        self.sequence(false, Some(MathDelimiter::Bracket), environment_end);
                    nodes.push(Node::InlineMath(content, self.span(start, self.position)));
                }
                '_' | '^' if math.is_some() => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    let name = if self.chars[self.position] == '_' {
                        "math_"
                    } else {
                        "math^"
                    };
                    self.position += 1;
                    self.skip_argument_space();
                    let arguments = if self.position < self.chars.len() {
                        vec![self.argument(math, environment_end)]
                    } else {
                        Vec::new()
                    };
                    nodes.push(Node::Macro {
                        name: name.to_string(),
                        arguments,
                        span: self.span(start, self.position.min(start + 1)),
                    });
                }
                '{' => {
                    // Retain group structure so rendering and later case-protection passes can inspect it.
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    self.position += 1;
                    let (content, matched) = self.sequence(true, math, environment_end);
                    if matched {
                        nodes.push(Node::Group(content, self.span(start, self.position)));
                    } else {
                        // A missing close must not hide the opener or discard the content parsed so far.
                        nodes.push(Node::String("{".to_string(), self.span(start, start + 1)));
                        nodes.extend(content);
                    }
                }
                '\\' => {
                    // A backslash introduces a macro name, then parsing attaches its arguments.
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    match self.parse_macro(math, environment_end) {
                        Node::Macro {
                            name,
                            arguments,
                            span,
                        } if name == "begin" => {
                            let environment = arguments
                                .first()
                                .map(|argument| serialize_argument(argument))
                                .unwrap_or_default()
                                .trim()
                                .to_string();
                            if environment.is_empty() {
                                nodes.push(Node::Macro {
                                    name,
                                    arguments,
                                    span,
                                });
                            } else {
                                // A nested parser may return a parent's end token for its owner to consume.
                                self.environment_ends.push(environment.clone());
                                let (content, matched) =
                                    self.sequence(false, math, Some(&environment));
                                self.environment_ends.pop();
                                if matched {
                                    nodes.push(Node::Environment {
                                        name: environment,
                                        content,
                                        span: self.span(start, self.position),
                                    });
                                } else {
                                    // An unclosed environment falls back to its opening macro and body,
                                    // rather than inventing a closing delimiter or losing source content.
                                    nodes.push(Node::Macro {
                                        name,
                                        arguments,
                                        span,
                                    });
                                    nodes.extend(content);
                                }
                            }
                        }
                        Node::Macro {
                            name,
                            arguments,
                            span: _,
                        } if name == "end"
                            && environment_end.is_some_and(|expected| {
                                arguments.first().is_some_and(|argument| {
                                    serialize_argument(argument).trim() == expected
                                })
                            }) =>
                        {
                            // This end macro was consumed by parse_macro; only its owning sequence closes.
                            return (nodes, true);
                        }
                        Node::Macro {
                            name, arguments, ..
                        } if name == "end"
                            && arguments.first().is_some_and(|argument| {
                                let end_name = serialize_argument(argument).trim().to_string();
                                self.environment_ends
                                    .iter()
                                    .rev()
                                    .skip(1)
                                    .any(|parent| parent == &end_name)
                            }) =>
                        {
                            // Leave a parent terminator untouched so its enclosing sequence can close.
                            self.position = start;
                            return (nodes, false);
                        }
                        Node::Macro { name, .. } if name == "ifdefined" => {
                            // Conditional execution is unsupported; skip both branches as one nested block.
                            self.skip_ifdefined();
                        }
                        Node::Macro { name, .. } if name == "else" || name == "fi" => {}
                        Node::Macro {
                            name,
                            arguments,
                            span,
                        } if name == "newcommand" || name == "ProvideTextCommandDefault" => {
                            if !self.register_macro(&arguments) {
                                // Keep malformed definitions visible to the renderer's unsupported policy.
                                nodes.push(Node::Macro {
                                    name,
                                    arguments,
                                    span,
                                });
                            }
                        }
                        Node::Macro {
                            name,
                            arguments,
                            span,
                        } if self.macro_definitions.contains_key(&name) => {
                            nodes.push(Node::Expansion(
                                self.expand_macro(&name, 0, &arguments, span),
                                span,
                            ));
                        }
                        macro_node => nodes.push(macro_node),
                    }
                }
                '%' => {
                    // Keep comments as distinct AST nodes so later visitors can ignore them without
                    // collapsing adjacent text and whitespace boundaries together.
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let marker = self.position;
                    let line = self.positions[marker].line;
                    let mut comment_start = marker;
                    let mut leading_whitespace = false;
                    let mut sameline = nodes.last().is_some_and(|node| {
                        !matches!(node, Node::Parbreak(_)) && self.node_span(node).end.line == line
                    });
                    if let Some(Node::Whitespace(content, span)) = nodes.last() {
                        let whitespace_has_line_break = content.contains(['\n', '\r']);
                        comment_start = self.char_index(span.start.offset);
                        leading_whitespace = !whitespace_has_line_break;
                        sameline &= !whitespace_has_line_break;
                        nodes.pop();
                    }
                    let content_start = self.position + 1;
                    while self.position < self.chars.len()
                        && self.chars[self.position] != '\n'
                        && self.chars[self.position] != '\r'
                    {
                        self.position += 1;
                    }
                    let comment = self.chars[content_start..self.position].iter().collect();
                    let content_end = self.position;
                    let mut line_breaks = 0;
                    let mut line_ending_end = content_end;
                    let mut lookahead = content_end;
                    while lookahead < self.chars.len() {
                        match self.chars[lookahead] {
                            '\n' => {
                                line_breaks += 1;
                                lookahead += 1;
                                line_ending_end = lookahead;
                            }
                            '\r' => {
                                line_breaks += 1;
                                lookahead += 1;
                                if self.chars.get(lookahead) == Some(&'\n') {
                                    lookahead += 1;
                                }
                                line_ending_end = lookahead;
                            }
                            _ => break,
                        }
                        while lookahead < self.chars.len()
                            && !matches!(self.chars[lookahead], '\n' | '\r')
                            && self.chars[lookahead].is_whitespace()
                        {
                            lookahead += 1;
                        }
                    }
                    let suffix_parbreak = line_breaks > 1;
                    if line_breaks > 0 {
                        self.position = lookahead;
                    }
                    nodes.push(Node::Comment {
                        content: comment,
                        span: self.span(
                            comment_start,
                            if line_breaks == 0 || suffix_parbreak {
                                content_end
                            } else {
                                lookahead
                            },
                        ),
                        sameline,
                        leading_whitespace,
                        suffix_parbreak,
                    });
                    if suffix_parbreak {
                        nodes.push(Node::Parbreak(self.span(content_end, line_ending_end)));
                    }
                }
                // Keep non-ASCII spacing characters as text so rendering preserves their width.
                ch if ch.is_ascii_whitespace() && !matches!(ch, '\n' | '\r') => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    let mut whitespace = String::new();
                    while self.position < self.chars.len()
                        && self.chars[self.position].is_ascii_whitespace()
                        && !matches!(self.chars[self.position], '\n' | '\r')
                    {
                        whitespace.push(self.chars[self.position]);
                        self.position += 1;
                    }
                    Self::push_whitespace(&mut nodes, whitespace, self.span(start, self.position));
                }
                '\n' | '\r' => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    let mut line_breaks = 0;
                    while self.position < self.chars.len() {
                        match self.chars[self.position] {
                            '\n' => {
                                line_breaks += 1;
                                self.position += 1;
                            }
                            '\r' => {
                                line_breaks += 1;
                                self.position += 1;
                                if self.chars.get(self.position) == Some(&'\n') {
                                    // Count CR and LF separately, so a CRLF pair forms a paragraph break.
                                    line_breaks += 1;
                                    self.position += 1;
                                }
                            }
                            _ => break,
                        }
                        while self.position < self.chars.len()
                            && !matches!(self.chars[self.position], '\n' | '\r')
                            && self.chars[self.position].is_whitespace()
                        {
                            self.position += 1;
                        }
                    }
                    if line_breaks > 1 {
                        let mut parbreak_start = start;
                        if let Some(Node::Whitespace(_, span)) = nodes.last()
                            && span.end.offset == self.positions[start].offset
                        {
                            parbreak_start = self.char_index(span.start.offset);
                            nodes.pop();
                        }
                        nodes.push(Node::Parbreak(self.span(parbreak_start, self.position)));
                    } else {
                        Self::push_whitespace(
                            &mut nodes,
                            self.chars[start..self.position].iter().collect(),
                            self.span(start, self.position),
                        );
                    }
                }
                ch => {
                    if text.is_empty() {
                        text_start = Some(self.position);
                    }
                    text.push(ch);
                    self.position += 1;
                }
            }
        }
        self.flush_text(&mut nodes, &mut text, &mut text_start);
        (nodes, closed)
    }

    /// Move buffered literal text into the syntax tree before a structural node.
    fn flush_text(&self, nodes: &mut Vec<Node>, text: &mut String, start: &mut Option<usize>) {
        if !text.is_empty() {
            let start = start.take().unwrap_or(self.position);
            nodes.push(Node::String(
                std::mem::take(text),
                self.span(start, self.position),
            ));
        }
    }

    /// Merge adjacent whitespace only when source spans touch; gaps must retain distinct nodes.
    fn push_whitespace(nodes: &mut Vec<Node>, content: String, span: SourceSpan) {
        if let Some(Node::Whitespace(previous, previous_span)) = nodes.last_mut()
            && previous_span.end.offset == span.start.offset
        {
            previous.push_str(&content);
            previous_span.end = span.end;
        } else {
            nodes.push(Node::Whitespace(content, span));
        }
    }

    /// Parse a macro name and consume its arguments, handling custom-command definitions separately.
    ///
    /// Unlisted custom macros do not consume following groups. Alphabetic zero-argument macros
    /// discard one trailing delimiter whitespace node, while math-mode `_` and `^` take one
    /// argument. `url` and `href` replace their first parsed argument with its raw printed text.
    fn parse_macro(&mut self, math: Option<MathDelimiter>, environment_end: Option<&str>) -> Node {
        let macro_start = self.position;
        self.position += 1;
        if self.position == self.chars.len() {
            // Preserve a final unmatched backslash rather than dropping source text.
            return Node::String("\\".to_string(), self.span(macro_start, self.position));
        }

        let start = self.position;
        // Alphabetic macro names consume a run of letters; other names use one character.
        let alphabetic_name = self.chars[self.position].is_alphabetic();
        if alphabetic_name {
            while self.position < self.chars.len() && self.chars[self.position].is_alphabetic() {
                self.position += 1;
            }
        } else {
            self.position += 1;
        }
        let name: String = self.chars[start..self.position].iter().collect();
        let macro_span = self.span(macro_start, self.position);
        // Literal commands bypass arity lookup and recursive argument parsing entirely.
        if matches!(name.as_str(), "verb" | "path") {
            return self.verbatim(macro_start);
        }

        let mut arguments = Vec::new();
        if matches!(name.as_str(), "newcommand" | "ProvideTextCommandDefault") {
            // Definition arity/default brackets are syntax; the visitor stores the replacement body.
            self.skip_argument_space();
            arguments.push(self.argument(math, environment_end));
            self.skip_argument_space();
            if self.skip_optional_bracket_argument() {
                self.skip_argument_space();
                self.skip_optional_bracket_argument();
            }
            self.skip_argument_space();
            if self.position < self.chars.len() && self.chars[self.position] != '}' {
                arguments.push(self.argument(math, environment_end));
            }
            return Node::Macro {
                name,
                arguments,
                span: macro_span,
            };
        }

        let arity = narguments(&name, math.is_some());
        for _ in 0..arity {
            // TeX permits whitespace between a macro name and its braced arguments.
            self.skip_argument_space();
            if self.position == self.chars.len() || self.chars[self.position] == '}' {
                break;
            }
            let styled_argument = matches!(
                name.as_str(),
                "textbf"
                    | "mkbibbold"
                    | "textit"
                    | "textsl"
                    | "emph"
                    | "mkbibemph"
                    | "textsc"
                    | "texttt"
            );
            arguments.push(if styled_argument {
                self.styled_argument(math, environment_end)
            } else {
                self.argument(math, environment_end)
            });
        }
        if matches!(name.as_str(), "url" | "href")
            && let Some(argument) = arguments.first()
        {
            // Serialize the destination as source text so embedded commands remain literal.
            let nodes = match argument.as_slice() {
                [Node::Group(children, _)] => children.as_slice(),
                _ => argument.as_slice(),
            };
            let span = nodes
                .first()
                .map(|node| self.node_span(node))
                .unwrap_or(macro_span);
            arguments[0] = vec![Node::String(serialize_print_raw_nodes(nodes), span)];
        }
        if alphabetic_name
            && arity == 0
            && self.position < self.chars.len()
            && self.chars[self.position].is_ascii_whitespace()
        {
            // The delimiter after a zero-argument alphabetic macro is syntax, not rendered text.
            self.skip_argument_space();
        }
        Node::Macro {
            name,
            arguments,
            span: macro_span,
        }
    }

    /// Consume one optional square-bracket argument, respecting braces and escaped delimiters.
    ///
    /// Newcommand arity and default arguments are syntax around the replacement body. Skip those
    /// bracketed sections so they are not included in rendered field text.
    fn skip_optional_bracket_argument(&mut self) -> bool {
        if self.chars.get(self.position) != Some(&'[') {
            return false;
        }
        self.position += 1;
        let (mut depth, mut escaped) = (0usize, false);
        while self.position < self.chars.len() {
            let character = self.chars[self.position];
            self.position += 1;
            if escaped {
                escaped = false;
                continue;
            }
            match character {
                '\\' => escaped = true,
                '{' => depth += 1,
                '}' => depth = depth.saturating_sub(1),
                ']' if depth == 0 => return true,
                _ => {}
            }
        }
        false
    }

    /// Skip horizontal space or one line ending and its indentation before a macro argument.
    /// A second consecutive line ending is left in place as paragraph structure.
    fn skip_argument_space(&mut self) {
        if self.position >= self.chars.len() {
            return;
        }
        if matches!(self.chars[self.position], ' ' | '\t') {
            while self.position < self.chars.len()
                && matches!(self.chars[self.position], ' ' | '\t')
            {
                self.position += 1;
            }
            return;
        }
        if !matches!(self.chars[self.position], '\n' | '\r') {
            return;
        }

        let start = self.position;
        if self.chars[self.position] == '\r' {
            self.position += 1;
            if self.chars.get(self.position) == Some(&'\n') {
                self.position += 1;
            }
        } else {
            self.position += 1;
        }
        while self.position < self.chars.len() && matches!(self.chars[self.position], ' ' | '\t') {
            self.position += 1;
        }
        if self.chars.get(self.position) == Some(&'\n')
            || self.chars.get(self.position) == Some(&'\r')
        {
            // Rewind the first line ending too, so argument parsing cannot swallow a paragraph boundary.
            self.position = start;
        }
    }

    /// Parse a braced macro argument, nested macro, or single-token argument.
    ///
    /// Braced arguments remain `Group` nodes so rendering can preserve their structure and use
    /// root groups for title case protection. Malformed groups retain a literal opening brace
    /// followed by the content parsed so far.
    fn argument(
        &mut self,
        math: Option<MathDelimiter>,
        environment_end: Option<&str>,
    ) -> Vec<Node> {
        // Keep balanced braces as a Group; the source delimiters are structural, not field text.
        if self.chars[self.position] == '{' {
            let start = self.position;
            self.position += 1;
            let (mut content, matched) = self.sequence(true, math, environment_end);
            if !matched {
                content.insert(
                    0,
                    Node::String("{".to_string(), self.span(start, start + 1)),
                );
                content
            } else {
                vec![Node::Group(content, self.span(start, self.position))]
            }
        // An unbraced argument may itself be a macro; otherwise it consumes one character.
        } else if self.chars[self.position] == '\\' {
            vec![self.parse_macro(math, environment_end)]
        } else {
            let start = self.position;
            let ch = self.chars[self.position];
            self.position += 1;
            vec![Node::String(
                ch.to_string(),
                self.span(start, self.position),
            )]
        }
    }

    /// Consume a complete unbraced string run for style macros.
    ///
    /// Thus `\textbf abc` styles the complete `abc` run; other unbraced macro arguments consume
    /// only one token.
    fn styled_argument(
        &mut self,
        math: Option<MathDelimiter>,
        environment_end: Option<&str>,
    ) -> Vec<Node> {
        if self.position >= self.chars.len() || matches!(self.chars[self.position], '{' | '\\') {
            return self.argument(math, environment_end);
        }
        let start = self.position;
        while self.position < self.chars.len()
            && !matches!(
                self.chars[self.position],
                '{' | '}' | '\\' | '$' | '%' | '\n' | '\r'
            )
            && !self.chars[self.position].is_ascii_whitespace()
        {
            self.position += 1;
        }
        if self.position == start {
            return self.argument(math, environment_end);
        }
        vec![Node::String(
            self.chars[start..self.position].iter().collect(),
            self.span(start, self.position),
        )]
    }

    /// Parse a delimited literal token and retain its source range including delimiters.
    /// Matched commands share the BibTeX scanner's delimiter rules. If that lookup fails,
    /// retain the permissive TeX-only fallback: consume through the delimiter or EOF.
    fn verbatim(&mut self, start: usize) -> Node {
        if let Some(range) = verbatim_range(&self.chars, start) {
            let contents = self.chars[range.clone()].iter().collect();
            self.position = range.end + 1;
            return Node::Verb(contents, self.span(start, self.position));
        }
        let Some(delimiter) = self.chars.get(self.position).copied() else {
            return Node::Verb(String::new(), self.span(start, self.position));
        };
        self.position += 1;
        let content_start = self.position;
        while self.position < self.chars.len() && self.chars[self.position] != delimiter {
            self.position += 1;
        }
        let contents = self.chars[content_start..self.position].iter().collect();
        if self.position < self.chars.len() {
            self.position += 1;
        }
        Node::Verb(contents, self.span(start, self.position))
    }

    /// Store the replacement body parsed after custom-command declaration syntax.
    ///
    /// The first argument must name a macro, and the second argument supplies its replacement
    /// body. Arity and default-value brackets have already been removed by argument parsing.
    fn register_macro(&mut self, arguments: &[Vec<Node>]) -> bool {
        // Accept a single macro node, optionally enclosed in one group, as the definition name.
        let name_node = arguments
            .first()
            .and_then(|argument| match argument.as_slice() {
                [Node::Group(children, _)] => children.first(),
                [node] => Some(node),
                _ => None,
            });
        let Some(Node::Macro { name, .. }) = name_node else {
            return false;
        };

        let Some(replacement) = arguments.get(1).cloned() else {
            return false;
        };

        let name = name.clone();
        self.macro_definitions.insert(name, replacement);
        true
    }

    /// Expand nested custom macros with a recursion limit for self-referential definitions.
    ///
    /// Invocation arguments and `#1`-style placeholders are not substituted; the stored body is
    /// expanded recursively as written.
    fn expand_macro(
        &self,
        name: &str,
        depth: usize,
        arguments: &[Vec<Node>],
        span: SourceSpan,
    ) -> Vec<Node> {
        if depth >= 32 {
            // Preserve the recursive call instead of overflowing on a self-referential definition.
            return vec![Node::Macro {
                name: name.to_string(),
                arguments: arguments.to_vec(),
                span,
            }];
        }
        let _ = arguments;
        self.macro_definitions
            .get(name)
            .map(|body| self.expand_nodes(body, depth + 1))
            .unwrap_or_default()
    }

    /// Recursively expand custom macros in a stored replacement body.
    fn expand_nodes(&self, nodes: &[Node], depth: usize) -> Vec<Node> {
        nodes
            .iter()
            .flat_map(|node| match node {
                // Expand only names that were registered; built-ins remain for the renderer.
                Node::Macro {
                    name,
                    arguments,
                    span,
                } if self.macro_definitions.contains_key(name) => {
                    self.expand_macro(name, depth, arguments, *span)
                }
                Node::Group(children, span) => {
                    vec![Node::Group(self.expand_nodes(children, depth), *span)]
                }
                Node::InlineMath(children, span) => {
                    vec![Node::InlineMath(self.expand_nodes(children, depth), *span)]
                }
                Node::Environment {
                    name,
                    content,
                    span,
                } => vec![Node::Environment {
                    name: name.clone(),
                    content: self.expand_nodes(content, depth),
                    span: *span,
                }],
                other => vec![other.clone()],
            })
            .collect()
    }

    /// Discard a nested `ifdefined` block through its matching `fi`, including both branches.
    fn skip_ifdefined(&mut self) {
        let mut depth = 1usize;
        while self.position < self.chars.len() {
            if self.chars[self.position] == '%' {
                // Conditional markers inside TeX comments are inert.
                while self.position < self.chars.len() && self.chars[self.position] != '\n' {
                    self.position += 1;
                }
                continue;
            }
            if self.chars[self.position] != '\\' {
                // Ignore ordinary body characters until another macro name begins.
                self.position += 1;
                continue;
            }

            self.position += 1;
            let start = self.position;
            while self.position < self.chars.len() && self.chars[self.position].is_alphabetic() {
                self.position += 1;
            }
            let macro_name: String = self.chars[start..self.position].iter().collect();
            match macro_name.as_str() {
                "ifdefined" => depth += 1,
                "fi" => {
                    depth -= 1;
                    if depth == 0 {
                        // Discard both conditional branches when the matching terminator is found.
                        return;
                    }
                }
                _ => {}
            }
            if start == self.position && self.position < self.chars.len() {
                self.position += 1;
            }
        }
    }
}

/// Return the argument arity for markup macros and combining macros.
fn narguments(name: &str, in_math: bool) -> usize {
    // Accent arity comes from the generated combining table rather than a second accent list.
    if unicode_mapping(&format!("\\{name}")).is_some_and(|mapping| mapping.combining.is_some()) {
        return 1;
    }
    // Underscore and caret take arguments only while parsing math.
    match name {
        "frac" | "href" => 2,
        "discretionary" => 3,
        "advance" | "ElsevierGlyph" | "bar" | "begin" | "end" | "bibcyr" | "bibstring" | "chsf"
        | "allcaps" | "cite" | "citeauthor" | "cyrchar" | "ding" | "emph" | "enquote" | "hbox"
        | "hskip" | "hspace" | "ht" | "mathrm" | "mbox" | "mkbibbold" | "mkbibemph"
        | "mkbibitalic" | "mkbibquote" | "noopsort" | "ocirc" | "overline" | "rlap" | "sb"
        | "section" | "sp" | "subsection" | "subsubsection" | "subsubsubsection" | "symbol"
        | "t" | "textbf" | "textcite" | "textit" | "textrm" | "textsc" | "textsl"
        | "textsubscript" | "textsuperscript" | "texttt" | "textup" | "url" | "vphantom"
        | "vspace" | "wd" => 1,
        "_" | "^" if in_math => 1,
        // Unlisted macros stay intact and do not consume following groups as arguments.
        _ => 0,
    }
}

/// Build a TeX syntax tree from a field fragment without loading or parsing Unicode JSON at runtime.
pub(crate) fn parse(source: &str) -> Ast {
    let mut parser = Parser::new(source);
    let span = parser.span(0, parser.chars.len());
    let (content, _) = parser.sequence(false, None, None);
    Ast { content, span }
}

/// Print parsed TeX nodes, reducing layout whitespace and paragraph breaks to single spaces.
pub(crate) fn print_raw(source: &str) -> String {
    serialize_print_raw_nodes(&parse(source).content)
}

/// Collects unsupported TeX constructs while normalized fields are rendered.
///
/// Diagnostics are shared across every field in one library normalization so each unsupported
/// macro or environment is reported only once.
#[derive(Default)]
pub(crate) struct RenderDiagnostics {
    /// First error for each unsupported construct, in the order it was encountered.
    pub(crate) errors: Vec<super::ParseError>,
    /// Stable kind/name identifiers used to suppress duplicate macro and environment errors.
    unhandled: HashSet<String>,
    /// Output policy for unsupported nodes.
    pub(crate) unsupported: Option<super::UnsupportedHandler>,
    /// Whether root-title group boundaries should be retained for post-render casing.
    pub(crate) mark_case_groups: bool,
    pub(crate) plain_urls: bool,
}

impl RenderDiagnostics {
    /// Choose fallback output independently of diagnostic collection in `report`.
    /// No policy preserves reconstructed source; explicit policies emit a script wrapper,
    /// a bare command name, or nothing. `Throw` uses the same rendering branch as `TeX` here.
    fn render_unsupported(&self, command: &str, source: &str) -> String {
        match self.unsupported {
            Some(super::UnsupportedHandler::TeX | super::UnsupportedHandler::Throw) => {
                format!("<script>{command}</script>")
            }
            Some(super::UnsupportedHandler::Text) => {
                command.strip_prefix('\\').unwrap_or(command).to_string()
            }
            Some(super::UnsupportedHandler::Ignore) => String::new(),
            None => source.to_string(),
        }
    }

    /// Record an unsupported construct once while preserving its reconstructed TeX source.
    ///
    /// `kind` selects the diagnostic format, `name` forms the deduplication key, and
    /// `source` is retained as the error input. Macro and environment errors are deduplicated;
    /// callers currently report only those two construct kinds.
    fn report(&mut self, kind: &str, name: &str, source: String) {
        let id = format!("{kind}.{name}");
        if self.unhandled.insert(id) {
            let error = if kind == "macro" {
                format!("unhandled macro {source}")
            } else {
                format!("unhandled environment {name} ({source})")
            };
            self.errors.push(super::ParseError {
                error,
                input: source,
            });
        }
    }
}

/// Case-protection settings for title rendering.
///
/// `as-needed` protects marked groups when sentence casing changes their text or their words have
/// lowercase-shaped forms. `strict` protects every marked group and preserves its source spelling.
/// `off` preserves marked-group spelling without adding protection markup.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum CaseProtection {
    #[default]
    AsNeeded,
    Off,
    Strict,
}

impl CaseProtection {
    /// Whether title rendering may emit case-preserving spans.
    fn enabled(self) -> bool {
        !matches!(self, Self::Off)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RenderContext {
    title_mode: bool,
    protected_ancestor: bool,
    root_scope: bool,
    case_protection: CaseProtection,
}

/// Parse, visit, and trim a TeX fragment using its field rendering mode.
///
/// This test-only convenience function discards unsupported-construct diagnostics; production
/// normalization calls `render_with_diagnostics` so those errors reach `ParsedLibrary.errors`.
/// `source` is the raw field value and `mode` is a field mode such as `title` or `richtext`.
#[cfg(test)]
pub(crate) fn render(source: &str, mode: &str) -> String {
    collapse_markup(&render_with_diagnostics(
        source,
        mode,
        &mut RenderDiagnostics::default(),
    ))
}

/// Render one field with an explicit case-protection mode.
///
/// `AsNeeded` is the default; callers can disable protection or require it for every marked group
/// without changing the rest of the render pipeline.
#[cfg(test)]
pub(crate) fn render_with_case_protection(
    source: &str,
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
    case_protection: CaseProtection,
) -> String {
    render_with_case_protection_and_macro_definitions(
        source,
        mode,
        diagnostics,
        case_protection,
        &mut HashMap::new(),
    )
    .trim()
    .to_string()
}

/// Parse and render one field with explicit protection policy and shared macro definitions.
/// Definitions registered while parsing are returned through the map for later fields; output is untrimmed.
pub(crate) fn render_with_case_protection_and_macro_definitions(
    source: &str,
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
    case_protection: CaseProtection,
    macro_definitions: &mut HashMap<String, Vec<Node>>,
) -> String {
    let mut parser = Parser::new_with_macro_definitions(source, std::mem::take(macro_definitions));
    let (content, _) = parser.sequence(false, None, None);
    *macro_definitions = parser.macro_definitions;
    render_nodes(
        &content,
        mode,
        false,
        diagnostics,
        RenderContext {
            title_mode: mode == "title",
            protected_ancestor: false,
            root_scope: true,
            case_protection,
        },
    )
}

/// Render one field and add unsupported constructs to library-level diagnostics.
///
/// # Arguments
/// * `source` - Raw TeX source for one field.
/// * `mode` - Field rendering mode; only `title` enables title root-group protection.
/// * `diagnostics` - Shared state that deduplicates unsupported constructs across fields.
///
/// Rendering starts at field root with the default `as-needed` case-protection mode.
#[cfg(test)]
pub(crate) fn render_with_diagnostics(
    source: &str,
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
) -> String {
    render_with_case_protection(source, mode, diagnostics, CaseProtection::default())
}

/// Render a sibling sequence while tracking field mode, local markup, and title context.
///
/// `nodes` is one AST child list; `mode` controls whitespace and rich-text output; `verbatim`
/// preserves literal text such as URLs. `diagnostics` is shared recursively. `title_mode` enables
/// case protection, `protected_ancestor` prevents duplicate protection inside a protected region,
/// and `root_scope` limits root-group handling to the original field or a root environment body.
///
/// Declaration-style markup persists only across siblings in this sequence. Recursive groups
/// start with fresh markup state.
fn render_nodes(
    nodes: &[Node],
    mode: &str,
    verbatim: bool,
    diagnostics: &mut RenderDiagnostics,
    context: RenderContext,
) -> String {
    let mut output = String::new();
    let mut paragraph_boundary = false;
    let mut markup = Markup::default();
    for (index, node) in nodes.iter().enumerate() {
        // These declaration commands change formatting for later siblings and render no text.
        if mode != "math"
            && let Node::Macro { name, .. } = node
            && markup.activate(name)
        {
            continue;
        }
        let is_parbreak = matches!(node, Node::Parbreak(_))
            || matches!(node, Node::Macro { name, .. } if name == "par");
        if mode == "richtext" {
            let next_non_layout = nodes[index + 1..]
                .iter()
                .find(|next| !matches!(next, Node::Whitespace(_, _) | Node::Comment { .. }));
            let tie_between_paragraphs = matches!(node, Node::String(text, _) if text == "~" || text == "\u{00a0}")
                && next_non_layout.is_some_and(|next| {
                    matches!(next, Node::Parbreak(_))
                        || matches!(next, Node::Macro { name, .. } if name == "par")
                });
            // Collapse repeated paragraph boundaries, their layout whitespace, and ties between them.
            if is_parbreak && paragraph_boundary {
                continue;
            }
            if paragraph_boundary && tie_between_paragraphs {
                continue;
            }
            if paragraph_boundary && matches!(node, Node::Whitespace(_, _)) {
                continue;
            }
        }

        // Root braces express author case intent; a leading macro instead denotes formatting.
        // Already-protected ancestors suppress duplicate protection on nested content.
        let protect_group = context.title_mode
            && context.root_scope
            && !context.protected_ancestor
            && matches!(node, Node::Group(children, _) if !children.is_empty() && !matches!(children[0], Node::Macro { .. }));
        let rendered = render_node(
            node,
            mode,
            verbatim,
            diagnostics,
            RenderContext {
                title_mode: context.title_mode,
                protected_ancestor: context.protected_ancestor || protect_group,
                root_scope: context.root_scope,
                case_protection: context.case_protection,
            },
        );
        if mode == "richtext" && is_parbreak {
            paragraph_boundary = true;
        } else if !matches!(node, Node::Comment { .. }) && !rendered.is_empty() {
            paragraph_boundary = false;
        }
        let mut rendered = markup.wrap(rendered);
        if diagnostics.mark_case_groups && protect_group {
            rendered = format!("<case-protection>{rendered}</case-protection>");
        } else if protect_group
            && context.case_protection.enabled()
            && needs_case_protection(&rendered)
        {
            rendered = format!("<span class=\"nocase\">{rendered}</span>");
        }
        output.push_str(&rendered);
    }
    output
}

/// Merge adjacent equal markup spans separated only by whitespace.
pub(crate) fn collapse_markup(text: &str) -> String {
    let output = collapse_markup_spans(text.to_string());
    collapse_markup_pairs(&output, "<span class=\"nocase\">", "</span>")
}

/// Merge adjacent identical formatting wrappers until no merge exposes another eligible pair.
/// Whitespace between equal wrappers is retained inside the merged span.
fn collapse_markup_spans(mut output: String) -> String {
    let wrappers = [
        ("<i>", "</i>"),
        ("<b>", "</b>"),
        ("<code>", "</code>"),
        ("<span style=\"font-variant:small-caps;\">", "</span>"),
    ];
    // Adjacent siblings receive separate wrappers above; collapse equal neighbors into one span.
    loop {
        let collapsed = wrappers.iter().fold(output.clone(), |text, (open, close)| {
            collapse_markup_pairs(&text, open, close)
        });
        if collapsed == output {
            break;
        }
        output = collapsed;
    }
    output
}

/// Remove matching close/open tag pairs separated only by whitespace, preserving all other text.
/// Repeat to a fixed point because removing tags may expose another merge opportunity.
fn collapse_markup_pairs(text: &str, open: &str, close: &str) -> String {
    let mut current = text.to_string();
    loop {
        let mut output = String::with_capacity(current.len());
        let mut cursor = 0;
        let mut replaced = false;
        while let Some(relative_close) = current[cursor..].find(close) {
            let close_start = cursor + relative_close;
            let after_close = close_start + close.len();
            let mut next_open = after_close;
            for (offset, character) in current[after_close..].char_indices() {
                if character.is_whitespace() {
                    // Keep the separator, but look past it for an equal wrapper to merge.
                    next_open = after_close + offset + character.len_utf8();
                } else {
                    break;
                }
            }
            output.push_str(&current[cursor..close_start]);
            if current[next_open..].starts_with(open) {
                // Drop only the repeated tags; their contents and intervening whitespace remain.
                output.push_str(&current[after_close..next_open]);
                cursor = next_open + open.len();
                replaced = true;
            } else {
                // A different tag or non-whitespace content ends this merge opportunity.
                output.push_str(close);
                cursor = after_close;
            }
        }
        output.push_str(&current[cursor..]);
        if !replaced {
            return current;
        }
        // A merge may expose another adjacent pair, so scan again until the text stabilizes.
        current = output;
    }
}

/// Formatting state activated by TeX declaration commands for later siblings in one node list.
#[derive(Default)]
struct Markup {
    /// Whether subsequent siblings render inside italic markup.
    emph: bool,
    /// Whether subsequent siblings render inside bold markup.
    bold: bool,
    /// Whether subsequent siblings render inside small-caps markup.
    small_caps: bool,
    /// Whether subsequent siblings render inside code markup.
    code: bool,
}

impl Markup {
    /// Activate a supported declaration command and report whether it should be omitted.
    ///
    /// `name` is the parsed macro name. In text modes, `em`/`it`/`sl`, `bf`, `sc`, and `tt`
    /// enable formatting for later siblings; other macros continue to normal dispatch.
    fn activate(&mut self, name: &str) -> bool {
        let flag = match name {
            "em" | "it" | "sl" => &mut self.emph,
            "bf" => &mut self.bold,
            "sc" => &mut self.small_caps,
            "tt" => &mut self.code,
            _ => return false,
        };
        *flag = true;
        true
    }

    /// Wrap one rendered sibling in active markup, from emphasis through code.
    ///
    /// Empty output stays empty so comments and formatting declarations do not create empty tags.
    fn wrap(&self, mut text: String) -> String {
        if text.is_empty() {
            return text;
        }
        if self.emph {
            text = format!("<i>{text}</i>");
        }
        if self.bold {
            text = format!("<b>{text}</b>");
        }
        if self.small_caps {
            text = format!("<span style=\"font-variant:small-caps;\">{text}</span>");
        }
        if self.code {
            text = format!("<code>{text}</code>");
        }
        text
    }
}

/// Detect lowercase-shaped words that need case protection in rendered title text.
/// Mask tags with word joiners so formatting cannot introduce artificial word boundaries.
fn needs_case_protection(text: &str) -> bool {
    let characters: Vec<char> = text.chars().collect();
    let mut tokenized = Vec::new();
    let mut position = 0;
    while position < characters.len() {
        if characters[position] == '<'
            && let Some(relative_end) = characters[position..]
                .iter()
                .position(|character| *character == '>')
        {
            tokenized.extend(std::iter::repeat_n('\u{2060}', relative_end + 1));
            position += relative_end + 1;
        } else {
            tokenized.push(characters[position]);
            position += 1;
        }
    }
    let characters = tokenized;
    let tokens = sentence_tokens(&characters, true, false);
    let mut index = 0;
    while index < tokens.len() {
        let end = hyphenated_end(&tokens, &characters, index).unwrap_or(index);
        let shape = tokens[index..=end]
            .iter()
            .map(|token| {
                if token.kind == SentenceTokenKind::Other {
                    token_text(token, &characters)
                } else {
                    token.shape.clone()
                }
            })
            .collect::<String>();
        if shape.contains('x') && !shape.contains('X') {
            return true;
        }
        index = end + 1;
    }
    false
}

/// A removed tag and its positions in both the source and markup-free visible text.
struct InlineMarkup {
    source_start: usize,
    position: usize,
    text: String,
}

/// The tokenizable text plus maps needed to restore source ranges and tags later.
struct MarkupView {
    characters: Vec<char>,
    markup: Vec<InlineMarkup>,
    source_to_visible: Vec<usize>,
}

/// One token replacement and a map from each old character boundary to its new position.
struct CasingEdit {
    start: usize,
    end: usize,
    replacement: String,
    boundaries: Vec<usize>,
}

/// Remove rendered tags without losing where they occurred between visible characters.
///
/// `source_to_visible` maps every source character boundary, including boundaries inside a tag,
/// to a visible-text character boundary. Tags at the same visible position retain source order.
fn strip_markup(text: &str) -> MarkupView {
    let source: Vec<char> = text.chars().collect();
    let mut characters = Vec::with_capacity(source.len());
    let mut markup = Vec::new();
    let mut source_to_visible = vec![0; source.len() + 1];
    let mut position = 0;
    while position < source.len() {
        if source[position] == '<'
            && let Some(relative_end) = source[position..]
                .iter()
                .position(|character| *character == '>')
        {
            let end = position + relative_end + 1;
            // Tags are zero-width to tokenization; every source boundary inside one maps here.
            markup.push(InlineMarkup {
                source_start: position,
                position: characters.len(),
                text: source[position..end].iter().collect(),
            });
            source_to_visible[position..=end].fill(characters.len());
            position = end;
            source_to_visible[position] = characters.len();
        } else {
            // Ordinary characters survive unchanged and advance the visible coordinate by one.
            source_to_visible[position] = characters.len();
            characters.push(source[position]);
            position += 1;
            source_to_visible[position] = characters.len();
        }
    }
    MarkupView {
        characters,
        markup,
        source_to_visible,
    }
}

/// Map source-character boundaries through a token replacement, including expanding case maps.
///
/// Exact characters align first, then per-character lowercase expansions. The fallback keeps the
/// map monotone for other transformations; interior boundaries of a multi-unit character stay at
/// its start so restored markup cannot split a Unicode scalar value.
fn replacement_boundaries(source: &[char], replacement: &str) -> Vec<usize> {
    let replacement: Vec<char> = replacement.chars().collect();
    let mut boundaries = vec![0; source.len() + 1];
    let mut output = 0;
    for (index, character) in source.iter().enumerate() {
        let lowercase: Vec<char> = character.to_lowercase().collect();
        let output_length = if replacement[output..].starts_with(std::slice::from_ref(character)) {
            1
        } else if replacement[output..].starts_with(&lowercase) {
            lowercase.len()
        } else {
            // Sentence-case replacements normally preserve or lowercase characters; keep unusual
            // whole-token rewrites positionable by assigning the next output scalar to this input.
            usize::from(output < replacement.len())
        };
        output += output_length;
        boundaries[index + 1] = output;
    }
    boundaries
}

/// Translate one visible-source boundary through prior edits and the map of any containing edit.
fn output_boundary(position: usize, edits: &[CasingEdit]) -> usize {
    let mut delta = 0isize;
    for edit in edits {
        if position < edit.start {
            break;
        }
        // For example, lowercasing `İ<tag>X` expands `İ` to `i` plus a combining dot, so the tag
        // moves after both output characters. The boundary map records that exact position; the
        // token's total length change alone only gives the shift for tags after the whole token.
        if position <= edit.end {
            let output_start = (edit.start as isize + delta) as usize;
            return output_start + edit.boundaries[position - edit.start];
        }
        delta += edit.replacement.chars().count() as isize - (edit.end - edit.start) as isize;
    }
    (position as isize + delta) as usize
}

/// Restore original protected spans over cased text using token-edit boundary maps.
/// Overlapping ranges are merged, then applied right-to-left so replacements cannot shift later offsets.
fn restore_preserved_ranges(
    source: &[char],
    cased: &str,
    ranges: &[std::ops::Range<usize>],
    edits: &[CasingEdit],
) -> String {
    let mut sorted = ranges.to_vec();
    sorted.sort_by_key(|range| (range.start, range.end));
    let mut merged: Vec<std::ops::Range<usize>> = Vec::new();
    for range in sorted {
        if let Some(previous) = merged.last_mut()
            && range.start <= previous.end
        {
            previous.end = previous.end.max(range.end);
        } else {
            merged.push(range);
        }
    }

    let mut output: Vec<char> = cased.chars().collect();
    for range in merged.iter().rev() {
        let start = output_boundary(range.start, edits);
        let end = output_boundary(range.end, edits);
        output.splice(start..end, source[range.clone()].iter().copied());
    }
    output.into_iter().collect()
}

/// Reinsert tags after casing, preserving source order when several tags share one visible boundary.
fn restore_markup(text: &str, markup: &[InlineMarkup], edits: &[CasingEdit]) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut insertions: Vec<_> = markup
        .iter()
        .map(|tag| {
            (
                output_boundary(tag.position, edits),
                tag.source_start,
                &tag.text,
            )
        })
        .collect();
    insertions.sort_by_key(|(position, source_start, _)| (*position, *source_start));
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    for (position, _, tag) in insertions {
        // Copy visible output up to the tag, then continue from that same zero-width boundary.
        output.extend(characters[cursor..position].iter());
        output.push_str(tag);
        cursor = position;
    }
    output.extend(characters[cursor..].iter());
    output
}

/// Apply token edits in source order; the tokenizer guarantees that their ranges do not overlap.
fn apply_casing_edits(characters: &[char], edits: &[CasingEdit]) -> String {
    let mut output = String::new();
    let mut cursor = 0;
    for edit in edits {
        output.extend(characters[cursor..edit.start].iter());
        output.push_str(&edit.replacement);
        cursor = edit.end;
    }
    output.extend(characters[cursor..].iter());
    output
}

/// Sentence-case visible text without allowing tags to split words.
///
/// Algorithm:
/// 1. Remove tags, recording each one at its position in the visible text.
/// 2. Measure all-caps/guess state and map protected or quoted source ranges into visible offsets.
/// 3. Tokenize the continuous visible text; make casing edits to whole words, skipping protected
///    ranges and treating hyphenated runs as one unit.
/// 4. Apply edits and record how each old character boundary maps through its replacement.
/// 5. Reinsert each tag at its translated position. Protected and quoted text was never edited, so
///    it passes through with its original casing.
///
/// Tokenizer and title-case tests cover casing, markup placement, and protected ranges.
pub(crate) fn sentence_case_with_options(
    text: &str,
    guess: bool,
    sub_sentence: bool,
    preserve_quoted: bool,
) -> String {
    // Classify the title from visible characters only; markup must not affect all-caps detection.
    let view = strip_markup(text);
    let visible: String = view.characters.iter().collect();
    let all_caps = visible
        .chars()
        .flat_map(char::to_uppercase)
        .collect::<String>()
        == visible;
    let all_lower = visible
        .chars()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        == visible;
    if guess && !all_caps && !all_lower && looks_sentence_cased(text) {
        // Guessing is a whole-title decision, so preserve the complete source including its tags.
        return text.to_string();
    }
    // Keep single-token all-caps identifiers intact even when guessing is disabled.
    if all_caps
        && !view
            .characters
            .iter()
            .any(|character| is_case_whitespace(*character))
    {
        return text.to_string();
    }

    let source: Vec<char> = text.chars().collect();
    // Token offsets now refer to visible text, so translate original protected ranges once here.
    let tokens = sentence_tokens(&view.characters, sub_sentence, false);
    let mut preserved: Vec<_> = nocase_ranges(&source)
        .into_iter()
        .map(|range| view.source_to_visible[range.start]..view.source_to_visible[range.end])
        .collect();
    if preserve_quoted {
        preserved.extend(
            quoted_ranges(&source).into_iter().map(|range| {
                view.source_to_visible[range.start]..view.source_to_visible[range.end]
            }),
        );
    }
    let mut edits = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        if let Some(end) = hyphenated_end(&tokens, &view.characters, index) {
            // Use the combined shape for casing; protected text is restored after all edits.
            let grouped_shape = tokens[index..=end]
                .iter()
                .map(|token| {
                    if token.kind == SentenceTokenKind::Other {
                        token_text(token, &view.characters)
                    } else {
                        token.shape.clone()
                    }
                })
                .collect::<String>();
            if !grouped_shape.starts_with('x') {
                let mut rendered = String::new();
                for token in &tokens[index..=end] {
                    if token.kind == SentenceTokenKind::Word {
                        rendered.push_str(&sentence_word(token, &view.characters, all_caps, true));
                    } else {
                        rendered.push_str(&token_text(token, &view.characters));
                    }
                }
                let start = tokens[index].start;
                let finish = tokens[end].end;
                let original: String = view.characters[start..finish].iter().collect();
                if rendered != original {
                    // Save an internal boundary map because a tag may sit inside this token run.
                    edits.push(CasingEdit {
                        start,
                        end: finish,
                        boundaries: replacement_boundaries(
                            &view.characters[start..finish],
                            &rendered,
                        ),
                        replacement: rendered,
                    });
                }
            }
            index = end + 1;
            continue;
        }

        let token = &tokens[index];
        // Case every visible token first; protected source spans are overlaid after all edits.
        if token.kind == SentenceTokenKind::Word || token.kind == SentenceTokenKind::Domain {
            let rendered = sentence_word(token, &view.characters, all_caps, false);
            let original = token.text(&view.characters);
            if rendered != original {
                edits.push(CasingEdit {
                    start: token.start,
                    end: token.end,
                    boundaries: replacement_boundaries(
                        &view.characters[token.start..token.end],
                        &rendered,
                    ),
                    replacement: rendered,
                });
            }
        }
        index += 1;
    }

    // Casing ignores protection boundaries; then original protected text is pasted over its output.
    let visible_cased = apply_casing_edits(&view.characters, &edits);
    let visible_restored =
        restore_preserved_ranges(&view.characters, &visible_cased, &preserved, &edits);
    restore_markup(&visible_restored, &view.markup, &edits)
}

/// Apply whole-title casing, then resolve root-group markers against each group's transformed span.
///
/// The renderer marks eligible AST root groups before casing. Strict mode restores every marked
/// span; as-needed restores a span when casing changed it or its original words need protection.
/// Off mode emits no markers.
pub(crate) fn sentence_case_title(
    text: &str,
    guess: bool,
    sub_sentence: bool,
    preserve_quoted: bool,
    case_protection: CaseProtection,
) -> String {
    let cased = sentence_case_with_options(text, guess, sub_sentence, preserve_quoted);
    let open = "<case-protection>";
    let close = "</case-protection>";
    let mut source_position = 0;
    let mut cased_position = 0;
    let mut output = String::with_capacity(cased.len());

    while let (Some(source_open), Some(cased_open)) = (
        text[source_position..].find(open),
        cased[cased_position..].find(open),
    ) {
        let source_open = source_position + source_open;
        let cased_open = cased_position + cased_open;
        let source_content_start = source_open + open.len();
        let cased_content_start = cased_open + open.len();
        let Some(source_close) = text[source_content_start..].find(close) else {
            break;
        };
        let Some(cased_close) = cased[cased_content_start..].find(close) else {
            break;
        };
        let source_close = source_content_start + source_close;
        let cased_close = cased_content_start + cased_close;
        let original = &text[source_content_start..source_close];
        let transformed = &cased[cased_content_start..cased_close];

        output.push_str(&cased[cased_position..cased_open]);
        let preserve = match case_protection {
            CaseProtection::Off => true,
            CaseProtection::Strict => true,
            // As-needed protects text only when casing changed it or its original form needs it.
            CaseProtection::AsNeeded => original != transformed || needs_case_protection(original),
        };
        if preserve {
            if case_protection == CaseProtection::Off {
                // Off keeps the source spelling without adding protection markup.
                output.push_str(original);
            } else {
                // Strict and as-needed preserve this group through later consumer casing.
                output.push_str("<span class=\"nocase\">");
                output.push_str(original);
                output.push_str("</span>");
            }
        } else if case_protection == CaseProtection::AsNeeded {
            // No protection is needed, so retain the source group's spelling.
            output.push_str(original);
        } else {
            // Defensive fallback: current policies either preserve above or select the as-needed path.
            output.push_str(transformed);
        }
        source_position = source_close + close.len();
        cased_position = cased_close + close.len();
    }

    output.push_str(&cased[cased_position..]);
    output
}

/// Determine whether visible title text already follows sentence-case capitalization.
///
/// Markup is removed and nocase spans collapse to one space when their contents contain spacing.
/// Hyphenated runs count as one word. Only leading/whitespace-preceded word tokens longer than one
/// UTF-16 code unit count; prepositions, acronyms, and ordinals do not. If at least one counted
/// word has lowercase shape and those words tie or outnumber the other counted words, the title is
/// treated as already sentence-cased and left unchanged.
fn looks_sentence_cased(text: &str) -> bool {
    let visible = visible_case_text(text, true);
    let characters: Vec<char> = visible.chars().collect();
    let tokens = sentence_tokens(&characters, true, false);
    let (mut index, mut sentence_case, mut other_case) = (0, 0, 0);
    while index < tokens.len() {
        let end = hyphenated_end(&tokens, &characters, index).unwrap_or(index);
        let token = &tokens[index];
        let shape = tokens[index..=end]
            .iter()
            .map(|part| {
                if part.kind == SentenceTokenKind::Other {
                    token_text(part, &characters)
                } else {
                    part.shape.clone()
                }
            })
            .collect::<String>();
        let text_length = if end == index {
            token.text_len(&characters)
        } else {
            characters[token.start..tokens[end].end]
                .iter()
                .map(|character| character.len_utf16())
                .sum()
        };
        if token.kind != SentenceTokenKind::Word
            || text_length <= 1
            || matches!(
                token.subtype,
                SentenceTokenSubtype::Preposition
                    | SentenceTokenSubtype::Acronym
                    | SentenceTokenSubtype::Ordinal
            )
            || (index != 0 && tokens[index - 1].kind != SentenceTokenKind::Whitespace)
        {
            // Guessing counts only leading words longer than one character, excluding special token classes.
            index = end + 1;
            continue;
        }
        if !shape.contains('X') && shape.contains('x') {
            // Lowercase-shaped words support sentence case; uppercase-shaped words count against it.
            sentence_case += 1;
        } else {
            other_case += 1;
        }
        index = end + 1;
    }
    sentence_case > 0 && sentence_case >= other_case
}

/// Render one word token according to sentence position, subtype, and capitalization shape.
///
/// `token` supplies the source range, shape, and capitalization state; `characters` supplies its
/// original spelling, `all_caps` controls title-wide uppercase handling, and `in_hyphenated_run`
/// lets one-letter components lowercase instead of being treated as standalone initials.
/// Non-word types pass through, while domains lowercase and ordinary words follow the decision
/// order below.
fn sentence_word(
    token: &SentenceToken,
    characters: &[char],
    all_caps: bool,
    in_hyphenated_run: bool,
) -> String {
    let text = token.text(characters);
    // Domains are case-insensitive, so their labels are always lowercased.
    if token.kind == SentenceTokenKind::Domain {
        return text.chars().flat_map(char::to_lowercase).collect();
    }
    // Punctuation, websites, and other non-word token types are left untouched; URLs may be case-sensitive.
    if token.kind != SentenceTokenKind::Word {
        return text;
    }
    // Preserve the conventional capitalization of contractions such as `I'll` and `I'm`.
    if text.starts_with("I'") {
        return title_case(&text);
    }
    // A single `a` at the start of a sub-sentence is lowercased even at a colon boundary.
    if token.sub_sentence_start && text.eq_ignore_ascii_case("a") {
        return "a".to_string();
    }
    // Sentence starts retain their first word; in all-caps titles, normalize it to title case.
    if token.sentence_start || token.sub_sentence_start {
        return if all_caps {
            title_case(&text)
        } else {
            lower_connected_inner_words(&text)
        };
    }
    // Prepositions are normally already lowercase, but normalize them defensively.
    if token.subtype == SentenceTokenSubtype::Preposition {
        return text.chars().flat_map(char::to_lowercase).collect();
    }
    // Acronyms keep the spelling supplied by the source.
    if token.subtype == SentenceTokenSubtype::Acronym {
        return text;
    }
    // Lowercase article A; preserve other one-letter capitals only when they stand alone.
    if text.chars().count() == 1 && text.chars().next().is_some_and(char::is_uppercase) {
        return if text == "A" || in_hyphenated_run {
            text.chars().flat_map(char::to_lowercase).collect()
        } else {
            text
        };
    }
    let shape = token
        .shape
        .chars()
        .filter(|character| matches!(character, '-' | 'X' | 'x' | 'd'))
        .collect::<String>();
    if !shape.is_empty()
        && shape
            .chars()
            .all(|character| matches!(character, 'X' | 'd'))
    {
        // All-caps words and numbers are lowercased only when the whole title is all-caps.
        return if all_caps {
            text.chars().flat_map(char::to_lowercase).collect()
        } else {
            text
        };
    }
    let mut has_lower = false;
    let mixed_case = token.shape.chars().any(|character| {
        if character == 'x' {
            has_lower = true;
        }
        character == 'X' && has_lower
    });
    if mixed_case {
        // Preserve camel-case and other mixed-case tokens.
        return text;
    }
    text.chars().flat_map(char::to_lowercase).collect()
}

/// Retain the first character and lowercase the rest of a word.
fn title_case(text: &str) -> String {
    let mut characters = text.chars();
    let Some(first) = characters.next() else {
        return String::new();
    };
    first
        .to_string()
        .chars()
        .chain(characters.flat_map(char::to_lowercase))
        .collect()
}

/// Lowercase title-cased components after hyphens when a connected word begins a sentence.
fn lower_connected_inner_words(text: &str) -> String {
    let mut output = String::new();
    let mut start = 0;
    for (index, character) in text.char_indices() {
        if matches!(character, '-' | '–') {
            // Keep each separator attached to its preceding component while splitting.
            output.push_str(&text[start..index + character.len_utf8()]);
            start = index + character.len_utf8();
        }
    }
    output.push_str(&text[start..]);
    let mut parts = output.split_inclusive(['-', '–']).peekable();
    let mut result = String::new();
    let mut first = true;
    while let Some(part) = parts.next() {
        // split_inclusive keeps a trailing hyphen on its component; trim it only for casing.
        let has_separator = part.ends_with('-') || part.ends_with('–');
        let word = part.trim_end_matches(['-', '–']);
        if first {
            // The connected word begins the sentence, so preserve its first component.
            result.push_str(word);
            first = false;
        } else if title_cased_word(word) {
            // Lower components with one uppercase initial and an otherwise lowercase remainder.
            result.extend(word.chars().flat_map(char::to_lowercase));
        } else {
            // Preserve components that are already lowercase, acronym-shaped, or mixed-case.
            result.push_str(word);
        }
        if has_separator {
            // Reattach the original separator after the component's casing decision.
            result.push(part.chars().last().unwrap_or('-'));
        }
        if parts.peek().is_none() && word.is_empty() {
            result.push_str(word);
        }
    }
    result
}

/// Return whether a segment has one uppercase first letter and only lowercase letters after it.
fn title_cased_word(text: &str) -> bool {
    let mut characters = text.chars();
    characters.next().is_some_and(char::is_uppercase) && characters.all(char::is_lowercase)
}

/// Return visible text without tags, optionally omitting protected contents during case guessing.
/// Omitted whitespace becomes one separator so unprotected neighboring words do not accidentally join.
fn visible_case_text(text: &str, omit_nocase: bool) -> String {
    let characters: Vec<char> = text.chars().collect();
    let (mut index, mut preserve_depth, mut omitted_space) = (0, 0usize, false);
    let mut visible = String::new();
    while index < characters.len() {
        if characters[index] == '<'
            && let Some(relative_end) = characters[index..]
                .iter()
                .position(|character| *character == '>')
        {
            let end = index + relative_end + 1;
            let tag: String = characters[index..end].iter().collect();
            if tag.starts_with("<case-protection>") || tag.starts_with("<span class=\"nocase\"") {
                // Begin hiding a protected range from guess-mode's visible text.
                preserve_depth = 1;
            } else if preserve_depth > 0 && tag.starts_with("<span") {
                // Count nested spans so their closing tags cannot end the outer protected range.
                preserve_depth += 1;
            } else if preserve_depth > 0
                && (tag.starts_with("</span") || tag.starts_with("</case-protection>"))
            {
                preserve_depth -= 1;
                if preserve_depth == 0 && omit_nocase && omitted_space {
                    // Replace omitted whitespace with one separator so neighboring words stay apart.
                    visible.push(' ');
                    omitted_space = false;
                }
            }
            index = end;
            continue;
        }
        if preserve_depth == 0 || !omit_nocase {
            // Keep ordinary text, and keep protected text when the caller only wants tags stripped.
            visible.push(characters[index]);
        } else if is_case_whitespace(characters[index]) {
            // Remember spacing inside omitted content without exposing its protected words.
            omitted_space = true;
        }
        index += 1;
    }
    visible
}

/// Find text ranges protected by generated `nocase` spans, including nested span elements.
fn nocase_ranges(characters: &[char]) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let (mut index, mut depth, mut start) = (0, 0usize, None);
    while index < characters.len() {
        if characters[index] == '<'
            && let Some(relative_end) = characters[index..]
                .iter()
                .position(|character| *character == '>')
        {
            let end = index + relative_end + 1;
            let tag: String = characters[index..end].iter().collect();
            if depth == 0
                && (tag.starts_with("<case-protection>")
                    || tag.starts_with("<span class=\"nocase\""))
            {
                // Record only the outer protected range; nested spans stay inside it.
                depth = 1;
                start = Some(end);
            } else if depth > 0 && tag.starts_with("<span") {
                // Balance nested markup before accepting a closing tag as the range end.
                depth += 1;
            } else if depth > 0
                && (tag.starts_with("</span") || tag.starts_with("</case-protection>"))
            {
                depth -= 1;
                if depth == 0
                    && let Some(start) = start.take()
                {
                    // Emit a range only when the outer protection wrapper has closed.
                    ranges.push(start..index);
                }
            }
            index = end;
        } else {
            index += 1;
        }
    }
    ranges
}

/// Find balanced, line-local quoted ranges to preserve byte-for-byte.
fn quoted_ranges(characters: &[char]) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if characters[index] == '<'
            && let Some(relative_end) = characters[index..]
                .iter()
                .position(|character| *character == '>')
        {
            // Quotes in tag attributes are syntax, not part of the quoted title text.
            index += relative_end + 1;
            continue;
        }
        let closing = match characters[index] {
            '“' => Some('”'),
            '‘' => Some('’'),
            '"' => Some('"'),
            _ => None,
        };
        if let Some(closing) = closing {
            // Quoted protection is line-local; an unmatched opener does not protect later lines.
            let start = index;
            let mut end = index + 1;
            while end < characters.len()
                && characters[end] != closing
                && characters[end] != '\n'
                && characters[end] != '\r'
            {
                end += 1;
            }
            if end < characters.len() && characters[end] == closing {
                // Only balanced quote pairs are preserved as a range.
                ranges.push(start..end + 1);
                index = end + 1;
                continue;
            }
        }
        index += 1;
    }
    ranges
}

/// Render one AST node using its field mode and inherited title-protection context.
///
/// `node` is the syntax-tree item; `mode` selects text, math, or rich-text behavior; `verbatim`
/// bypasses text ligatures; `diagnostics` receives unsupported constructs. The remaining flags
/// carry title protection: `title_mode` enables it, `protected_ancestor` suppresses nested spans,
/// `root_scope` lets environments expose their contents to the root-group pass, and
/// `case_protection` selects `as-needed`, `strict`, or `off` behavior for marked groups.
fn render_node(
    node: &Node,
    mode: &str,
    verbatim: bool,
    diagnostics: &mut RenderDiagnostics,
    context: RenderContext,
) -> String {
    match node {
        Node::String(text, _) => {
            // URLs and other verbatim arguments retain literal tildes; ordinary TeX text uses a tie.
            render_text(text, mode, verbatim)
        }
        Node::Whitespace(_text, _) => {
            // TeX layout spaces are insignificant inside math but become one text space elsewhere.
            if mode == "math" {
                String::new()
            } else {
                " ".to_string()
            }
        }
        Node::Parbreak(_) => {
            // A paragraph boundary is structural HTML only for rich-text fields.
            if mode == "richtext" {
                "<p>".to_string()
            } else {
                " ".to_string()
            }
        }
        Node::Comment { .. } => String::new(),
        // Neither commands, whitespace, ligatures, nor brace protection are visited inside literals.
        Node::Verb(contents, _) => contents.clone(),
        // Group delimiters protect structure but are omitted from rendered field text.
        Node::Group(nodes, _) => render_nodes(
            nodes,
            mode,
            verbatim,
            diagnostics,
            RenderContext {
                title_mode: context.title_mode,
                protected_ancestor: context.protected_ancestor,
                root_scope: false,
                case_protection: context.case_protection,
            },
        ),
        Node::Expansion(nodes, _) => render_nodes(
            nodes,
            mode,
            verbatim,
            diagnostics,
            RenderContext {
                title_mode: context.title_mode,
                protected_ancestor: context.protected_ancestor,
                root_scope: false,
                case_protection: context.case_protection,
            },
        ),
        Node::InlineMath(nodes, _) => {
            // Math children use math mappings; title protection is applied to the rendered result.
            let rendered = render_nodes(
                nodes,
                "math",
                false,
                diagnostics,
                RenderContext {
                    title_mode: context.title_mode,
                    protected_ancestor: context.protected_ancestor,
                    root_scope: false,
                    case_protection: context.case_protection,
                },
            );
            if diagnostics.mark_case_groups && context.title_mode && !context.protected_ancestor {
                format!("<case-protection>{rendered}</case-protection>")
            } else if context.title_mode
                && !context.protected_ancestor
                && context.case_protection.enabled()
                && needs_case_protection(&rendered)
            {
                format!("<span class=\"nocase\">{rendered}</span>")
            } else {
                rendered
            }
        }
        Node::Environment { name, content, .. } => render_environment(
            name,
            content,
            mode,
            diagnostics,
            RenderContext {
                title_mode: context.title_mode,
                protected_ancestor: context.protected_ancestor,
                root_scope: context.root_scope,
                case_protection: context.case_protection,
            },
        ),
        Node::Macro {
            name, arguments, ..
        } => {
            let rendered = render_macro(name, arguments, mode, diagnostics, context);
            let combining_macro = unicode_mapping(&format!("\\{name}"))
                .is_some_and(|mapping| mapping.combining.is_some());
            // Macro parsing consumes arguments before this pass, so inspect retained groups here
            // to preserve title case protection on eligible root arguments.
            let protect_argument = context.title_mode
                && context.root_scope
                && !combining_macro
                && name != "href"
                && name != "allcaps"
                && !matches!(name.as_str(), "hspace" | "hskip")
                && !matches!(name.as_str(), "enquote" | "mkbibquote")
                && arguments.iter().enumerate().any(|(index, argument)| {
                    !(matches!(name.as_str(), "url" | "href") && index == 0)
                        && matches!(argument.as_slice(), [Node::Group(children, _)] if !children.is_empty() && !matches!(children[0], Node::Macro { .. }))
                });
            if diagnostics.mark_case_groups && protect_argument {
                format!("<case-protection>{rendered}</case-protection>")
            } else if protect_argument
                && context.case_protection.enabled()
                && needs_case_protection(&rendered)
            {
                format!("<span class=\"nocase\">{rendered}</span>")
            } else {
                rendered
            }
        }
    }
}

/// Convert plain-text ligatures with the generated `unicode2latex` text map.
///
/// `text` is one parsed string node. `mode == "math"` and `verbatim == true` preserve its bytes;
/// otherwise the longest matching mapping of up to three Unicode characters is emitted first.
/// The lookup checks at most three adjacent Unicode characters before copying one unchanged.
fn render_text(text: &str, mode: &str, verbatim: bool) -> String {
    if verbatim || mode == "math" {
        return text.to_string();
    }

    let characters: Vec<char> = text.chars().collect();
    let mut output = String::new();
    let mut position = 0;
    while position < characters.len() {
        let mut replacement = None;
        for width in (1..=3).rev() {
            let end = (position + width).min(characters.len());
            let key: String = characters[position..end].iter().collect();
            if let Some(mapping) = unicode_mapping(&key)
                && let Some(mapped) = mapping.text
            {
                replacement = Some((end, mapped));
                break;
            }
        }
        if let Some((end, mapped)) = replacement {
            output.push_str(mapped);
            position = end;
        } else {
            output.push(characters[position]);
            position += 1;
        }
    }
    output
}

/// Render one parsed macro argument, returning empty text when it is absent.
///
/// `arguments` and `index` select the argument; `mode`, `verbatim`, and `diagnostics` are forwarded
/// to its child renderer. Arguments are not root scope; the owning macro inspects retained groups
/// when applying title case protection.
fn render_argument(
    arguments: &[Vec<Node>],
    index: usize,
    mode: &str,
    verbatim: bool,
    diagnostics: &mut RenderDiagnostics,
    case_protection: CaseProtection,
) -> String {
    arguments
        .get(index)
        .map(|argument| {
            render_nodes(
                argument,
                mode,
                verbatim,
                diagnostics,
                RenderContext {
                    title_mode: mode == "title",
                    protected_ancestor: false,
                    root_scope: false,
                    case_protection,
                },
            )
        })
        .unwrap_or_default()
}

/// Reconstruct a URL argument as raw TeX, unwrapping one argument group.
///
/// Commands and formatting inside the destination remain literal instead of being rendered.
fn serialize_verbatim_argument(arguments: &[Vec<Node>], index: usize) -> String {
    let Some(argument) = arguments.get(index) else {
        return String::new();
    };
    if let [Node::Group(children, _)] = argument.as_slice() {
        serialize_nodes(children)
    } else {
        serialize_nodes(argument)
    }
}

/// Render a macro using structural cases before exact generated Unicode mappings.
///
/// `name` is the TeX command without its escape token, `arguments` are the parser-consumed child
/// lists, `mode` selects text/math/rich-text semantics, and `diagnostics` collects unsupported
/// commands. Explicit visitor cases handle layout and markup; remaining commands use exact mode
/// mappings, combining marks, then source-preserving unsupported fallback.
fn render_macro(
    name: &str,
    arguments: &[Vec<Node>],
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
    context: RenderContext,
) -> String {
    let case_protection = context.case_protection;
    match name {
        "discretionary" => {
            // Bibliographic text has no line wrapping, so use TeX's unbroken (third) alternative.
            return render_argument(arguments, 2, mode, false, diagnostics, case_protection);
        }
        "allcaps" => {
            let content = render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            return if context.title_mode && diagnostics.mark_case_groups {
                format!("<case-protection>{content}</case-protection>")
            } else if context.title_mode && case_protection.enabled() {
                format!("<span class=\"nocase\">{content}</span>")
            } else {
                content
            };
        }
        " " => return " ".to_string(),
        // Line breaks are HTML breaks in rich text and ordinary spaces in scalar fields.
        "\\" => return if mode == "richtext" { "<br>" } else { " " }.to_string(),
        "url" => {
            // URL content is rendered verbatim so query strings and tildes are not transformed.
            let url = serialize_verbatim_argument(arguments, 0);
            return if diagnostics.plain_urls {
                format!("<span class=\"nocase\">{url}</span>")
            } else {
                format!("<a href=\"{url}\">{url}</a>")
            };
        }
        "href" => {
            // The first href argument is the destination; only the label receives normal rendering.
            let url = serialize_verbatim_argument(arguments, 0);
            if diagnostics.plain_urls {
                return format!("<span class=\"nocase\">{url}</span>");
            }
            let label = render_argument(
                arguments,
                1,
                if mode == "title" { "literal" } else { mode },
                false,
                diagnostics,
                CaseProtection::Off,
            );
            return format!("<a href=\"{url}\">{label}</a>");
        }
        "textbf" | "mkbibbold" => {
            // Render the argument inside a bold wrapper.
            let content = render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            return if content.is_empty() {
                String::new()
            } else {
                format!("<b>{content}</b>")
            };
        }
        "textit" | "textsl" | "emph" | "mkbibemph" => {
            // Render the argument inside an emphasis wrapper.
            let content = render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            return if content.is_empty() {
                String::new()
            } else {
                format!("<i>{content}</i>")
            };
        }
        "textsc" => {
            // Render the argument inside a small-caps wrapper.
            let content = render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            return if content.is_empty() {
                String::new()
            } else {
                format!("<span style=\"font-variant:small-caps;\">{content}</span>")
            };
        }
        "texttt" => {
            // Render the argument inside a code wrapper.
            let content = render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            return if content.is_empty() {
                String::new()
            } else {
                format!("<code>{content}</code>")
            };
        }
        "textrm" | "textup" | "mathrm" | "mbox" | "hbox" | "rlap" => {
            // These macros affect TeX layout, not the resulting characters.
            return render_argument(arguments, 0, mode, false, diagnostics, case_protection);
        }
        // TeX controls too complex to interpret are intentionally omitted from field text.
        "vphantom" | "noopsort" | "left" | "right" | "ensuremath" | "wd" | "ht" | "raise"
        | "accent" | "def" | "hss" | "ifmmode" | "makeatletter" | "makeatother"
        | "scriptscriptstyle" | "setbox" | "dimen" | "advance" | "relax" | "aftergroup"
        | "ignorespaces" | "undefined" | "rm" | "if" | "ifx" | "else" => return String::new(),
        "sc" => return String::new(),
        "hspace" | "hskip" => {
            // Empty and zero-valued dimensions add no space; other dimensions add one space.
            let amount = arguments
                .first()
                .map(|argument| serialize_nodes(argument))
                .unwrap_or_default();
            let amount = amount.trim_matches(['{', '}']);
            return if amount.is_empty()
                || (amount.starts_with('0') && amount[1..].chars().all(char::is_alphabetic))
            {
                String::new()
            } else {
                " ".to_string()
            };
        }
        "bar" | "overline" => {
            // Append a combining macron to ASCII letters and digits only.
            let value = render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            return value
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() {
                        format!("{character}\u{0305}")
                    } else {
                        character.to_string()
                    }
                })
                .collect();
        }
        "symbol" => {
            let code = arguments
                .first()
                .map(|argument| serialize_argument(argument))
                .unwrap_or_default();
            if let Ok(code) = code.trim().parse::<u32>() {
                if let Some(character) = char::from_u32(code) {
                    return character.to_string();
                }
            }
        }
        "enquote" | "mkbibquote" => {
            // Render quoted content with curly quotation marks.
            let mut content =
                render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            let protected_root_argument = context.title_mode
                && context.root_scope
                && !context.protected_ancestor
                && matches!(arguments.first().map(Vec::as_slice), Some([Node::Group(children, _)]) if !children.is_empty() && !matches!(children[0], Node::Macro { .. }));
            if protected_root_argument && diagnostics.mark_case_groups {
                content = format!("<case-protection>{content}</case-protection>");
            } else if protected_root_argument
                && case_protection.enabled()
                && needs_case_protection(&content)
            {
                content = format!("<span class=\"nocase\">{content}</span>");
            }
            return if content.is_empty() {
                String::new()
            } else {
                format!("“{content}”")
            };
        }
        "section" | "subsection" | "subsubsection" | "subsubsubsection" => {
            // Heading depth is the command name's number of `sub` components.
            let level = name.split("sub").count();
            let content = render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            return if content.is_empty() {
                String::new()
            } else {
                format!("<h{level}>{content}</h{level}>")
            };
        }
        "chsf" | "bibstring" | "cite" | "textcite" | "citeauthor" => {
            // These commands contribute their argument text without additional markup.
            return render_argument(arguments, 0, mode, false, diagnostics, case_protection);
        }
        "LaTeX" => {
            let superscript = script_text("A", "^").unwrap_or_else(|| "<sup>A</sup>".to_string());
            let subscript = script_text("E", "_").unwrap_or_else(|| "<sub>E</sub>".to_string());
            return format!("L{superscript}T{subscript}X");
        }
        "sp" | "textsuperscript" => {
            return render_script_argument(arguments, 0, "^", mode, diagnostics, case_protection);
        }
        "sb" | "textsubscript" => {
            return render_script_argument(arguments, 0, "_", mode, diagnostics, case_protection);
        }
        "math^" | "math_" => {
            let script = if name == "math^" { "^" } else { "_" };
            return render_script_argument(
                arguments,
                0,
                script,
                mode,
                diagnostics,
                case_protection,
            );
        }
        "^" | "_" if mode == "math" => {
            return render_script_argument(arguments, 0, name, mode, diagnostics, case_protection);
        }
        "frac" if mode == "math" => {
            // Prefer an exact fraction mapping; otherwise compose mapped numerator and denominator scripts.
            let latex = serialize_macro(name, arguments);
            if let Some(mapping) = unicode_mapping(&latex)
                && let Some(text) = mapping.math.or(mapping.text)
            {
                return text.to_string();
            }
            let numerator =
                render_argument(arguments, 0, mode, false, diagnostics, case_protection);
            let denominator =
                render_argument(arguments, 1, mode, false, diagnostics, case_protection);
            return match (script_text(&numerator, "^"), script_text(&denominator, "_")) {
                (Some(numerator), Some(denominator)) => format!("{numerator}\u{2044}{denominator}"),
                _ => latex,
            };
        }
        "par" => return if mode == "richtext" { "<p>" } else { " " }.to_string(),
        "item" => return if mode == "richtext" { "<li>" } else { " " }.to_string(),
        "_" | "^" if arguments.is_empty() => return name.to_string(),
        _ => {}
    }

    // Command-only table entries identify combining accents; composed mappings include arguments.
    let command = format!("\\{name}");
    if let Some(mapping) = unicode_mapping(&command)
        && let Some(mark) = mapping.combining
    {
        if let Some(value) = combining_argument(arguments, mark, mode) {
            return value;
        }
        if mode == "creatorlist" {
            return name.to_string();
        }
    }

    // Exact TeX spellings use the generated Unicode map only after structural visitor cases.
    let latex = serialize_macro(name, arguments);
    if let Some(mapping) = unicode_mapping(&latex) {
        // Use only a mapping defined for the active text or math mode.
        let mapped_text = if mode == "math" {
            mapping.math
        } else {
            mapping.text
        };
        if let Some(text) = mapped_text {
            return text.to_string();
        }
    }

    diagnostics.report("macro", name, latex.clone());
    diagnostics.render_unsupported(&command, &latex)
}

/// Apply a combining accent when its argument has a supported single-node shape.
///
/// Some legacy input represents the base as an unknown one-letter control word, such as
/// `\'{\a}`. That letter is treated as plain base text only here, after checking for a Unicode
/// mapping; unsupported macros elsewhere continue through the normal unsupported handler.
fn combining_argument(arguments: &[Vec<Node>], mark: &str, mode: &str) -> Option<String> {
    // Missing or empty arguments produce a spacing accent; ambiguous multi-node arguments are
    // rejected rather than flattened into guessed text.
    let Some(argument) = arguments.first() else {
        return Some(format!(" {mark}"));
    };
    if arguments.len() != 1 || argument.is_empty() {
        return Some(format!(" {mark}"));
    }
    if argument.len() != 1 {
        return None;
    }
    let node = match &argument[0] {
        Node::Group(children, _) => match children.as_slice() {
            [] => return Some(format!(" {mark}")),
            [node] => node,
            _ => return None,
        },
        node => node,
    };
    let value = match node {
        Node::String(value, _) | Node::Verb(value, _) => value.clone(),
        Node::Macro {
            name, arguments, ..
        } => {
            let latex = serialize_macro(name, arguments);
            if let Some(mapping) = unicode_mapping(&latex) {
                if mode == "math" {
                    mapping.math.or(mapping.text)?.to_string()
                } else {
                    mapping.text?.to_string()
                }
            // The accent is known, but a legacy one-letter base command such as `\a` is not.
            // Use its letter only when it has no arguments; do not change general macro fallback.
            } else if arguments.is_empty()
                && name.len() == 1
                && name.as_bytes()[0].is_ascii_alphabetic()
            {
                name.clone()
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some(format!("{value}{mark}"))
}

/// Render supported environment nodes or report unsupported ones without visiting their bodies.
///
/// `name` and `content` identify the parsed environment; `mode` controls rich-text wrappers;
/// `diagnostics` collects unsupported environments. Title flags are forwarded to supported
/// descendants. Leading/trailing whitespace, paragraph breaks, and `\\par` are trimmed before
/// known content is rendered. Unknown environments are reported as one construct and preserved as
/// TeX, so nested body macros do not create extra diagnostics. At field root, a supported
/// environment's body retains root scope for title case protection.
fn render_environment(
    name: &str,
    content: &[Node],
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
    context: RenderContext,
) -> String {
    let trims_environment_edge = |node: &Node| match node {
        Node::Whitespace(_, _) | Node::Parbreak(_) => true,
        Node::Macro { name, .. } => name == "par",
        _ => false,
    };
    let mut start = 0;
    let mut end = content.len();
    // Discard layout-only nodes at both environment edges.
    while start < end && trims_environment_edge(&content[start]) {
        start += 1;
    }
    while end > start && trims_environment_edge(&content[end - 1]) {
        end -= 1;
    }
    match name {
        "quotation" | "itemize" | "em" => {
            // The `em` environment emphasizes its body in every field mode.
            let body = render_nodes(
                &content[start..end],
                mode,
                false,
                diagnostics,
                RenderContext {
                    title_mode: context.title_mode,
                    protected_ancestor: context.protected_ancestor,
                    root_scope: context.root_scope,
                    case_protection: context.case_protection,
                },
            )
            .trim()
            .to_string();
            if mode != "richtext" {
                if name == "em" {
                    return format!("<i>{body}</i>");
                }
                return body;
            }
            match name {
                "quotation" => format!("<blockquote>{body}</blockquote>"),
                "itemize" => format!("<ul>{body}</ul>"),
                _ => format!("<i>{body}</i>"),
            }
        }
        // Do not recurse into unknown environments: their complete source is one unsupported node.
        _ => {
            let source = format!(
                "\\begin{{{name}}}{}\\end{{{name}}}",
                serialize_nodes(&content[start..end])
            );
            diagnostics.report("environment", name, source.clone());
            diagnostics.render_unsupported(&source, &source)
        }
    }
}

/// Render a superscript or subscript argument as Unicode when every character has a mapping.
///
/// `arguments` and `index` select the parsed value; `script_macro` is `^` or `_`; `mode` is carried
/// into child rendering; `diagnostics` collects any unsupported commands inside the argument. If
/// a character has no script mapping, the whole argument falls back to an HTML `sup`/`sub` wrapper.
fn render_script_argument(
    arguments: &[Vec<Node>],
    index: usize,
    script_macro: &str,
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
    case_protection: CaseProtection,
) -> String {
    let value = render_argument(arguments, index, mode, false, diagnostics, case_protection);
    if let Some(script) = script_text(&value, script_macro) {
        script
    } else {
        let tag = if script_macro == "^" { "sup" } else { "sub" };
        format!("<{tag}>{value}</{tag}>")
    }
}

/// Convert a string to Unicode script characters, returning `None` on the first unmapped character.
///
/// `value` is rendered argument text and `script_macro` selects the generated `^{x}` or `_{x}` key.
fn script_text(value: &str, script_macro: &str) -> Option<String> {
    value
        .chars()
        .map(|character| {
            let key = format!("{script_macro}{{{character}}}");
            unicode_mapping(&key)
                .and_then(|mapping| mapping.math.or(mapping.text))
                .map(str::to_owned)
        })
        .collect()
}

/// Binary-search the compile-generated, byte-sorted Unicode mapping table.
fn unicode_mapping(latex: &str) -> Option<&'static UnicodeMapping> {
    UNICODE_MAPPINGS
        .binary_search_by_key(&latex, |mapping| mapping.key)
        .ok()
        .map(|index| &UNICODE_MAPPINGS[index])
}

/// Reconstruct a macro and its braced arguments for exact Unicode-table lookup.
fn serialize_macro(name: &str, arguments: &[Vec<Node>]) -> String {
    serialize_macro_with_mode(name, arguments, false)
}

/// Reconstruct a macro, converting internal math-script names back to their TeX operators.
/// Lookup mode braces ungrouped arguments; raw-print mode leaves them bare and normalizes layout.
fn serialize_macro_with_mode(name: &str, arguments: &[Vec<Node>], print_raw: bool) -> String {
    let mut source = match name {
        "math^" => "^".to_string(),
        "math_" => "_".to_string(),
        _ => format!("\\{name}"),
    };
    for argument in arguments {
        // Reuse retained source groups; adding another wrapper would change exact mapping keys.
        if matches!(argument.as_slice(), [Node::Group(_, _)]) {
            source.push_str(&serialize_nodes_with_mode(argument, print_raw));
        } else if print_raw {
            source.push_str(&serialize_nodes_with_mode(argument, true));
        } else {
            source.push('{');
            source.push_str(&serialize_nodes_with_mode(argument, print_raw));
            source.push('}');
        }
    }
    source
}

/// Serialize argument contents, stripping exactly one enclosing AST group when it is the sole node.
fn serialize_argument(argument: &[Node]) -> String {
    match argument {
        [Node::Group(children, _)] => serialize_nodes(children),
        _ => serialize_nodes(argument),
    }
}

/// Reconstruct source from a node sequence, preserving group and macro boundaries.
fn serialize_nodes(nodes: &[Node]) -> String {
    serialize_nodes_with_mode(nodes, false)
}

/// Reconstruct TeX with each whitespace or paragraph node normalized to a single space.
fn serialize_print_raw_nodes(nodes: &[Node]) -> String {
    serialize_nodes_with_mode(nodes, true)
}

/// Reconstruct canonical TeX, optionally normalizing layout nodes to spaces for raw field output.
/// This is not lossless source recovery: expansions use their bodies and math delimiters become `$`.
fn serialize_nodes_with_mode(nodes: &[Node], print_raw: bool) -> String {
    nodes
        .iter()
        .map(|node| match node {
            Node::String(text, _) => text.clone(),
            Node::Whitespace(text, _) => {
                if print_raw {
                    " ".to_string()
                } else {
                    text.clone()
                }
            }
            Node::Parbreak(_) => {
                if print_raw {
                    " ".to_string()
                } else {
                    "\n\n".to_string()
                }
            }
            Node::Comment { content, .. } => format!("%{content}"),
            Node::Verb(contents, _) => contents.clone(),
            Node::Group(children, _) => {
                format!("{{{}}}", serialize_nodes_with_mode(children, print_raw))
            }
            Node::Expansion(children, _) => serialize_nodes_with_mode(children, print_raw),
            Node::InlineMath(children, _) => {
                // The AST deliberately unifies dollar, parenthesis, and bracket math delimiters.
                format!("${}$", serialize_nodes_with_mode(children, print_raw))
            }
            Node::Environment { name, content, .. } => {
                format!(
                    "\\begin{{{name}}}{}\\end{{{name}}}",
                    serialize_nodes_with_mode(content, print_raw)
                )
            }
            Node::Macro {
                name, arguments, ..
            } => serialize_macro_with_mode(name, arguments, print_raw),
        })
        .collect()
}
