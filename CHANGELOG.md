# Changelog

## Since v10.0.2

- The package's default entry point now uses the Rust/WebAssembly parser. A native Rust crate is also available, and the TypeScript implementation remains available from `@retorquere/bibtex-parser/js`.
- **Breaking: field selectors.** `verbatimFields` now uses glob selectors rather than regexes; `RegExp` values are no longer supported. Selectors match complete field names case-insensitively: `*` matches any number of characters, `?` matches one, and `\` escapes a wildcard. Regex punctuation is treated literally. The default Rust/WASM parser matches globs directly and uses direct checks for built-in field rules.
- The Rust/WebAssembly parser supports proper parsing of `\verb` and `\path`. Braces, quotes, `%`, `$`, and `#` inside a literal no longer interfere with the surrounding value; braced `\path` contents support nesting and escaped characters.