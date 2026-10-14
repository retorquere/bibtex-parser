import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import * as typescript from '@retorquere/bibtex-parser'
import init, * as wasm from '@retorquere/bibtex-parser/wasm'

const require = createRequire(import.meta.url)
const input = '@article{example, title={A title}}'

test('the default entry point remains the TypeScript parser', () => {
  assert.equal(typescript.parse(input).entries[0].key, 'example')
  assert.equal(typescript.init, undefined)
})

test('the WASM entry point is ESM-only', () => {
  assert.throws(() => require('@retorquere/bibtex-parser/wasm'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
})

test('the WASM entry point loads the exported binary and parses', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/wasm/bibtex_parser_bg.wasm')) })
  assert.equal(wasm.parse(input).entries[0].key, 'example')
  assert.equal((await wasm.parseAsync(input)).entries[0].key, 'example')
  assert.equal(wasm.parseVerbatim(input).entries[0].key, 'example')
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

test('renders \\sb and \\sp like text sub/superscripts in both parsers', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/wasm/bibtex_parser_bg.wasm')) })
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
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/wasm/bibtex_parser_bg.wasm')) })
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

test('all public parser results retain multiple preambles under the plural name', async () => {
  await init({ module_or_path: readFileSync(require.resolve('@retorquere/bibtex-parser/wasm/bibtex_parser_bg.wasm')) })
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
    'dist/cjs/index.js',
    'dist/types/index.d.ts',
    'dist/wasm/index.js',
    'dist/wasm/index.d.ts',
    'dist/wasm/bibtex_parser.js',
    'dist/wasm/bibtex_parser.d.ts',
    'dist/wasm/bibtex_parser_bg.wasm',
    'dist/wasm/bibtex_parser_bg.wasm.d.ts',
  ]) {
    assert.ok(files.has(file), `${file} is missing from the package`)
  }
})