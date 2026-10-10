# Rust WebAssembly package

Build the browser-targeted WebAssembly module, JavaScript glue, and TypeScript declarations from the repository root:

```sh
npm run wasm:build
```

The build requires Node.js, the repository's npm dependencies, Rust with the `wasm32-unknown-unknown` target, and `wasm-pack`. Cargo generates a compact static Rust lookup from `unicode2latex`'s `latex2unicode` and `combining.tounicode` maps at compile time. The wasm runtime does not load or parse JSON. The generated package is written to `rust/pkg` and is intentionally ignored by Git.

Initialize the module before calling either parser function:

```js
import init, { parseNormalized, parseVerbatim } from './rust/pkg/index.js'

await init()
const raw = parseVerbatim('@article{example, title={A title}}')
const normalized = parseNormalized('@article{example, title={A title}}')
```

`parseVerbatim` returns the scanner-level representation. `parseNormalized` returns the current typed-field representation. Their options and result structures are described in `rust/pkg/index.d.ts` after building.