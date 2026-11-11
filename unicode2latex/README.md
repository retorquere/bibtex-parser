Convert unicode to LaTeX

Example:

```
const { Transform } = require('unicode2latex')
const tx = new Transform(mode, { packages: ['textcomp', 'amsmath'] })
const packages = new Set
console.log(tx.tolatex('your text', { packages }))
```

## Rust/WASM JavaScript API

The ESM-only `@retorquere/bibtex-parser/unicode2latex` entry point exposes the
JavaScript API through a small WASM adapter. Translation runs in Rust. Call
`init()` before constructing a transformer; without arguments it loads the WASM
binary next to the module. Pass a URL or bytes when the host controls resource
loading, as in an extension plugin.

```js
import init, { Transform, replace_macro_spacers } from '@retorquere/bibtex-parser/unicode2latex'

await init()
const tx = new Transform('biblatex', { packages: ['textcomp'] })
const packages = new Set()
console.log(tx.tolatex('Michał → Nguyễn', { bracemath: true, packages }))
console.log([...packages])
```

All four modes (`minimal`, `biblatex`, `bibtex`, and `bibtex-creator`), mapping and
translation options, and table exports are available. `init` accepts the same
URL, bytes, or compiled module inputs supported by wasm-bindgen; `initSync` is
also exported for hosts that require synchronous setup.

### Building and Testing

Building from the repository root requires Node.js, a Rust toolchain, and wasm-pack:

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run build
npm test
```

`npm run build` generates the shared JSON tables and builds the parser, tokenizer,
and Unicode-to-LaTeX WASM modules under `dist`. `npm test` runs native Rust tests,
BibTeX parser tests, and converter expected-output/API tests covering mapping modes,
package overrides, custom maps, combining marks, spacing, and package-reporting
order.

Cargo's build script validates `../data/unicode2latex/config.ssv` using the shared
table generator and emits sorted static Rust tables into `OUT_DIR/tables.rs`. Rust
conversion uses these tables directly, without parsing table JSON at runtime. CSV
and SQLite remain host-side generation dependencies and are not linked into WASM.
The Rust library also supports native use through `Transform`, `MapOptions`, and
`TranslateOptions`; `cargo test -p unicode2latex --lib` runs its focused tests.

## Rebuilding Tables

Run `cargo run -p unicode2latex --bin rebuild` from the repository root to convert
`data/unicode2latex/config.ssv` into JSON tables in the shared
`tables/unicode2latex` directory. The `rebuild` executable reads the configuration
at runtime and validates it before replacing generated tables. The root package
build copies those tables to `dist` and runs this generator automatically.
