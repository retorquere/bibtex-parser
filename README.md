# bbt-bibtex-parser

Rust library for parsing BibTeX entries, resolving strings and cross-references, interpreting common field types, and rendering TeX values as Unicode. The crate has no runtime Node.js or JavaScript dependency.

## Installation

Requires Rust 1.99 or newer. Standalone Cargo builds need no Node.js or npm installation.

```toml
[dependencies]
bbt-bibtex-parser = "0.1"
```

## Usage

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

`parse` returns typed field values in a `ParsedLibrary`. Use `parse_verbatim` when scanner-level field text is needed without TeX rendering or field interpretation. Both functions accept `Options`; its default applies cross-references, parses standard field types, and sentence-cases English titles. Set `Options.raw` to skip TeX conversion and sentence casing.

## JavaScript Unicode-to-LaTeX

The parser package also exposes Unicode-to-LaTeX conversion from its main entry point. The converter shares the parser's WebAssembly module and exports its mapping data:

```js
import init, { Transform, biblatex } from '@retorquere/bibtex-parser'

await init()
const transform = new Transform('biblatex')
const latex = transform.tolatex('Overall Normalization of the Astrophysical → Reactions')
console.log(biblatex.base['→'])
```

The same package entry point also exports `tokenize`, `replace_macro_spacers`, and the converter's mapping types and tables.

The parser crate exposes the same converter from its root:

```rust
use bibtex_parser::{MapOptions, Transform, TranslateOptions};

let transform = Transform::new("biblatex", MapOptions::default())?;
let latex = transform.tolatex("Overall Normalization → Reactions", &mut TranslateOptions::default());
```

## WebAssembly

The crate provides WebAssembly bindings for parsing, tokenization, and Unicode-to-LaTeX conversion. Build them from the repository root with `cargo xtask build` or `npm run build`; this optional workflow requires Node.js, the repository's npm dependencies, the `wasm32-unknown-unknown` Rust target, and `wasm-pack`. The private `xtask` owns the build pipeline and is not published with the parser.

## Testing

Native tests use fixtures in the repository checkout. Run them from the repository root:

```sh
cargo test
```

These fixtures are not needed to build or use the standalone library.

Run `cargo xtask test-rust` for Rust tests. Run `npm run test:unicode-mappings` to test Unicode-to-LaTeX behavior through the parser package entry point.

## Unicode Mapping Data

The parser and its Unicode-to-LaTeX module use `data/unicode2latex.ssv` as their shared source. The build-time generator in `build/unicode_mapping_generator.rs` produces the mappings. The JavaScript build exports JSON mappings to `data/unicode2latex/`; Cargo compiles the parser's Unicode-to-LaTeX data into the parser crate.

The parser's `build.rs` normalizes shared text/math mappings and merges combining accents, then uses `postcard::to_allocvec` and `miniz_oxide::deflate::compress_to_vec` (level 9) to write `OUT_DIR/unicode_tables.deflate`. It also compiles the converter's static mappings into the same crate. Cargo reruns the build script when the configuration or generator changes. The npm build generates workspace JSON mappings with `cargo xtask unicode-mappings` before compiling the WASM module. No generated mapping data is checked in. Building the parser also requires a C compiler for the bundled SQLite used by the generator.

The payload is a raw DEFLATE stream (no zlib or gzip wrapper) containing a Postcard-encoded `Vec<UnicodeMapping>`. Both build and runtime compile the same schema from `shared/unicode_mapping.rs`. Postcard encodes struct fields in declaration order (`key`, `text`, `math`, `combining`), without field names. Its [wire format](https://postcard.jamesmunns.com/wire-format.html) is documented and stable since Postcard 1.0; there is no handwritten byte codec.

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

The decoder rejects trailing bytes and invalid key order; a `OnceLock` caches the owned strings for subsequent lookups. JSON is only the human-readable source format, not the embedded representation. Changing the shared schema requires regenerating the mapping data, which Cargo handles automatically.

## Title tokenizer

Title recognition uses small handwritten prefix recognizers, tried in explicit priority order. Recognizers define token forms, `recognize` controls precedence, and token emission manages sentence state and Unicode scalar offsets. A successful earlier rule wins even when a later rule could consume more text. Shared Unicode predicates keep recognition and casing consistent without duplicate category tables or regex initialization. Configured verbatim-field selectors use `wildflower` glob patterns (`*`, `?`, and backslash escapes); built-in field rules are handled with direct string checks.
