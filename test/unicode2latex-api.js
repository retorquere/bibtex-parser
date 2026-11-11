import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'

import init, { Transform, biblatex, bibtex, combining, latex2unicode, minimal, replace_macro_spacers } from '@retorquere/bibtex-parser/unicode2latex'

before(async () => {
  const wasm = readFileSync(new URL(import.meta.resolve('@retorquere/bibtex-parser/unicode2latex_bg.wasm')))
  await init({ module_or_path: wasm })
})

test('exported mapping tables are available', () => {
  for (const table of [biblatex, bibtex, minimal, combining, latex2unicode]) {
    assert.ok(Object.keys(table).length > 0)
  }
  assert.ok(biblatex.base['£'])
  assert.ok(combining.tolatex['\u0301'])
})

test('all translation modes use the Rust transformer', () => {
  assert.equal(new Transform('minimal').tolatex('ñ'), 'ñ')
  assert.equal(new Transform('biblatex').tolatex('2 > 1'), '2 $>$ 1')
  assert.equal(new Transform('bibtex').tolatex('Pető'), 'Pet\\H o')
  assert.equal(new Transform('bibtex-creator').tolatex('Pérez}'), "P{\\'e}rez{\\textbraceright}")
  assert.throws(() => new Transform('unknown'))
})

test('custom maps, math bracing, and package hints are preserved', () => {
  const custom = new Transform('minimal', { charmap: { '☃': { text: 'SNOW' } } })
  assert.equal(custom.tolatex('☃'), 'SNOW')

  const packages = new Set(['already-present'])
  const transform = new Transform('biblatex')
  assert.equal(transform.tolatex('→', { bracemath: true, packages }), '{$\\rightarrow$}')
  assert.deepEqual([...packages], ['already-present', 'textcomp'])
})

test('macro spacer helper follows ordered TeX-safe replacements', () => {
  assert.equal(replace_macro_spacers('\\S\0 next\0, x\0y\0'), '\\S{} next, x y')
  assert.equal(replace_macro_spacers('\0\0 '), '{} ')
})
