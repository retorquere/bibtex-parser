# BibTeX Parser

A BibTeX parser with LaTeX command support. Originally written in JavaScript for Zotero Better BibTeX, now ported to Rust. The Rust version is compiled to WebAssembly for use in Zotero Better BibTeX, while also being available as a standalone Rust crate.

## Dual-Target Library

This repository contains the parser available in two forms:

- **JavaScript/TypeScript**: Available on [npm as `@retorquere/bibtex-parser`](https://www.npmjs.com/package/@retorquere/bibtex-parser). The Rust parser compiled to WebAssembly for use in [Zotero Better BibTeX](https://retorquere.github.io/zotero-better-bibtex/).
- **Rust**: Available on [crates.io as `bbt-bibtex-parser`](https://crates.io/crates/bbt-bibtex-parser) for use in Rust projects.

## Quick Start

Choose the guide that matches your use case:

- **[JavaScript.md](./JavaScript.md)** – Installation and usage for JavaScript/TypeScript projects
- **[Rust.md](./Rust.md)** – Installation and usage for Rust projects

## About This Project

Originally written in JavaScript as part of Zotero Better BibTeX, the parser has been ported to Rust. The Rust version is now the canonical implementation and is compiled to WebAssembly to serve as the parser for Zotero Better BibTeX, while also being available as a standalone Rust crate for other projects.

## License

MIT
