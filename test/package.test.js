import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import * as typescript from '@retorquere/bibtex-parser/js'
import init, * as wasm from '@retorquere/bibtex-parser'

const require = createRequire(import.meta.url)
const input = '@article{example, title={A title}}'

test('the default entry point is the WASM parser and /js is the TypeScript parser', () => {
  assert.equal(typescript.parse(input).entries[0].key, 'example')
  assert.equal(typescript.init, undefined)
  assert.equal(typeof init, 'function')
})

test('the package entry points are ESM-only', () => {
  assert.throws(() => require('@retorquere/bibtex-parser'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
  assert.throws(() => require('@retorquere/bibtex-parser/js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
})

test('TypeScript verbatim selectors accept wildflower glob patterns', () => {
  const source = String.raw`@misc{x,customa={\textit{one}},customb={\textit{two}},customaa={\textit{three}},x.y={\textit{dot}},xay={\textit{other}},manychars={\textit{many}},xmanychars={\textit{not many}}}`
  const parsed = typescript.parse(source, { english: [], verbatimFields: ['CUSTOM?', 'x.y', 'many*'] })
  const fields = parsed.entries[0].fields

  assert.equal(fields.customa, String.raw`\textit{one}`)
  assert.equal(fields.customb, String.raw`\textit{two}`)
  assert.equal(fields.customaa, '<i>three</i>')
  assert.equal(fields['x.y'], String.raw`\textit{dot}`)
  assert.equal(fields.xay, '<i>other</i>')
  assert.equal(fields.manychars, String.raw`\textit{many}`)
  assert.equal(fields.xmanychars, '<i>not many</i>')
  assert.throws(() => typescript.parse(source, { verbatimFields: [/custom/] }), /verbatimFields entries must be glob strings/)
})

test('sentence casing ignores markup while retaining whole words', () => {
  const markup = /<\/?[a-z]+>/ig
  const options = { markup, guess: false }
  assert.equal(typescript.toSentenceCase('A <i>A</i> B I', options), 'A <i>a</i> B I')
  assert.equal(typescript.toSentenceCase('An Ex<em>ample</em>', options), 'An ex<em>ample</em>')
  assert.equal(typescript.toSentenceCase('A İ<i>X</i>', options), 'A i\u0307<i>x</i>')

  const protectedOptions = {
    markup: /<\/?span(?:\s+[^>]*)?>/ig,
    nocase: /<span class="nocase">.*?<\/span>/g,
    guess: false,
  }
  assert.equal(
    typescript.toSentenceCase('A Mm<span class="nocase">²</span> Size', protectedOptions),
    'A mm<span class="nocase">²</span> size',
  )
  assert.equal(
    typescript.toSentenceCase('A MM<span class="nocase">X</span> SIZE', protectedOptions),
    'A mm<span class="nocase">X</span> size',
  )
})

test('sentence casing lowercases standalone A but preserves other initials', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const options = { guess: false, subSentenceCapitalization: false }
  for (const parser of [typescript, wasm]) {
    for (const title of ['Model A B I X', 'MODEL A B I X']) {
      assert.equal(parser.toSentenceCase(title, options), 'Model a B I X')
    }
  }
})

test('the WASM entry point loads the exported binary and parses', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  assert.equal(wasm.parse(input).entries[0].key, 'example')
  assert.equal((await wasm.parseAsync(input)).entries[0].key, 'example')
  assert.equal(wasm.parseVerbatim(input).entries[0].key, 'example')
})

test('JabRef metadata supports identical membership updates in both implementations', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const source = String.raw`@comment{jabref-meta: grouping:
0 AllEntriesGroup:;
1 StaticGroup:Parent\;0\;;
2 StaticGroup:Child\;0\;;
1 StaticGroup:Child\;0\;;
}`
  for (const parser of [typescript, wasm]) {
    const results = [parser.parse(source), await parser.parseAsync(source)]
    if (parser === wasm) results.push(parser.parseVerbatim(source), await parser.parseVerbatimAsync(source))
    for (const { jabref } of results) {
      assert.ok(jabref instanceof parser.JabRefMetadata)
      assert.equal('groups' in jabref, false)
      assert.equal(jabref.addEntry('Child', 'example'), true)
      assert.equal(jabref.addEntry('Child', 'example'), true)
      assert.deepEqual(jabref.root[0].groups[0].entries, ['example'])
      assert.deepEqual(jabref.root[1].entries, [])
      assert.equal(jabref.addEntry('Missing', 'example'), false)
      assert.equal(jabref.addEntry('Parent', 'example'), true)
      assert.deepEqual(jabref.root[0].entries, ['example'])
      const serialized = JSON.parse(JSON.stringify(jabref))
      assert.deepEqual(Object.keys(serialized), ['root'])
      assert.deepEqual(serialized.root, jabref.root)
    }
  }
})

test('JabRef preserves the collections hierarchy from the #901 fixture', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const source = readFileSync(new URL('./better-bibtex/export/Better BibTeX does not export collections %23901.bibtex', import.meta.url), 'utf8')
  for (const parser of [typescript, wasm]) {
    for (const result of [parser.parse(source), await parser.parseAsync(source)]) {
      const roots = result.jabref.root
      assert.deepEqual(roots.map(group => group.name), ['Commun', 'FM', 'Isa'])
      const find = (groups, ...path) => {
        const group = groups.find(group => group.name === path[0])
        assert.ok(group, `Missing group: ${path[0]}`)
        return path.length === 1 ? group : find(group.groups, ...path.slice(1))
      }
      assert.ok(find(roots, 'FM', '_Auteurs', 'Aristote'))
      assert.ok(find(roots, 'FM', '0018_MarioBunge', 'Oeuvres'))
      assert.ok(find(roots, 'Isa', 'Refworks', '_Non-classees'))
    }
  }
})

