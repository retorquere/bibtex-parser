import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'
import * as yaml from 'js-yaml'

import init, { parseAsync, parseNormalized, parseVerbatim, tokenize } from '../rust/pkg/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const cases = [
  {
    name: 'converts text ligatures like the default snapshot',
    fixture: 'test/better-bibtex/export/Better BibLaTeX.001.biblatex',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed/export/Better BibLaTeX.001.biblatex.yaml',
    field: 'pages',
  },
  {
    name: 'renders markup macros like the default snapshot',
    fixture: 'test/better-bibtex/export/Better BibLaTeX.007.biblatex',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed/export/Better BibLaTeX.007.biblatex.yaml',
    field: 'title',
  },
  {
    name: 'sentence-cases title text like the default snapshot',
    fixture: 'test/better-bibtex/export/Better BibLaTeX.005.biblatex',
    snapshot: 'test/snapshots/sentencecase=on^caseprotection=as-needed/export/Better BibLaTeX.005.biblatex.yaml',
    field: 'title',
  },
  {
    name: 'guesses astral-letter title case like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 0,
  },
  {
    name: 'matches Unicode-number sentence state like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 1,
  },
  {
    name: 'matches lowercase acronym token boundaries like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 2,
  },
  {
    name: 'matches version-word token priority like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 3,
  },
  {
    name: 'matches hyphenated guess grouping like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 4,
  },
  {
    name: 'matches hyphenated contractions like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 5,
  },
  {
    name: 'matches punctuation-terminated hyphenated words like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 6,
  },
  {
    name: 'matches malformed URL boundaries like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 7,
  },
  {
    name: 'matches Unicode combining-mark tokenization like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 8,
  },
  {
    name: 'preserves nonbreaking spaces like the default snapshot',
    fixture: 'test/other/sentence-case-utf16.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/sentence-case-utf16.bib.yaml',
    field: 'title',
    entryIndex: 9,
  },
  {
    name: 'renders rich-text lists and paragraphs like the default snapshot',
    fixture: 'test/better-bibtex/export/Unicode ø in author name is exported with trailing space which does not work in bibtex #1538.bibtex',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed/export/Unicode ø in author name is exported with trailing space which does not work in bibtex #1538.bibtex.yaml',
    field: 'note',
  },
  {
    name: 'renders rich-text paragraph boundaries like the default snapshot',
    fixture: 'test/better-bibtex/export/paragraphs in Zotero notes need par #1422.biblatex',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed/export/paragraphs in Zotero notes need par #1422.biblatex.yaml',
    field: 'note',
  },
  {
    name: 'renders heading and nested blockquote commands like the default snapshot',
    fixture: 'test/better-bibtex/export/When exporting notes, also handle the blockquote tag #1656.biblatex',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed/export/When exporting notes, also handle the blockquote tag #1656.biblatex.yaml',
    field: 'note',
  },
  {
    name: 'renders the quotation fixture like the default snapshot',
    fixture: 'test/other/quotation-18.bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/other/quotation-18.bib.yaml',
    field: 'note',
  },
]

/** Load the wasm binary before the Node test cases call the synchronous parser export. */
before(async () => {
  const wasm = fs.readFileSync(path.join(root, 'rust/pkg/bibtex_parser_bg.wasm'))
  await init({ module_or_path: wasm })
})

/** Read a BibTeX fixture and its YAML snapshot, then compare one typed Rust text field. */
for (const { name, fixture, snapshot, field, entryIndex = 0 } of cases) {
  test(name, () => {
    const source = fs.readFileSync(path.join(root, fixture), 'utf8')
    const expected = yaml.load(fs.readFileSync(path.join(root, snapshot), 'utf8'))
    const actual = parseNormalized(source)
    const actualField = actual.entries[entryIndex].fields[field]

    assert.equal(actualField, expected.entries[entryIndex].fields[field])
  })
}

