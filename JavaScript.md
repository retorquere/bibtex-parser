# BibTeX Parser for JavaScript

BibTeX parser for JavaScript and TypeScript with LaTeX command support. The Rust parser compiled to WebAssembly for use in Zotero Better BibTeX. Originally developed for Zotero Better BibTeX in JavaScript, now implemented in Rust.

## Installation

```bash
npm install @retorquere/bibtex-parser
```

## Usage

### Parsing BibTeX

```js
import init, { parse, Options } from '@retorquere/bibtex-parser'

await init()

const source = `
  @article{example,
    title = {A Long Title},
    year = {2024}
  }
`

const library = parse(source, new Options())

for (const entry of library.entries) {
  console.log(`${entry.key} (${entry.entry})`)
  console.log(entry.fields)
}

for (const error of library.errors) {
  console.error(error.error)
}
```

The `parse` function returns typed field values in a `ParsedLibrary`. Use `parse_verbatim` when you need raw field text without TeX rendering or field interpretation:

```js
const library = parse_verbatim(source, new Options())
```

### Options

The `Options` object controls parser behavior:

```js
const options = new Options()
// Apply cross-references and resolve strings
// Parse standard field types (author, date, etc.)
// Sentence-case English titles
// (these are all enabled by default)
```

Set `options.raw` to skip TeX conversion and sentence casing:

```js
const options = new Options()
options.raw = true
const library = parse(source, options)
```

### Unicode-to-LaTeX Conversion

Convert Unicode text to LaTeX commands:

```js
import init, { Transform, biblatex } from '@retorquere/bibtex-parser'

await init()

const transform = new Transform('biblatex')
const latex = transform.tolatex('Overall Normalization of the Astrophysical → Reactions')
console.log(latex)  // Output with LaTeX commands

// Access mapping data directly
console.log(biblatex.base['→'])  // Output: \rightarrow
```

Supported style options:
- `'biblatex'` – Modern BibLaTeX style
- `'bibtex'` – Classic BibTeX style

## API Reference

The package exports the following functions and types:

- `parse(source: string, options: Options): ParsedLibrary` – Parse BibTeX with field interpretation
- `parse_verbatim(source: string, options: Options): ParsedLibrary` – Parse BibTeX without field processing
- `Transform` – Unicode-to-LaTeX converter class
  - `new Transform(style: string, options?: MapOptions): Transform`
  - `tolatex(text: string, options?: TranslateOptions): string` – Convert to LaTeX
- `Options` – Parser configuration class
- `MapOptions` – Converter mapping options
- `TranslateOptions` – Converter translation options
- `ParsedLibrary` – Parsed result containing entries and errors
- `biblatex`, `bibtex` – Pre-computed mapping data objects

## Features

- **Accurate**: Handles real-world BibTeX files with proper escaping and field resolution
- **LaTeX support**: Comprehensive LaTeX command handling and Unicode conversion
- **Bidirectional**: Convert between Unicode and LaTeX commands
- **Field types**: Interprets standard field types (author, date, pages, etc.)
- **Cross-references**: Resolves strings and cross-references
- **Zero runtime dependencies**: Pure WebAssembly, no external libraries required

## Related

- **Source code and issue tracking**: [github.com/retorquere/bibtex-parser](https://github.com/retorquere/bibtex-parser)
- **Rust version**: [crates.io/crates/bbt-bibtex-parser](https://crates.io/crates/bbt-bibtex-parser)
- **Used in**: [Zotero Better BibTeX](https://retorquere.github.io/zotero-better-bibtex/)

## License

MIT
