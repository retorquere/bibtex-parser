# BibTeX Parser for Rust

A library for parsing BibTeX entries with LaTeX command support. This is a Rust port of the Zotero Better BibTeX JavaScript parser and is the parser used in Zotero Better BibTeX via WebAssembly. Also available as a standalone Rust crate.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
bbt-bibtex-parser = "14.0.5"
```

Requires Rust 1.99 or newer.

## Usage

### Basic Parsing

```rust
use bibtex_parser::{parse, Options};

fn main() {
    let source = "@article{example, title={A Long Title}, year={2024}}";
    let library = parse(source, Options::default());

    for entry in library.entries {
        println!("{} ({})", entry.key, entry.entry);
        println!("{:#?}", entry.fields);
    }

    for error in library.errors {
        eprintln!("{}", error.error);
    }
}
```

### Field Types

The `parse` function returns typed field values in a `ParsedLibrary`. Supported field types include:

- **Authors**: Parsed into structured author names
- **Dates**: ISO 8601 formatted
- **Pages**: Range handling (e.g., "10--20")
- **Custom fields**: Preserved with original text

Use `parse_verbatim` when you need scanner-level field text without TeX rendering or field interpretation:

```rust
use bibtex_parser::{parse_verbatim, Options};

let library = parse_verbatim(source, Options::default());
```

### Options

Both `parse` and `parse_verbatim` accept `Options` to control behavior:

```rust
use bibtex_parser::Options;

let options = Options {
    // Apply cross-references and resolve strings (enabled by default)
    // Parse standard field types (enabled by default)
    // Sentence-case English titles (enabled by default)
    ..Default::default()
};
```

Set `raw` to skip TeX conversion and sentence casing:

```rust
let mut options = Options::default();
options.raw = true;
let library = parse(source, options);
```

### Unicode-to-LaTeX Conversion

The parser exposes the same Unicode-to-LaTeX converter:

```rust
use bibtex_parser::{MapOptions, Transform, TranslateOptions};

fn main() {
    let transform = Transform::new("biblatex", MapOptions::default())?;
    let latex = transform.tolatex("Overall Normalization → Reactions", &mut TranslateOptions::default());
    println!("{}", latex);  // Output with LaTeX commands
}
```

Supported styles:
- `"biblatex"` – Modern BibLaTeX style
- `"bibtex"` – Classic BibTeX style

## Building from Source

If you're working with the repository, build the parser:

```sh
cargo build --release
```

### WebAssembly

The crate provides WebAssembly bindings for parsing, tokenization, and Unicode-to-LaTeX conversion. Build them from the repository root:

```sh
npm run build
```

This requires:
- Node.js and npm dependencies (from repository)
- `wasm32-unknown-unknown` Rust target
- `wasm-pack`

The private `xtask` owns the build pipeline and is not published with the parser.

## Testing

Run tests from the repository root:

```sh
cargo test
```

Native tests use fixtures in the repository checkout. These fixtures are not needed to build or use the standalone library.

For Rust-only tests:

```sh
cargo xtask test-rust
```

## Implementation Details

### Unicode Mapping Data

The parser and its Unicode-to-LaTeX module use `data/unicode2latex.ssv` as their shared source. The build-time generator in `build/unicode_mapping_generator.rs` produces the mappings. Cargo compiles the parser's Unicode-to-LaTeX data into the crate at build time.

The parser's `build.rs` normalizes shared text/math mappings and merges combining accents, then uses `postcard::to_allocvec` and `miniz_oxide::deflate::compress_to_vec` (level 9) to write `OUT_DIR/unicode_tables.deflate`. Cargo reruns the build script when the configuration or generator changes. Building the parser requires a C compiler for the bundled SQLite used by the generator.

The embedded payload is a raw DEFLATE stream (no zlib or gzip wrapper) containing a Postcard-encoded `Vec<UnicodeMapping>`. Both build and runtime use the same schema from `shared/unicode_mapping.rs`. Postcard encodes struct fields in declaration order (`key`, `text`, `math`, `combining`), without field names. Its [wire format](https://postcard.jamesmunns.com/wire-format.html) is documented and stable since Postcard 1.0.

```rust
// Build time: serialize the shared schema, then compress.
let encoded = postcard::to_allocvec(&rows)?;
let compressed = miniz_oxide::deflate::compress_to_vec(&encoded, 9);

// Runtime: decompress, then deserialize the same schema.
let encoded = miniz_oxide::inflate::decompress_to_vec(&compressed)?;
let (rows, remaining): (Vec<UnicodeMapping>, _) = postcard::take_from_bytes(&encoded)?;
assert!(remaining.is_empty());
```

Mode and combining fields are `Option<String>`; `None` means unavailable, while `Some("")` is a valid replacement. Scalar source mappings apply to both text and math. Combining accents supplement rather than overwrite those mode values. Keys are unique and sorted by UTF-8 bytes for binary search.

The decoder rejects trailing bytes and invalid key order; a `OnceLock` caches the owned strings for subsequent lookups.

## Features

- **Accurate**: Handles real-world BibTeX files with proper escaping and field resolution
- **LaTeX support**: Comprehensive LaTeX command handling
- **Field types**: Interprets standard field types (author, date, pages, etc.)
- **Cross-references**: Resolves strings and cross-references
- **Unicode**: Bidirectional conversion between Unicode and LaTeX commands
- **No runtime dependencies**: Pure Rust, builds to a single binary or library

## Related

- **Source code and issue tracking**: [github.com/retorquere/bibtex-parser](https://github.com/retorquere/bibtex-parser)
- **JavaScript version**: [@retorquere/bibtex-parser on npm](https://www.npmjs.com/package/@retorquere/bibtex-parser)
- **Built for**: [Zotero Better BibTeX](https://retorquere.github.io/zotero-better-bibtex/)

## License

MIT
