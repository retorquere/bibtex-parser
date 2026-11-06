# rq-bibtex-parser

Rust library for parsing BibTeX entries, resolving strings and cross-references, interpreting common field types, and rendering TeX values as Unicode. The crate has no runtime Node.js or JavaScript dependency.

The Unicode conversion sources are `data/unicode2latex/latex2unicode.json` and `data/unicode2latex/combining.json`, copied from the pinned `unicode2latex` dependency. Refresh both files when updating that dependency. Standalone Cargo builds need no Node.js or npm installation.

### Unicode Table Format

`build.rs` normalizes shared text/math mappings and merges combining accents, then uses `postcard::to_allocvec` and `miniz_oxide::deflate::compress_to_vec` (level 9) to write `OUT_DIR/unicode_tables.deflate`. Cargo rebuilds it when either source JSON file changes; no generated binary is checked in.

The payload is a raw DEFLATE stream (no zlib or gzip wrapper) containing a Postcard-encoded `Vec<UnicodeMapping>`. Both build and runtime compile the same schema from `src/unicode_tables.rs`. Postcard encodes struct fields in declaration order (`key`, `text`, `math`, `combining`), without field names. Its [wire format](https://postcard.jamesmunns.com/wire-format.html) is documented and stable since Postcard 1.0; there is no handwritten byte codec.

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

The decoder rejects trailing bytes and invalid key order; a `OnceLock` caches the owned strings for subsequent lookups. JSON is only the human-readable source format, not the embedded representation. Changing the shared schema requires regenerating the table, which Cargo handles automatically.

```toml
[dependencies]
rq-bibtex-parser = "0.1"
```

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

The crate also provides WebAssembly bindings. Build those from the repository root with `npm run build:wasm`; this separate workflow requires Node.js, the repository's npm dependencies, the `wasm32-unknown-unknown` Rust target, and `wasm-pack`.

## Title tokenizer

Title recognition uses small handwritten prefix recognizers, tried in explicit priority order. Recognizers define token forms, `recognize` controls precedence, and token emission manages sentence state and Unicode scalar offsets. A successful earlier rule wins even when a later rule could consume more text. Shared Unicode predicates keep recognition and casing consistent without duplicate category tables or regex initialization. Configured verbatim-field selectors use `wildflower` glob patterns (`*`, `?`, and backslash escapes); built-in field rules are handled with direct string checks.

### Matching Engine Comparison

On 2026-10-25, the structured handwritten version matched both independent Logos recognizers and cached anchored `regex-lite` patterns on 69,776 tokenizer runs, including generated boundary cases and the shared Unicode fixture. Comparisons included all token fields, shapes, scalar offsets, and sentence flags, with both markup and colon-start settings. Temporary reference implementations were removed after comparison; focused regressions remain.

| Engine | Optimized WASM Bytes | Gzip Bytes | Native Tokenization | WASM Sentence Casing |
| --- | ---: | ---: | ---: | ---: |
| Handwritten | 895,534 | 284,944 | 115.3 ms | 74.5 ms |
| Logos | 905,308 | 286,387 | 111.2 ms | 74.1 ms |
| regex-lite | 896,937 | 285,614 | 280.8 ms | 117.8 ms |

These are whole-module build sizes using `npm run build:wasm` and gzip level 9 without filename/timestamp metadata. Native medians used nine rotating-order trials of 44 inputs repeated 2,000 times, with optimizations and allocation included. WASM medians used seven alternating-order trials of the same inputs repeated 500 times through `toSentenceCase`, after warmup. WASM results were measured in Node.js, not a browser. The small handwritten/Logos timing difference is not a claim of a universal speed advantage. Their fresh-instance first sentence-case medians were about 0.22/0.23 ms, versus 0.30 ms for regex-lite.

The handwritten design retains the structural clarity without lexer machinery, at roughly the same measured WASM speed as Logos and 9,774 fewer raw bytes. Direct Unicode regexes in Logos were also tried earlier and grew the module to 1,021,587 bytes; the measured Logos row uses shared Unicode callbacks instead.

Run the retained opt-in native benchmark with:

```sh
cargo test --release --manifest-path rust/Cargo.toml --lib tokenizer::tests::benchmark_tokenization -- --ignored --exact --nocapture
```

After building WASM, run `node test/tokenizer-benchmark.mjs` for the current binary, or pass `label=path/to/module.wasm` arguments to compare compatible saved binaries. The harness checks output parity and reports raw/gzip sizes, initialization, first-use, and warmed timings. `TOKENIZER_BENCH_ITERATIONS` overrides the repetitions for either benchmark.