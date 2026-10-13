# rq-bibtex-parser

Rust library for parsing BibTeX entries, resolving strings and cross-references, interpreting common field types, and rendering TeX values as Unicode. The crate has no runtime Node.js or JavaScript dependency.

The Unicode conversion table is checked in for standalone Cargo builds. `npm run build:wasm` regenerates it from the pinned `unicode2latex` dependency before compiling; rerun that build when updating the dependency.

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