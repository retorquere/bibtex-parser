# bibtex-parser

A node/npm package for parsing bibtex (.bib) files. This is the parser that drives [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/) bib(la)tex imports.

While parsing, the parser will apply markup for commands such as `\textbf`, `\textsc`, etc, and braces wich protect text against case-changes. Commands will be replaced with their unicode text equivalents where possible.

## What is BibTeX?

BibTeX is a reference management program that makes it easy for users of TeX and LaTeX to generate bibliographies for books and journal articles. When possible, it is usually stylized in the TeX font the way TeX and LaTeX are. LaTeX was first created in 1985 by Leslie Lamport and Oren Patashnik.

Documentation is available at [https://retorque.re/bibtex-parser/](https://retorque.re/bibtex-parser/).

## Choosing a Parser

The TypeScript implementation remains the default:

```js
import { parse } from '@retorquere/bibtex-parser'

const library = parse('@article{example, title={A title}}')
```

The WebAssembly implementation is available as an ESM entry point at `/wasm`. Initialize it before calling the parser. In a browser, `init()` loads the binary relative to the module:

```js
import init, { parse } from '@retorquere/bibtex-parser/wasm'

await init()
const library = parse('@article{example, title={A title}}')
```

In Node.js, load the exported binary explicitly:

```js
import { readFile } from 'node:fs/promises'
import init, { parse } from '@retorquere/bibtex-parser/wasm'

const binary = new URL(import.meta.resolve('@retorquere/bibtex-parser/wasm/bibtex_parser_bg.wasm'))
await init({ module_or_path: await readFile(binary) })
const library = parse('@article{example, title={A title}}')
```

Both entry points include TypeScript declarations. Building the package from source also builds WebAssembly and requires Rust with the `wasm32-unknown-unknown` target and `wasm-pack`; consumers do not need these tools.

### Zotero Plugins

Include the `/wasm` JavaScript entry point in your plugin's build and package the WASM binary as a plugin resource. In the plugin's privileged Zotero context, initialize the parser during startup, before any parsing calls:

```js
import init, { parse } from '@retorquere/bibtex-parser/wasm'

await init({ module_or_path: 'chrome://zotero-better-bibtex/content/resource/bibtex/bibtex_parser_bg.wasm' })

const library = parse('@article{example, title={A title}}')
```

Await initialization once during startup; subsequent `parse` or `parseAsync` calls reuse the initialized module.

## Unknown TeX Commands

Both `parse` and `parseAsync` accept an `unsupported` option:

* `ignore`: replace unknown commands with nothing.
* `keep` (default): preserve literal TeX, including the backslash, and record a diagnostic in `errors`.
* `throw`: throw an error identifying the unknown command (`parseAsync` rejects).

These policies also apply to unsupported environments. Custom handler functions are no longer supported.

# 9.0 is a breaking change!

Look at the documentation for what has changed:

* the chunker parser is now called the verbatim parser, and the return type of the entries has changed
* the main parser has changed the structure of the entries returned, the errors returned, and the options passed into the parser
* unabbreviations left to consumers of the library. `unabbrev.json` remains available.
