import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'
import * as yaml from 'js-yaml'

import init, { english, parseAsync, parse, parseVerbatim, parseVerbatimAsync, tokenize } from '../rust/pkg/index.js'

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
    name: 'sentence-cases inline TeX markup like the default snapshot',
    fixture: 'test/citation-js/entry value with sentence-casing (env markup).bib',
    snapshot: 'test/snapshots/sentencecase=on+guess^caseprotection=as-needed^preservequoted/citation-js/entry value with sentence-casing (env markup).bib.yaml',
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
    const actual = parse(source)
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

test('exposes normalized and verbatim libraries with JabRef metadata', async () => {
  const source = '@comment{jabref-meta: groupsversion: 3}\n' + fs.readFileSync(path.join(root, 'test/other/mid-word-capital.bib'), 'utf8')
  const parsed = await parseAsync(source)
  const raw = parseVerbatim(source)

  assert.deepEqual(Object.keys(parsed).sort(), ['comments', 'entries', 'errors', 'jabref', 'preambles', 'strings'])
  assert.deepEqual(Object.keys(raw).sort(), ['comments', 'entries', 'errors', 'jabref', 'preambles', 'strings'])
  assert.equal(raw.jabref.groupsversion, 3)
  assert.deepEqual(raw.jabref, parsed.jabref)
  assert.deepEqual(await parseVerbatimAsync(source), raw)
  assert.equal(parse(source).entries[0].type, parsed.entries[0].type)
})

test('async parsers yield every 1,000 directives and parsed entries', async () => {
  const setTimeout = globalThis.setTimeout
  let yields = 0
  globalThis.setTimeout = (callback, delay, ...args) => {
    yields++
    return setTimeout(callback, delay, ...args)
  }
  try {
    for (const count of [0, 999, 1000, 2001]) {
      const source = Array.from({ length: count }, (_, index) => `@misc{entry${index},title={Title}}`).join('\n')
      yields = 0
      assert.deepEqual(await parseVerbatimAsync(source), parseVerbatim(source))
      assert.equal(yields, Math.floor(count / 1000))
      yields = 0
      assert.deepEqual(await parseAsync(source), parse(source))
      assert.equal(yields, 2 * Math.floor(count / 1000))
    }
    const source = '@comment{comment}\n'.repeat(1000) + '@misc{entry,title={Title}}'
    yields = 0
    assert.deepEqual(await parseAsync(source), parse(source))
    assert.equal(yields, 1)
    yields = 0
    const limited = await parseVerbatimAsync('@misc{entry}\n'.repeat(2000), { maxEntries: 1000 })
    assert.equal(limited.entries.length, 1000)
    assert.equal(yields, 1)
    yields = 0
    const selected = await parseAsync('@misc{entry,title={Title}}\n'.repeat(1000), { verbatimFields: [/^title$/] })
    assert.equal(selected.entries[0].mode.title, 'verbatim')
    assert.equal(yields, 2)
  }
  finally {
    globalThis.setTimeout = setTimeout
  }
})

test('passes explicit language lists and case-protection modes to Rust', async () => {
  const source = '@misc{english,title={A Long Title},langid={en}}\n@misc{unspecified,title={A Long Title}}'
  const titles = result => result.entries.map(entry => entry.fields.title)

  assert.deepEqual(parse(source, { english }), parse(source))
  for (const [languages, expected] of [
    [english, ['A long title', 'A long title']],
    [[], ['A Long Title', 'A Long Title']],
    [['en'], ['A long title', 'A Long Title']],
  ]) {
    const originalLanguages = [...languages]
    const options = { english: languages, sentenceCase: { guess: false } }
    const parsed = parse(source, options)
    assert.deepEqual(titles(parsed), expected)
    assert.deepEqual(await parseAsync(source, options), parsed)
    assert.deepEqual(languages, originalLanguages)
  }

  const protectedSource = '@misc{protected,title={A {Protected} Title}}'
  const options = { caseProtection: 'off', sentenceCase: { guess: false } }
  const parsed = parse(protectedSource, options)
  assert.equal(parsed.entries[0].fields.title, 'A Protected title')
  assert.equal(parse(protectedSource, { ...options, caseProtection: 'strict' }).entries[0].fields.title,
    'A <span class="nocase">Protected</span> title')
  assert.deepEqual(await parseAsync(protectedSource, options), parsed)
})

test('controls adjacent markup collapsing through collapseMarkup', () => {
  const source = String.raw`@book{x,title={\textit{One} \textit{Two}}}`
  const options = { fieldMode: { title: 'literal' } }

  assert.equal(parse(source, options).entries[0].fields.title, '<i>One Two</i>')
  assert.equal(parse(source, { ...options, collapseMarkup: false }).entries[0].fields.title, '<i>One</i> <i>Two</i>')
})