test('preserves ordered title-token boundaries', () => {
  const cases = [
    ['in.example', [['word', 'preposition', 'in'], ['punctuation', '', '.'], ['word', '', 'example']]],
    ["can't.example", [['domain', '', "can't.example"]]],
    ['v2.1', [['word', '', 'v2'], ['punctuation', '', '.'], ['number', '', '1']]],
    ['21st 21ST', [['word', 'ordinal', '21st'], ['whitespace', '', ' '], ['word', '', '21ST']]],
    ['inside ofX', [['word', 'preposition', 'inside'], ['whitespace', '', ' '], ['word', '', 'ofX']]],
    ['according\u00a0to', [['word', 'preposition', 'according\u00a0to']]],
    ['\u017fince', [['word', '', '\u017fince']]],
    ['name@b..c', [['email', '', 'name@b..c']]],
    ['1.2a', [['other', '', '1'], ['punctuation', '', '.'], ['word', '', '2a']]],
    ['name@example.com.', [['word', '', 'name'], ['handle', '', '@example'], ['punctuation', '', '.'], ['word', '', 'com'], ['punctuation', 'end', '.']]],
    ['https://example.com/Path!?', [['website', '', 'https://example.com/Path'], ['punctuation', '', '!'], ['punctuation', 'end', '?']]],
    ['', []],
  ]
  for (const [input, expected] of cases) {
    assert.deepEqual(tokenize(input).map(({ type, subtype, text }) => [type, subtype, text]), expected, input)
  }
})

test('exposes TypeScript-shaped libraries from sync, async, and verbatim APIs', async () => {
  const source = fs.readFileSync(path.join(root, 'test/other/mid-word-capital.bib'), 'utf8')
  const normalized = await parseAsync(source)
  const raw = parseVerbatim(source)

  assert.deepEqual(Object.keys(normalized).sort(), ['comments', 'entries', 'errors', 'jabref', 'preamble', 'strings'])
  assert.deepEqual(Object.keys(raw).sort(), ['comments', 'entries', 'errors', 'preambles', 'strings'])
  assert.equal(parseNormalized(source).entries[0].type, normalized.entries[0].type)
})

test('resolves RegExp verbatim field selectors before Rust normalization', () => {
  const source = fs.readFileSync(path.join(root, 'test/other/mid-word-capital.bib'), 'utf8')
  const parsed = parseNormalized(source, { verbatimFields: [/^title$/] })

  assert.equal(parsed.entries[0].mode.title, 'verbatim')
})

test('matches TypeScript unsupported ignore/keep/throw behavior', async () => {
  const source = String.raw`@article{unknown, note = {before \unknownmacro after}}`

  const ignored = await parseAsync(source, { unsupported: 'ignore' })
  assert.equal(ignored.entries[0].fields.note, 'before after')
  assert.deepEqual(ignored.errors, [{
    error: String.raw`unhandled macro \unknownmacro`,
    input: String.raw`\unknownmacro`,
  }])

  const kept = await parseAsync(source, { unsupported: 'keep' })
  assert.equal(kept.entries[0].fields.note, String.raw`before \unknownmacroafter`)
  assert.equal(kept.errors[0].error, String.raw`unhandled macro \unknownmacro`)

  await assert.rejects(() => parseAsync(source, { unsupported: 'throw' }), /unhandled macro \\unknownmacro/)
  await assert.rejects(() => parseAsync(source, { unsupported: () => 'custom' }), TypeError)
})

test('exports TypeScript-shaped tokens with UTF-16 offsets and markup masks', () => {
  const tokens = tokenize('A <b>bold</b> title', /<[^>]+>/g)
  assert.equal(tokens[0].type, 'word')
  assert.equal(tokens[0].sentenceStart, true)
  assert.equal(tokens[2].text, `${'\u2060'.repeat(3)}bold${'\u2060'.repeat(4)}`)
  assert.equal(tokens[2].start, 2)
  assert.equal(tokens[2].end, 12)

  const astral = tokenize('𝟙2')
  assert.equal(astral[0].start, 0)
  assert.equal(astral[0].end, 1)
  assert.equal(astral[1].start, 2)
})