test('renders TeX control-space as a regular space in the TypeScript parser', () => {
  const parsed = typescript.parse(String.raw`@article{example, title={foo\ bar}}`)
  assert.equal(parsed.entries[0].fields.title, 'foo bar')
  assert.deepEqual(parsed.errors, [])
})

test('treats \\undefined as a no-op in the TypeScript parser', () => {
  const parsed = typescript.parse(String.raw`@article{example, title={foo\undefined bar}}`)
  assert.equal(parsed.entries[0].fields.title, 'foobar')
  assert.deepEqual(parsed.errors, [])
})

test('\\allcaps protects its contents in both parsers', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const source = String.raw`@article{example, title={A \allcaps{NASA} title}, note={\allcaps{NASA}}}`
  const options = { caseProtection: 'strict' }

  for (const parsed of [typescript.parse(source, options), wasm.parse(source, options)]) {
    assert.equal(parsed.entries[0].fields.title, 'A <span class="nocase">NASA</span> title')
    assert.equal(parsed.entries[0].fields.note, 'NASA')
    assert.deepEqual(parsed.errors, [])
  }
})

test('renders \\sb and \\sp like text sub/superscripts in both parsers', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const aliases = [
    ['\\sb{2}', '\\textsubscript{2}'],
    ['\\sb 2', '\\textsubscript 2'],
    ['\\sp{2}', '\\textsuperscript{2}'],
    ['\\sp 2', '\\textsuperscript 2'],
  ]
  for (const [alias, canonical] of aliases) {
    const source = macro => `@article{example, title={H${macro}O}}`
    const expected = typescript.parse(source(canonical)).entries[0].fields.title
    const ts = typescript.parse(source(alias))
    const parsed = wasm.parse(source(alias))

    assert.equal(ts.entries[0].fields.title, expected)
    assert.equal(parsed.entries[0].fields.title, expected)
    assert.deepEqual(ts.errors, [])
    assert.deepEqual(parsed.errors, [])
  }
})

test('renders numeric \\symbol codes in both parsers', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const source = String.raw`@article{example, title={\symbol{65}\symbol{32}\symbol{126}\symbol{8364}\symbol{128512}}, note={\symbol{128}}}`
  const ts = typescript.parse(source)
  const rust = wasm.parse(source)

  assert.equal(ts.entries[0].fields.title, 'A ~€😀')
  assert.equal(rust.entries[0].fields.title, 'A ~€😀')
  assert.equal(ts.entries[0].fields.note, '\u0080')
  assert.equal(rust.entries[0].fields.note, '\u0080')
  assert.deepEqual(ts.errors, [])
  assert.deepEqual(rust.errors, [])

  const invalid = String.raw`@article{example, note={\symbol{1114112}}}`
  for (const parsed of [typescript.parse(invalid), wasm.parse(invalid)]) {
    assert.equal(parsed.entries[0].fields.note, String.raw`\symbol{1114112}`)
    assert.ok(parsed.errors[0].error.includes(String.raw`unhandled macro \symbol`))
  }
})

test('renders the third \\discretionary argument in both parsers', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const source = String.raw`@article{example, note={A\discretionary{pre}{post}{third}B}}`

  for (const parsed of [typescript.parse(source), wasm.parse(source)]) {
    assert.equal(parsed.entries[0].fields.note, 'AthirdB')
    assert.deepEqual(parsed.errors, [])
  }
})

test('all public parser results retain multiple preambles under the plural name', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/bibtex_parser_bg.wasm')) })
  const source = '@preamble{First}\n@preamble{Second}\n@misc{entry,title={Title}}'
  const results = [
    typescript.parse(source),
    await typescript.parseAsync(source),
    typescript.parseVerbatim(source),
    wasm.parse(source),
    await wasm.parseAsync(source),
    wasm.parseVerbatim(source),
    await wasm.parseVerbatimAsync(source),
  ]
  for (const result of results) {
    assert.deepEqual(result.preambles, ['First', 'Second'])
    assert.equal(Object.hasOwn(result, 'preamble'), false)
  }
})

test('the npm package includes both implementations and their declarations', () => {
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  }))
  const files = new Set(packed.files.map(file => file.path))
  for (const file of [
    'dist/esm/index.js',
    'dist/esm/index.d.ts',
    'dist/wasm/index.js',
    'dist/wasm/index.d.ts',
    'dist/wasm/jabref.js',
    'dist/wasm/jabref.d.ts',
    'dist/wasm/bibtex_parser.js',
    'dist/wasm/bibtex_parser.d.ts',
    'dist/wasm/bibtex_parser_bg.wasm',
    'dist/wasm/bibtex_parser_bg.wasm.d.ts',
  ]) {
    assert.ok(files.has(file), `${file} is missing from the package`)
  }
  assert.equal(files.has('dist/cjs/index.js'), false)
})