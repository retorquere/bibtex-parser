use std::collections::{HashMap, HashSet};

/// A source position using the TypeScript parser's UTF-16 offset and 1-based coordinates.
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
        /// TypeScript-compatible range, possibly including leading whitespace or one line ending.
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
    /// A math fragment whose macros use math-mode mappings and arity rules.
    InlineMath(Vec<Node>, SourceSpan),
    /// A matched environment's name and recursively parsed body.
    Environment {
        name: String,
        content: Vec<Node>,
        span: SourceSpan,
    },
    /// Literal contents delimited by the TeX `\verb` macro.
    Verb(String, SourceSpan),
    /// A TypeScript-style macro node with its name and parsed arguments.
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
/// One entry in the compile-generated `unicode2latex` conversion table.
struct UnicodeMapping {
    key: &'static str,
    text: Option<&'static str>,
    math: Option<&'static str>,
    combining: Option<&'static str>,
}

include!(concat!(env!("OUT_DIR"), "/unicode_tables.rs"));

/// Stored metadata for a user-defined TeX macro.
///
/// `arity` counts required parameters; `optional` stores the default value for an
/// optional bracket argument when the definition uses the TypeScript style
/// `\newcommand{\foo}[n][default]{...}` form. The replacement `body` is kept as
/// an AST so it can be expanded with parameter substitution later.
#[derive(Debug, Clone, PartialEq, Eq)]
struct MacroDefinition {
    arity: usize,
    optional: Option<Vec<Node>>,
    body: Vec<Node>,
}

/// Recursive-descent parser state for one TeX fragment.
struct Parser {
    chars: Vec<char>,
    positions: Vec<SourcePosition>,
    position: usize,
    /// Active environment names; inner parsers return parent terminators without consuming them.
    environment_ends: Vec<String>,
    newcommands: HashMap<String, MacroDefinition>,
}