test('accepts string maps or BibTeX source through strings', async () => {
  const mapInput = '@misc{strings,title=mapped}'
  const mapOptions = { strings: { mapped: 'Mapped' }, english: [], maxEntries: 1 }
  const parsedMap = parse(mapInput, mapOptions)
  assert.equal(parsedMap.entries[0].fields.title, 'Mapped')
  assert.deepEqual(await parseAsync(mapInput, mapOptions), parsedMap)

  const sourceInput = '@misc{strings,title=sourced}'
  const sourceOptions = { strings: '@string{sourced={Sourced}}', english: [], maxEntries: 1 }
  const parsedSource = parse(sourceInput, sourceOptions)
  assert.equal(parsedSource.entries[0].fields.title, 'Sourced')
  assert.deepEqual(await parseAsync(sourceInput, sourceOptions), parsedSource)
  const raw = parseVerbatim(sourceInput, sourceOptions)
  assert.equal(raw.entries[0].fields.title, 'Sourced')
  assert.ok(raw.strings.SOURCED)
  assert.deepEqual(await parseVerbatimAsync(sourceInput, sourceOptions), raw)
  assert.deepEqual(parse(sourceInput, { english: undefined }), parse(sourceInput))
})

test('matches RegExp verbatim field selectors directly in Rust', async () => {
  const source = fs.readFileSync(path.join(root, 'test/other/mid-word-capital.bib'), 'utf8')
  const parsed = parse(source, { verbatimFields: [/^title$/] })

  assert.equal(parsed.entries[0].mode.title, 'verbatim')
  assert.deepEqual(await parseAsync(source, { verbatimFields: [/^title$/] }), parsed)
})

test('matches exact names and case-insensitive regex selectors without changing caller options', async () => {
  const source = '@misc{patterns,title={Title},subtitle={Subtitle},customa={One},customb={Two},customaa={Three},x.y={Dot},xay={Other}}'
  const options = { verbatimFields: ['TITLE', /^custom[ab]$/g, 'x.y'] }
  const parsed = parse(source, options)
  for (const field of ['title', 'customa', 'customb', 'x.y']) assert.equal(parsed.entries[0].mode[field], 'verbatim')
  for (const field of ['subtitle', 'customaa', 'xay']) assert.notEqual(parsed.entries[0].mode[field], 'verbatim')
  assert.deepEqual(await parseAsync(source, options), parsed)
  assert.equal(options.verbatimFields[0], 'TITLE')
  assert.equal(options.verbatimFields[1].lastIndex, 0)
  assert.equal(parse(source, { verbatimFields: [/CUSTOM[AB]/] }).entries[0].mode.customaa, 'verbatim')
  assert.notEqual(parse(source, { verbatimFields: [/title/y] }).entries[0].mode.subtitle, 'verbatim')
})

test('rejects regex selectors unsupported by regex-lite', async () => {
  const source = '@misc{entry,title={Title}}'
  const options = { verbatimFields: [/(?=title)/] }
  assert.throws(() => parse(source, options))
  await assert.rejects(() => parseAsync(source, options))
})

test('matches TypeScript unsupported tex/text/ignore/throw behavior', async () => {
  const source = String.raw`@article{unknown, note = {before \unknownmacro after}}`

  const defaultResult = await parseAsync(source)
  assert.equal(defaultResult.entries[0].fields.note, String.raw`before \unknownmacroafter`)

  const ignored = await parseAsync(source, { unsupported: 'ignore' })
  assert.equal(ignored.entries[0].fields.note, 'before after')
  assert.deepEqual(ignored.errors, [{
    error: String.raw`unhandled macro \unknownmacro`,
    input: String.raw`\unknownmacro`,
  }])

  const tex = await parseAsync(source, { unsupported: 'tex' })
  assert.equal(tex.entries[0].fields.note, 'before <script>\\unknownmacro</script>after')
  assert.equal(tex.errors[0].error, String.raw`unhandled macro \unknownmacro`)

  const text = await parseAsync(source, { unsupported: 'text' })
  assert.equal(text.entries[0].fields.note, 'before unknownmacroafter')
  assert.equal(text.errors[0].error, String.raw`unhandled macro \unknownmacro`)

  await assert.rejects(() => parseAsync(source, { unsupported: 'throw' }), /unhandled macro \\unknownmacro/)
  await assert.rejects(() => parseAsync(source, { unsupported: 'keep' }), TypeError)
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