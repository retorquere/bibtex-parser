import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'

import init, { english, parseAsync, parse, parseVerbatim, parseVerbatimAsync } from '../rust/pkg/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Load the wasm binary before the Node test cases call the synchronous parser export. */
before(async () => {
  const wasm = fs.readFileSync(path.join(root, 'rust/pkg/bibtex_parser_bg.wasm'))
  await init({ module_or_path: wasm })
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
      await parseVerbatimAsync(source)
      assert.equal(yields, Math.floor(count / 1000))
      yields = 0
      await parseAsync(source)
      assert.equal(yields, 2 * Math.floor(count / 1000))
    }
    const source = '@comment{comment}\n'.repeat(1000) + '@misc{entry,title={Title}}'
    yields = 0
    await parseAsync(source)
    assert.equal(yields, 1)
    yields = 0
    const limited = await parseVerbatimAsync('@misc{entry}\n'.repeat(2000), { maxEntries: 1000 })
    assert.equal(limited.entries.length, 1000)
    assert.equal(yields, 1)
  }
  finally {
    globalThis.setTimeout = setTimeout
  }
})

test('supports explicit language lists and case-protection modes', () => {
  const source = '@misc{english,title={A Long Title},langid={en}}\n@misc{unspecified,title={A Long Title}}'
  const titles = result => result.entries.map(entry => entry.fields.title)

  for (const [languages, expected] of [
    [english, ['A long title', 'A long title']],
    [[], ['A Long Title', 'A Long Title']],
    [['en'], ['A long title', 'A Long Title']],
  ]) {
    const originalLanguages = [...languages]
    const options = { english: languages, sentenceCase: { guess: false } }
    const parsed = parse(source, options)
    assert.deepEqual(titles(parsed), expected)
    assert.deepEqual(languages, originalLanguages)
  }

  const protectedSource = '@misc{protected,title={A {Protected} Title}}'
  const options = { caseProtection: 'off', sentenceCase: { guess: false } }
  const parsed = parse(protectedSource, options)
  assert.equal(parsed.entries[0].fields.title, 'A Protected title')
  assert.equal(parse(protectedSource, { ...options, caseProtection: 'strict' }).entries[0].fields.title,
    'A <span class="nocase">Protected</span> title')
})

test('controls adjacent markup collapsing through collapseMarkup', () => {
  const source = String.raw`@book{x,title={\textit{One} \textit{Two}}}`
  const options = { fieldMode: { title: 'literal' } }

  assert.equal(parse(source, options).entries[0].fields.title, '<i>One Two</i>')
  assert.equal(parse(source, { ...options, collapseMarkup: false }).entries[0].fields.title, '<i>One</i> <i>Two</i>')
})

test('accepts string maps or BibTeX source through strings', () => {
  const mapInput = '@misc{strings,title=mapped}'
  const mapOptions = { strings: { mapped: 'Mapped' }, english: [], maxEntries: 1 }
  const parsedMap = parse(mapInput, mapOptions)
  assert.equal(parsedMap.entries[0].fields.title, 'Mapped')

  const sourceInput = '@misc{strings,title=sourced}'
  const sourceOptions = { strings: '@string{sourced={Sourced}}', english: [], maxEntries: 1 }
  const parsedSource = parse(sourceInput, sourceOptions)
  assert.equal(parsedSource.entries[0].fields.title, 'Sourced')
  const raw = parseVerbatim(sourceInput, sourceOptions)
  assert.equal(raw.entries[0].fields.title, 'Sourced')
  assert.ok(raw.strings.SOURCED)
})

test('matches case-insensitive glob selectors without changing caller options', () => {
  const source = '@misc{patterns,title={Title},subtitle={Subtitle},customa={One},customb={Two},customaa={Three},x.y={Dot},xay={Other}}'
  const options = { verbatimFields: ['TITLE', 'custom?', 'x.y'] }
  const parsed = parse(source, options)
  for (const field of ['title', 'customa', 'customb', 'x.y']) assert.equal(parsed.entries[0].mode[field], 'verbatim')
  for (const field of ['subtitle', 'customaa', 'xay']) assert.notEqual(parsed.entries[0].mode[field], 'verbatim')
  assert.equal(options.verbatimFields[0], 'TITLE')
  assert.deepEqual(options.verbatimFields, ['TITLE', 'custom?', 'x.y'])
})

test('treats regex punctuation as literal glob text', () => {
  const source = '@misc{entry,title={Title}}'
  const parsed = parse(source, { verbatimFields: ['^title$'] })
  assert.notEqual(parsed.entries[0].mode.title, 'verbatim')
})