impl Parser {
    /// Create a character-indexed parser over a field value.
    fn new(source: &str) -> Self {
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
            newcommands: HashMap::new(),
        }
    }

    /// Convert character-indexed parser bounds into the TypeScript-compatible source range.
    fn span(&self, start: usize, end: usize) -> SourceSpan {
        SourceSpan {
            start: self.positions[start],
            end: self.positions[end],
        }
    }

    /// Translate a UTF-16 source offset back to the parser's character index.
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
            | Node::InlineMath(_, span)
            | Node::Verb(_, span) => *span,
            Node::Comment { span, .. }
            | Node::Environment { span, .. }
            | Node::Macro { span, .. } => *span,
        }
    }

    /// Parse nodes until the source ends or the matching group delimiter is reached.
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
                '{' => {
                    // Retain group structure so rendering and later case-protection passes can inspect it.
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    self.position += 1;
                    let (content, matched) = self.sequence(true, math, environment_end);
                    if matched {
                        nodes.push(Node::Group(content, self.span(start, self.position)));
                    } else {
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
                                .map(|argument| serialize_nodes(argument))
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
                                    serialize_nodes(argument).trim() == expected
                                })
                            }) =>
                        {
                            return (nodes, true);
                        }
                        Node::Macro {
                            name, arguments, ..
                        } if name == "end"
                            && arguments.first().is_some_and(|argument| {
                                let end_name = serialize_nodes(argument).trim().to_string();
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
                            self.skip_ifdefined();
                        }
                        Node::Macro { name, .. } if name == "else" || name == "fi" => {}
                        Node::Macro {
                            name,
                            arguments,
                            span,
                        } if name == "newcommand" || name == "ProvideTextCommandDefault" => {
                            if !self.register_macro(&arguments) {
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
                        } if self.newcommands.contains_key(&name) => {
                            nodes.extend(self.expand_macro(&name, 0, &arguments, span));
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
                    if line_breaks == 1 {
                        self.position = line_ending_end;
                    }
                    nodes.push(Node::Comment {
                        content: comment,
                        span: self.span(comment_start, self.position),
                        sameline,
                        leading_whitespace,
                        suffix_parbreak,
                    });
                    if suffix_parbreak {
                        nodes.push(Node::Parbreak(self.span(content_end, line_ending_end)));
                        self.position = line_ending_end;
                    }
                }
                ch if ch.is_whitespace() && !matches!(ch, '\n' | '\r') => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    let mut whitespace = String::new();
                    while self.position < self.chars.len()
                        && self.chars[self.position].is_whitespace()
                        && !matches!(self.chars[self.position], '\n' | '\r')
                    {
                        whitespace.push(self.chars[self.position]);
                        self.position += 1;
                    }
                    nodes.push(Node::Whitespace(
                        whitespace,
                        self.span(start, self.position),
                    ));
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
                        nodes.push(Node::Parbreak(self.span(start, self.position)));
                    } else {
                        nodes.push(Node::Whitespace(
                            self.chars[start..self.position].iter().collect(),
                            self.span(start, self.position),
                        ));
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

    /// Parse a macro name and consume the arguments required by its arity.
    ///
    /// The key distinction is that custom call sites may include an optional
    /// bracket argument before the required braced parameters, while ordinary
    /// built-ins follow the `narguments` table and never consume optional braces.
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
        if name == "verb" {
            return self.verbatim(macro_start);
        }

        let mut arguments = Vec::new();
        let parse_custom_definition =
            matches!(name.as_str(), "newcommand" | "ProvideTextCommandDefault");
        let custom_arity = self
            .newcommands
            .get(&name)
            .map(|definition| {
                let base = definition.arity;
                let optional = definition.optional.is_some();
                if optional && self.peek_non_space_char() == Some('[') {
                    base
                } else if optional {
                    base.saturating_sub(1)
                } else {
                    base
                }
            })
            .unwrap_or_else(|| macro_arity(&name, math.is_some()));

        if parse_custom_definition {
            // A custom definition is parsed in a very specific order:
            //   1. macro name
            //   2. optional arity count (for `\newcommand{\foo}[2]{...}`)
            //   3. optional default argument in `[...]`
            //   4. replacement body in `{...}`
            self.skip_argument_space();
            if self.position < self.chars.len() {
                arguments.push(self.argument(math, environment_end));
            }
            while self.position < self.chars.len() && self.peek_non_space_char() == Some('[') {
                self.skip_argument_space();
                if self.position < self.chars.len() && self.chars[self.position] == '[' {
                    arguments.push(self.parse_bracketed_argument(math, environment_end));
                }
            }
            self.skip_argument_space();
            if self.position < self.chars.len() && self.chars[self.position] == '{' {
                arguments.push(self.argument(math, environment_end));
            }
        } else {
            for _ in 0..custom_arity {
                // TeX permits whitespace between a macro name and its braced arguments.
                self.skip_argument_space();
                if self.position == self.chars.len() {
                    break;
                }
                if self
                    .newcommands
                    .get(&name)
                    .and_then(|definition| definition.optional.as_ref())
                    .is_some()
                    && self.peek_non_space_char() == Some('[')
                {
                    arguments.push(self.parse_bracketed_argument(math, environment_end));
                } else {
                    arguments.push(self.argument(math, environment_end));
                }
            }
        }
        if alphabetic_name
            && custom_arity == 0
            && self.position < self.chars.len()
            && self.chars[self.position].is_whitespace()
        {
            // The delimiter after a zero-argument alphabetic macro is syntax, not rendered text.
            self.position += 1;
        }
        Node::Macro {
            name,
            arguments,
            span: macro_span,
        }
    }

    /// Skip whitespace before a macro argument, as the TypeScript argument reader does.
    fn skip_argument_space(&mut self) {
        while self.position < self.chars.len() && self.chars[self.position].is_whitespace() {
            self.position += 1;
        }
    }

    /// Look ahead past whitespace to the next concrete token.
    ///
    /// This is used to distinguish a macro call like `\foo[default]{arg}` from a
    /// regular braced argument where whitespace before `[` should not matter.
    fn peek_non_space_char(&self) -> Option<char> {
        let mut index = self.position;
        while index < self.chars.len() && self.chars[index].is_whitespace() {
            index += 1;
        }
        self.chars.get(index).copied()
    }

    /// Parse a bracketed optional argument, omitting the surrounding delimiters.
    ///
    /// The optional default value is preserved as a normal node list so it can be
    /// substituted later by `#1`-style parameter expansion without discarding the
    /// original group structure.
    fn parse_bracketed_argument(
        &mut self,
        math: Option<MathDelimiter>,
        environment_end: Option<&str>,
    ) -> Vec<Node> {
        debug_assert_eq!(self.chars[self.position], '[');
        self.position += 1;
        let mut nodes = Vec::new();
        let mut text = String::new();
        let mut text_start = None;
        while self.position < self.chars.len() {
            match self.chars[self.position] {
                ']' => {
                    self.position += 1;
                    break;
                }
                '{' => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    let start = self.position;
                    self.position += 1;
                    let (content, matched) = self.sequence(true, math, environment_end);
                    if matched {
                        nodes.push(Node::Group(content, self.span(start, self.position)));
                    } else {
                        nodes.push(Node::String("{".to_string(), self.span(start, start + 1)));
                        nodes.extend(content);
                    }
                }
                '\\' => {
                    self.flush_text(&mut nodes, &mut text, &mut text_start);
                    nodes.push(self.parse_macro(math, environment_end));
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
        nodes
    }

    /// Parse a braced macro argument, nested macro, or single-token argument.
    fn argument(
        &mut self,
        math: Option<MathDelimiter>,
        environment_end: Option<&str>,
    ) -> Vec<Node> {
        // Braced arguments retain their children as nodes but omit delimiter tokens from the child list.
        if self.chars[self.position] == '{' {
            let start = self.position;
            self.position += 1;
            let (mut content, matched) = self.sequence(true, math, environment_end);
            if !matched {
                content.insert(
                    0,
                    Node::String("{".to_string(), self.span(start, start + 1)),
                );
            }
            content
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

    /// Parse a delimited `\\verb` token and retain its source range including delimiters.
    fn verbatim(&mut self, start: usize) -> Node {
        if self.chars.get(self.position) == Some(&'*') {
            self.position += 1;
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

    /// Register a custom macro definition using the TypeScript AST layout.
    ///
    /// The first argument names the command; the rest are either:
    /// - a bare replacement body for `\newcommand{\name}{body}`
    /// - a count + replacement body for `\newcommand{\name}[2]{body}`
    /// - a count + default + replacement body for `\newcommand{\name}[2][default]{body}`
    fn register_macro(&mut self, arguments: &[Vec<Node>]) -> bool {
        // TypeScript requires the first argument to contain a macro node naming the definition.
        let Some(Node::Macro { name, .. }) =
            arguments.first().and_then(|argument| argument.first())
        else {
            return false;
        };

        let tail: Vec<&Vec<Node>> = arguments.iter().skip(1).collect();
        let mut arity = 0usize;
        let mut optional: Option<Vec<Node>> = None;
        let mut replacement: Option<Vec<Node>> = None;

        if let Some(argument) = tail.first().copied() {
            if let Some(count) = extract_newcommand_arity(argument) {
                arity = count;
                match tail.len() {
                    2 => replacement = Some(tail[1].clone()),
                    len if len > 2 => {
                        // A second bracketed value is the optional default for the first
                        // parameter; the final item is always the replacement body.
                        optional = Some(tail[1].clone());
                        replacement = Some(tail[len - 1].clone());
                    }
                    _ => {}
                }
            } else {
                replacement = Some(argument.clone());
            }
        }

        let Some(replacement) = replacement else {
            return false;
        };

        self.newcommands.insert(
            name.clone(),
            MacroDefinition {
                arity,
                optional,
                body: replacement,
            },
        );
        true
    }

    /// Expand nested custom macros with a recursion limit for self-referential definitions.
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
        self.newcommands
            .get(name)
            .map(|definition| {
                let actual = resolve_macro_arguments(definition, arguments);
                let substituted = substitute_parameters(&definition.body, &actual);
                self.expand_nodes(&substituted, depth + 1)
            })
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
                } if self.newcommands.contains_key(name) => {
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
                        // Match TypeScript's current rule: discard content from both branches.
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

/**
 * Detect the parameter-count marker used by a custom `\newcommand` definition.
 *
 * In a definition like `\newcommand{\foo}[2]{...}` or
 * `\newcommand{\foo}[2][default]{...}`, the bracketed integer is not part of the
 * replacement body. It tells us how many `#1`, `#2`, ... placeholders the macro
 * expects. This helper recognizes only that custom-definition slot and leaves all
 * other AST fragments alone.
 */
fn extract_newcommand_arity(argument: &[Node]) -> Option<usize> {
    let literal = serialize_nodes(argument).trim().to_string();
    if literal.is_empty() {
        None
    } else {
        literal.parse::<usize>().ok()
    }
}

/// Resolve the actual parameter list for a custom macro.
///
/// If the definition includes an optional default argument, the first actual call
/// value is inserted as the default when the caller omits it. Otherwise the call
/// arguments are used as-is, with missing values left empty to preserve TeX's
/// parameter semantics as much as possible.
fn resolve_macro_arguments(
    definition: &MacroDefinition,
    arguments: &[Vec<Node>],
) -> Vec<Vec<Node>> {
    let mut resolved = if let Some(optional) = &definition.optional {
        if arguments.len() == definition.arity {
            let mut params = vec![arguments[0].clone()];
            params.extend(arguments.iter().skip(1).cloned());
            params
        } else {
            let mut params = vec![optional.clone()];
            params.extend(arguments.iter().cloned());
            params
        }
    } else {
        arguments.to_vec()
    };

    while resolved.len() < definition.arity {
        resolved.push(Vec::new());
    }

    resolved.truncate(definition.arity.max(1));
    resolved
}

/// Substitute `#1`, `#2`, ... placeholders in a stored macro body.
///
/// The implementation walks the AST and only rewrites the parameter markers in
/// string nodes while preserving nested groups, math, environments, and other
/// structural nodes. This keeps the replacement tree faithful to the original
/// source structure while expanding the actual arguments.
fn substitute_parameters(nodes: &[Node], parameters: &[Vec<Node>]) -> Vec<Node> {
    let mut output = Vec::new();
    for node in nodes {
        match node {
            Node::String(text, span) => {
                let chars: Vec<char> = text.chars().collect();
                let mut index = 0usize;
                let mut last = 0usize;
                while index < chars.len() {
                    if chars[index] == '#' {
                        if index + 1 < chars.len() && chars[index + 1] == '#' {
                            if last < index {
                                output
                                    .push(Node::String(chars[last..index].iter().collect(), *span));
                            }
                            output.push(Node::String('#'.to_string(), *span));
                            index += 2;
                            last = index;
                            continue;
                        }
                        if index + 1 < chars.len() && chars[index + 1].is_ascii_digit() {
                            if last < index {
                                output
                                    .push(Node::String(chars[last..index].iter().collect(), *span));
                            }
                            let mut end = index + 2;
                            while end < chars.len() && chars[end].is_ascii_digit() {
                                end += 1;
                            }
                            let parameter_index = chars[index + 1..end]
                                .iter()
                                .collect::<String>()
                                .parse::<usize>()
                                .unwrap_or_default();
                            if let Some(argument) =
                                parameters.get(parameter_index.saturating_sub(1))
                            {
                                output.extend(argument.iter().cloned());
                            }
                            index = end;
                            last = index;
                            continue;
                        }
                    }
                    index += 1;
                }
                if last < chars.len() {
                    output.push(Node::String(chars[last..].iter().collect(), *span));
                }
            }
            Node::Whitespace(text, span) => output.push(Node::Whitespace(text.clone(), *span)),
            Node::Parbreak(span) => output.push(Node::Parbreak(*span)),
            Node::Comment {
                content,
                span,
                sameline,
                leading_whitespace,
                suffix_parbreak,
            } => output.push(Node::Comment {
                content: content.clone(),
                span: *span,
                sameline: *sameline,
                leading_whitespace: *leading_whitespace,
                suffix_parbreak: *suffix_parbreak,
            }),
            Node::Group(children, span) => output.push(Node::Group(
                substitute_parameters(children, parameters),
                *span,
            )),
            Node::InlineMath(children, span) => output.push(Node::InlineMath(
                substitute_parameters(children, parameters),
                *span,
            )),
            Node::Environment {
                name,
                content,
                span,
            } => output.push(Node::Environment {
                name: name.clone(),
                content: substitute_parameters(content, parameters),
                span: *span,
            }),
            Node::Macro {
                name,
                arguments,
                span,
            } => output.push(Node::Macro {
                name: name.clone(),
                arguments: arguments
                    .iter()
                    .map(|argument| substitute_parameters(argument, parameters))
                    .collect(),
                span: *span,
            }),
            Node::Verb(_, _) => output.push(node.clone()),
        }
    }
    output
}

/// Return the argument arity for markup macros and combining macros.
fn macro_arity(name: &str, in_math: bool) -> usize {
    // Accent arity comes from the generated combining table rather than a second accent list.
    if unicode_mapping(&format!("\\{name}")).is_some_and(|mapping| mapping.combining.is_some()) {
        return 1;
    }
    // This is the TypeScript narguments table; underscore/caret are argument-taking only in math.
    match name {
        "frac" | "href" | "newcommand" | "ProvideTextCommandDefault" => 2,
        "advance" | "ElsevierGlyph" | "bar" | "begin" | "end" | "bibcyr" | "bibstring" | "chsf"
        | "cite" | "citeauthor" | "cyrchar" | "ding" | "emph" | "enquote" | "hbox" | "hskip"
        | "hspace" | "ht" | "mathrm" | "mbox" | "mkbibbold" | "mkbibemph" | "mkbibitalic"
        | "mkbibquote" | "noopsort" | "ocirc" | "overline" | "rlap" | "sb" | "section" | "sp"
        | "subsection" | "subsubsection" | "subsubsubsection" | "t" | "textbf" | "textcite"
        | "textit" | "textrm" | "textsc" | "textsl" | "textsubscript" | "textsuperscript"
        | "texttt" | "textup" | "url" | "vphantom" | "vspace" | "wd" => 1,
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

/// Collects unsupported TeX constructs while normalized fields are rendered.
///
/// Diagnostics are shared across every field in one library normalization so a macro
/// or environment is reported only once, matching the TypeScript parser's library-level set.
#[derive(Default)]
pub(crate) struct RenderDiagnostics {
    /// First error for each unsupported construct, in the order it was encountered.
    pub(crate) errors: Vec<super::ParseError>,
    /// Stable kind/name identifiers used to suppress duplicate macro and environment errors.
    unhandled: HashSet<String>,
}

impl RenderDiagnostics {
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

/// Parse, visit, and trim a TeX fragment using its field rendering mode.
///
/// This test-only convenience function discards unsupported-construct diagnostics; production
/// normalization calls `render_with_diagnostics` so those errors reach `ParsedLibrary.errors`.
/// `source` is the raw field value and `mode` is a field mode such as `title` or `richtext`.
#[cfg(test)]
pub(crate) fn render(source: &str, mode: &str) -> String {
    render_with_diagnostics(source, mode, &mut RenderDiagnostics::default())
}

/// Render one field and add unsupported constructs to library-level diagnostics.
///
/// # Arguments
/// * `source` - Raw TeX source for one field.
/// * `mode` - Field rendering mode; only `title` enables title root-group protection.
/// * `diagnostics` - Shared state that deduplicates unsupported constructs across fields.
///
/// The visitor starts at root scope and assumes the current default English `as-needed`
/// protection policy. Sentence casing and configurable `strict`/`off` policies are separate work.
pub(crate) fn render_with_diagnostics(
    source: &str,
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
) -> String {
    render_nodes(
        &parse(source).content,
        mode,
        false,
        diagnostics,
        mode == "title",
        false,
        true,
    )
    .trim()
    .to_string()
}

/// Render a sibling sequence while tracking field mode, local markup, and title context.
///
/// `nodes` is one AST child list; `mode` controls whitespace and rich-text output; `verbatim`
/// preserves literal text such as URLs. `diagnostics` is shared recursively. `title_mode` enables
/// case protection, `protected_ancestor` prevents duplicate protection inside a protected region,
/// and `root_scope` limits root-group handling to the original field or a root environment body.
///
/// Declaration-style markup persists only across siblings in this sequence. Recursive groups
/// start their own markup state, matching the TypeScript visitor's parent-scoped feed-forward pass.
fn render_nodes(
    nodes: &[Node],
    mode: &str,
    verbatim: bool,
    diagnostics: &mut RenderDiagnostics,
    title_mode: bool,
    protected_ancestor: bool,
    root_scope: bool,
) -> String {
    let mut output = String::new();
    let mut paragraph_boundary = false;
    let mut markup = Markup::default();
    for node in nodes {
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
            // Collapse repeated paragraph boundaries and their following layout whitespace.
            if is_parbreak && paragraph_boundary {
                continue;
            }
            if paragraph_boundary && matches!(node, Node::Whitespace(_, _)) {
                continue;
            }
        }

        // The TS visitor marks nonempty root groups unless their first child is a macro.
        let protect_group = title_mode
            && root_scope
            && !protected_ancestor
            && matches!(node, Node::Group(children, _) if !children.is_empty() && !matches!(children[0], Node::Macro { .. }));
        let rendered = render_node(
            node,
            mode,
            verbatim,
            diagnostics,
            title_mode,
            protected_ancestor || protect_group,
            root_scope,
        );
        if mode == "richtext" && is_parbreak {
            paragraph_boundary = true;
        } else if !matches!(node, Node::Comment { .. }) && !rendered.is_empty() {
            paragraph_boundary = false;
        }
        let mut rendered = markup.wrap(rendered);
        if protect_group && needs_case_protection(&rendered) {
            rendered = format!("<span class=\"nocase\">{rendered}</span>");
        }
        output.push_str(&rendered);
    }
    let wrappers = [
        ("<i>", "</i>"),
        ("<b>", "</b>"),
        ("<code>", "</code>"),
        ("<span style=\"font-variant:small-caps;\">", "</span>"),
    ];
    // Adjacent siblings receive separate wrappers above; collapse equal neighbors into one span.
    loop {
        let collapsed = wrappers.iter().fold(output.clone(), |text, (open, close)| {
            text.replace(&format!("{close}{open}"), "")
        });
        if collapsed == output {
            break;
        }
        output = collapsed;
    }
    output
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
    /// `name` is the parsed macro name. Only text-mode `em`/`it`/`sl`, `bf`, `sc`, and `tt`
    /// are feed-forward commands in the TypeScript visitor; other macros remain for normal dispatch.
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

    /// Wrap one rendered sibling in active markup, preserving TypeScript wrapper nesting order.
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

/// Approximate the TypeScript default `as-needed` rule for already-rendered title text.
///
/// Generated markup is ignored before words are inspected. A word needs protection when it
/// contains ASCII lowercase letters and no ASCII uppercase letters. This deliberately small
/// heuristic does not port the TypeScript tokenizer, Unicode word shapes, or `strict`/`off`
/// settings; title sentence-casing and those options remain separate roadmap work.
fn needs_case_protection(text: &str) -> bool {
    let mut visible = String::new();
    let mut in_tag = false;
    for character in text.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => visible.push(character),
            _ => {}
        }
    }
    visible
        .split(|character: char| !character.is_alphanumeric())
        .any(|word| {
            word.chars().any(|character| character.is_ascii_lowercase())
                && !word.chars().any(|character| character.is_ascii_uppercase())
        })
}

/// Render one AST node using its field mode and inherited title-protection context.
///
/// `node` is the syntax-tree item; `mode` selects text, math, or rich-text behavior; `verbatim`
/// bypasses text ligatures; `diagnostics` receives unsupported constructs. The remaining flags
/// carry title protection: `title_mode` enables it, `protected_ancestor` suppresses nested spans,
/// and `root_scope` lets environments expose their contents to the root-group pass.
fn render_node(
    node: &Node,
    mode: &str,
    verbatim: bool,
    diagnostics: &mut RenderDiagnostics,
    title_mode: bool,
    protected_ancestor: bool,
    root_scope: bool,
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
        Node::Verb(contents, _) => contents.clone(),
        // Group delimiters protect structure but are omitted from rendered field text.
        Node::Group(nodes, _) => render_nodes(
            nodes,
            mode,
            verbatim,
            diagnostics,
            title_mode,
            protected_ancestor,
            false,
        ),
        Node::InlineMath(nodes, _) => {
            // Math children use math mappings; title protection is applied to the rendered result.
            let rendered = render_nodes(
                nodes,
                "math",
                false,
                diagnostics,
                title_mode,
                protected_ancestor,
                false,
            );
            if title_mode && !protected_ancestor && needs_case_protection(&rendered) {
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
            title_mode,
            protected_ancestor,
            root_scope,
        ),
        Node::Macro {
            name, arguments, ..
        } => render_macro(name, arguments, mode, diagnostics),
    }
}

/// Convert plain-text ligatures with the generated `unicode2latex` text map.
///
/// `text` is one parsed string node. `mode == "math"` and `verbatim == true` preserve its bytes;
/// otherwise the longest matching mapping of up to three Unicode characters is emitted first.
/// The three-character limit mirrors the TypeScript visitor's short adjacent-node ligature pass.
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
/// to its child visitor. Argument nodes are not root scope because the parser has already consumed
/// their original group delimiters.
fn render_argument(
    arguments: &[Vec<Node>],
    index: usize,
    mode: &str,
    verbatim: bool,
    diagnostics: &mut RenderDiagnostics,
) -> String {
    arguments
        .get(index)
        .map(|argument| {
            render_nodes(
                argument,
                mode,
                verbatim,
                diagnostics,
                mode == "title",
                false,
                false,
            )
        })
        .unwrap_or_default()
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
) -> String {
    match name {
        // Line breaks are HTML breaks in rich text and ordinary spaces in scalar fields.
        "\\" => return if mode == "richtext" { "<br>" } else { " " }.to_string(),
        "url" => {
            // URL content is rendered verbatim so query strings and tildes are not transformed.
            let url = render_argument(arguments, 0, mode, true, diagnostics);
            return format!("<a href=\"{url}\">{url}</a>");
        }
        "href" => {
            // The first href argument is the destination; only the label receives normal rendering.
            let url = render_argument(arguments, 0, mode, true, diagnostics);
            let label = render_argument(arguments, 1, mode, false, diagnostics);
            return format!("<a href=\"{url}\">{label}</a>");
        }
        "textbf" | "mkbibbold" => {
            // Keep the established markup shape used by the TypeScript renderer.
            return format!(
                "<b>{}</b>",
                render_argument(arguments, 0, mode, false, diagnostics)
            );
        }
        "textit" | "textsl" | "emph" | "mkbibemph" => {
            // Italic and emphasis macros share the same output wrapper.
            return format!(
                "<i>{}</i>",
                render_argument(arguments, 0, mode, false, diagnostics)
            );
        }
        "textsc" => {
            // Small caps retain the markup format expected by the TypeScript parser.
            return format!(
                "<span style=\"font-variant:small-caps;\">{}</span>",
                render_argument(arguments, 0, mode, false, diagnostics)
            );
        }
        "texttt" => {
            // Monospaced text uses the parser's code markup tag.
            return format!(
                "<code>{}</code>",
                render_argument(arguments, 0, mode, false, diagnostics)
            );
        }
        "textrm" | "textup" | "mathrm" | "mbox" | "hbox" | "rlap" => {
            // These macros affect TeX layout, not the resulting characters.
            return render_argument(arguments, 0, mode, false, diagnostics);
        }
        // Layout, definition, and spacing-control commands in this group contribute no field text.
        "vphantom" | "noopsort" | "left" | "right" | "ensuremath" | "wd" | "ht" | "raise"
        | "accent" | "def" | "hss" | "ifmmode" | "makeatletter" | "makeatother"
        | "scriptscriptstyle" | "setbox" | "dimen" | "advance" | "path" | "relax"
        | "aftergroup" | "ignorespaces" | "rm" => return String::new(),
        "sc" => return String::new(),
        "hspace" | "hskip" => {
            // Match the TS visitor's zero-width special case; other explicit spacing becomes one space.
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
            // The TS visitor appends a combining macron to ASCII letters and digits only.
            let value = render_argument(arguments, 0, mode, false, diagnostics);
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
        "enquote" | "mkbibquote" => {
            // `restoreMarkup` turns the TS enquote wrapper into curly quotation marks.
            return format!(
                "“{}”",
                render_argument(arguments, 0, mode, false, diagnostics)
            );
        }
        "section" | "subsection" | "subsubsection" | "subsubsubsection" => {
            // Heading depth is the command name's number of `sub` components.
            let level = name.split("sub").count();
            let content = render_argument(arguments, 0, mode, false, diagnostics);
            return format!("<h{level}>{content}</h{level}>");
        }
        "chsf" | "bibstring" | "cite" | "textcite" | "citeauthor" => {
            // The TS no-case wrapper for these commands is stripped after title processing.
            return render_argument(arguments, 0, mode, false, diagnostics);
        }
        "LaTeX" => return "L<sup>A</sup>T<sub>E</sub>X".to_string(),
        "textsuperscript" => {
            return render_script_argument(arguments, 0, "^", mode, diagnostics);
        }
        "textsubscript" => {
            return render_script_argument(arguments, 0, "_", mode, diagnostics);
        }
        "^" | "_" if mode == "math" => {
            return render_script_argument(arguments, 0, name, mode, diagnostics);
        }
        "frac" if mode == "math" => {
            // Prefer an exact fraction mapping; otherwise compose mapped numerator and denominator scripts.
            let latex = serialize_macro(name, arguments);
            if let Some(mapping) = unicode_mapping(&latex)
                && let Some(text) = mapping.math.or(mapping.text)
            {
                return text.to_string();
            }
            let numerator = render_argument(arguments, 0, mode, false, diagnostics);
            let denominator = render_argument(arguments, 1, mode, false, diagnostics);
            return match (script_text(&numerator, "^"), script_text(&denominator, "_")) {
                (Some(numerator), Some(denominator)) => format!("{numerator}\u{2044}{denominator}"),
                _ => latex,
            };
        }
        "par" => return if mode == "richtext" { "<p>" } else { " " }.to_string(),
        "item" => return if mode == "richtext" { "<li>" } else { " " }.to_string(),
        "_" | "^" => return name.to_string(),
        _ => {}
    }

    // Combining entries are keyed by command alone; composed scalar mappings include their arguments.
    let command = format!("\\{name}");
    if let Some(mapping) = unicode_mapping(&command)
        && let Some(mark) = mapping.combining
    {
        let argument = render_argument(arguments, 0, mode, false, diagnostics);
        return format!(
            "{}{mark}",
            if argument.is_empty() { " " } else { &argument }
        );
    }

    // Ordinary TeX macros use the build-generated unicode2latex maps.
    let latex = serialize_macro(name, arguments);
    if let Some(mapping) = unicode_mapping(&latex) {
        // Require a mapping for the active mode, as `latex2unicode` does in the TS visitor.
        let mapped_text = if mode == "math" {
            mapping.math
        } else {
            mapping.text
        };
        if let Some(text) = mapped_text {
            return text.to_string();
        }
    }

    // Keep unknown macros in the rendered text for later unsupported-macro handling.
    diagnostics.report("macro", name, latex.clone());
    latex
}

/// Render supported environment nodes or report unsupported ones without visiting their bodies.
///
/// `name` and `content` identify the parsed environment; `mode` controls rich-text wrappers;
/// `diagnostics` collects unsupported environments. Title flags are forwarded to supported
/// descendants. Leading/trailing whitespace, paragraph breaks, and `\\par` are trimmed to match
/// the TypeScript visitor before known content is rendered. Unknown environments are reported as
/// one construct and preserved as TeX, so nested body macros do not create extra diagnostics.
fn render_environment(
    name: &str,
    content: &[Node],
    mode: &str,
    diagnostics: &mut RenderDiagnostics,
    title_mode: bool,
    protected_ancestor: bool,
    root_scope: bool,
) -> String {
    let trims_environment_edge = |node: &Node| match node {
        Node::Whitespace(_, _) | Node::Parbreak(_) => true,
        Node::Macro { name, .. } => name == "par",
        _ => false,
    };
    let mut start = 0;
    let mut end = content.len();
    // The reference visitor discards layout-only nodes at both environment edges.
    while start < end && trims_environment_edge(&content[start]) {
        start += 1;
    }
    while end > start && trims_environment_edge(&content[end - 1]) {
        end -= 1;
    }
    match name {
        "quotation" | "itemize" | "em" => {
            let body = render_nodes(
                &content[start..end],
                mode,
                false,
                diagnostics,
                title_mode,
                protected_ancestor,
                root_scope,
            )
            .trim()
            .to_string();
            if mode != "richtext" {
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
            source
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
) -> String {
    let value = render_argument(arguments, index, mode, false, diagnostics);
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
    let mut source = format!("\\{name}");
    for argument in arguments {
        source.push('{');
        source.push_str(&serialize_nodes(argument));
        source.push('}');
    }
    source
}

/// Reconstruct source from a node sequence, preserving group and macro boundaries.
fn serialize_nodes(nodes: &[Node]) -> String {
    nodes
        .iter()
        .map(|node| match node {
            Node::String(text, _) => text.clone(),
            Node::Whitespace(text, _) => text.clone(),
            Node::Parbreak(_) => "\n\n".to_string(),
            Node::Comment { content, .. } => format!("%{content}"),
            Node::Verb(contents, _) => contents.clone(),
            Node::Group(children, _) => format!("{{{}}}", serialize_nodes(children)),
            Node::InlineMath(children, _) => format!("${}$", serialize_nodes(children)),
            Node::Environment { name, content, .. } => {
                format!(
                    "\\begin{{{name}}}{}\\end{{{name}}}",
                    serialize_nodes(content)
                )
            }
            Node::Macro {
                name, arguments, ..
            } => serialize_macro(name, arguments),
        })
        .collect()
}
