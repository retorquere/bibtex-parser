# Rust WebAssembly package

Build the browser-targeted WebAssembly module, JavaScript glue, and TypeScript declarations from the repository root:

```sh
npm run build:wasm
```

The build requires Node.js, the repository's npm dependencies, Rust with the `wasm32-unknown-unknown` target, and `wasm-pack`. Cargo generates a compact static Rust lookup from `unicode2latex`'s `latex2unicode` and `combining.tounicode` maps at compile time. The wasm runtime does not load or parse JSON. The generated package is written to `rust/pkg` and is intentionally ignored by Git.

Initialize the module before calling either parser function:

```js
import init, { parse, parseVerbatim } from './rust/pkg/index.js'

await init()
const raw = parseVerbatim('@article{example, title={A title}}')
const parsed = parse('@article{example, title={A title}}')
```

`parseVerbatim` returns the scanner-level representation. `parse` reparses those fields into typed values and renders LaTeX, matching the TypeScript parser's naming. `parseAsync` and `parseVerbatimAsync` provide asynchronous counterparts that yield every 1,000 iterations. Their options and result structures are described in `rust/pkg/index.d.ts` after building.

Both WASM verbatim parsers retain parsed JabRef metadata in `jabref`, unlike the TypeScript verbatim API. JabRef metadata comments are extracted from `comments` into that structured result.

WASM options use explicit values rather than the TypeScript parser's shorthand forms:

- `english` accepts an exact array of language identifiers. Import the exported `english` array for the default languages, or pass `[]` to disable sentence casing (instead of `english: false` or `sentenceCase: false`). Omitting it uses Rust's default English list. Include `''` in a custom list to sentence-case entries without a language identifier.
- `sentenceCase` accepts an object with `guess`, `subSentence`, and `preserveQuoted` controls.
- `caseProtection` accepts `'off'`, `'as-needed'`, or `'strict'`, not booleans.
- `strings` accepts either BibTeX source text, which is prepended to the input, or a map of predefined strings that extends the built-in table.
- `verbatimFields` accepts exact field-name strings and JavaScript `RegExp` selectors. Both match case-insensitively; regexes are compiled once per parse in Rust using `regex-lite`, without a preliminary JS parse. Multiline, dot-all, and sticky-start matching are supported. Case folding is ASCII-only, and lookaround, backreferences, and Unicode property classes are not supported; unsupported patterns are rejected. Regexes search within field names unless anchored with `^` and `$`.

```js
import { english, parse } from './rust/pkg/index.js'

const parsed = parse('@article{example, title={A Long Title}}', {
	english,
	caseProtection: 'off',
	strings: '@string{journal = {Example Journal}}',
})
```

The handwritten title tokenizer lives in `src/tokenizer.rs`, separate from TeX rendering and sentence casing. Token precedence, sentence state, and UTF-16 offsets retain the existing behavior; the BibTeX parser is unchanged.