# bibtex-parser

A node/npm package for parsing bibtex (.bib) files. This is the parser that drives [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/) bib(la)tex imports.

While parsing, the parser will apply markup for commands such as `\textbf`, `\textsc`, etc, and braces wich protect text against case-changes. Commands will be replaced with their unicode text equivalents where possible.

## What is BibTeX?

BibTeX is a reference management program that makes it easy for users of TeX and LaTeX to generate bibliographies for books and journal articles. When possible, it is usually stylized in the TeX font the way TeX and LaTeX are. LaTeX was first created in 1985 by Leslie Lamport and Oren Patashnik.

Documentation is available at [https://retorque.re/bibtex-parser/](https://retorque.re/bibtex-parser/).

## Choosing a Parser

The Rust/WebAssembly implementation is the default export (ESM only, see below). The pure TypeScript implementation, which also needs no initialization, is available as an ESM-only `/js` subpath:

```js
import { parse } from '@retorquere/bibtex-parser/js'

const library = parse('@article{example, title={A title}}')
```

For the scanner-level representation, use `parseVerbatim`. Its fields are strings and have not been normalized or interpreted as LaTeX:

```js
import { parseVerbatim } from '@retorquere/bibtex-parser/js'

const library = parseVerbatim('@article{example, title={A title}}')
```

The generated API documentation covers the normalized TypeScript API (`/js`), its `parseVerbatim` export, and the WASM exports available from the default entry point.

All parser results expose `preambles: string[]`, retaining multiple `@preamble` directives in source order. The normalized result property was previously named `preamble`; callers should use `preambles` instead.

The WebAssembly implementation is the ESM-only default entry point. Initialize it before calling the parser. In a browser, `init()` loads the binary relative to the module:

```js
import init, { parse } from '@retorquere/bibtex-parser'

await init()
const library = parse('@article{example, title={A title}}')
```

In Node.js, load the exported binary explicitly:

```js
import { readFile } from 'node:fs/promises'
import init, { parse } from '@retorquere/bibtex-parser'

const binary = new URL(import.meta.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm'))
await init({ module_or_path: await readFile(binary) })
const library = parse('@article{example, title={A title}}')
```

Both entry points include TypeScript declarations. Building the package from source also builds WebAssembly and requires Rust with the `wasm32-unknown-unknown` target and `wasm-pack`; consumers do not need these tools.

### Zotero Plugins

Include the default JavaScript entry point in your plugin's build and package the WASM binary as a plugin resource. In the plugin's privileged Zotero context, initialize the parser during startup, before any parsing calls:

```js
import init, { parse } from '@retorquere/bibtex-parser'

await init({ module_or_path: 'chrome://zotero-better-bibtex/content/resource/bibtex/bibtex_parser_bg.wasm' })

const library = parse('@article{example, title={A title}}')
```

Await initialization once during startup; subsequent `parse` or `parseAsync` calls reuse the initialized module.

## URL Commands

Both parsers accept `richURL`, a boolean that defaults to `true`. With `richURL: true`, `\href{http://example.org/{id}}{url}` renders as `<a href="http://example.org/{id}">url</a>` without case-protection spans. With `richURL: false`, it renders as `<span class="nocase">http://example.org/{id}</span>`, discarding the label and preserving the destination's casing regardless of the `caseProtection` setting. The option also applies to `\url`.

## Unknown TeX Commands

Both `parse` and `parseAsync` accept an `unsupported` option:

* `ignore`: replace unknown commands with nothing.
* `keep` (default): preserve literal TeX, including the backslash, and record a diagnostic in `errors`.
* `throw`: throw an error identifying the unsupported TeX command (`parse` throws and `parseAsync` rejects). This bypasses the normal `errors` collection.

These policies also apply to unsupported environments. Custom handler functions are no longer supported.

## TypeScript Breaking Changes Since `v11`

* `Options.unsupported` no longer accepts a callback `(node, tex, entry) => string` for custom replacement text. Use `ignore`, `keep`, or `throw`. The default remains `keep`, matching `master`; passing any other value now throws a `TypeError` during parser setup.
* The new `unsupported: 'throw'` mode propagates unsupported-command/environment errors out of `parse` (or rejects `parseAsync`) instead of adding them to the entry's `errors` and continuing.
* Merged `keywords` now retain encounter order and exact duplicate strings. Previously, exact duplicates were removed and the remaining values were sorted case-insensitively. Case variants were not deduplicated before either.

# Migrating from 8.x to 9.0

* Move `sentenceCase.langids` to the top-level `english` option. It still accepts a language array or a boolean; include `''` in a custom array to match entries with no `langid`.
* Move `sentenceCase.language` to the top-level `languageAsLangid` option. It still controls whether the `language` field is used as a fallback when `langid` and `hyphenation` are absent.

The `Entry` and `ParseError` shapes, including the verbatim parser's entry shape, did not change between 8.0.23 and 9.0.0. Bundled unabbreviations also remain enabled by default.
