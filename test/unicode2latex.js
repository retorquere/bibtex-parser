#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'

import init, { Transform } from '@retorquere/bibtex-parser/unicode2latex'

before(async () => {
  const wasm = readFileSync(new URL(import.meta.resolve('@retorquere/bibtex-parser/unicode2latex_bg.wasm')))
  await init({ module_or_path: wasm })
})

test('macro spacer', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('On Recovery of Sparse Signals via ££p Minimization'), 'On Recovery of Sparse Signals via \\pounds\\pounds p Minimization')
})

test('Protokolle zu Drogenversuchen. Hauptzüge der ersten Haschisch-Impression', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Protokolle zu Drogenversuchen. Hauptzüge der ersten Haschisch-Impression'), 'Protokolle zu Drogenversuchen. Hauptz\\"uge der ersten Haschisch-Impression')
})

test('Planung öffentlicher Elektrizitätsverteilungs-Systeme', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Planung öffentlicher Elektrizitätsverteilungs-Systeme'), 'Planung \\"offentlicher Elektrizit\\"atsverteilungs-Systeme')
})

test('Giga Barićeva. Roman iz zagrebačkog poslijeratnog života', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Giga Barićeva. Roman iz zagrebačkog poslijeratnog života'), "Giga Bari\\'ceva. Roman iz zagreba\\v ckog poslijeratnog \\v zivota")
})

test('En ny sociologi for et nyt samfund. Introduktion til Aktør-Netværk-Teori', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('En ny sociologi for et nyt samfund. Introduktion til Aktør-Netværk-Teori'), 'En ny sociologi for et nyt samfund. Introduktion til Akt\\o r-Netv\\ae rk-Teori')
})

test('La démocratie. Sa nature, sa valeur', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('La démocratie. Sa nature, sa valeur'), "La d\\'emocratie. Sa nature, sa valeur")
})

test('Overall Normalization of the Astrophysical → Reactions', () => {
  const tx = new Transform('biblatex')
  const packages = new Set()
  assert.equal(tx.tolatex('Overall Normalization of the Astrophysical → Reactions', { packages }), 'Overall Normalization of the Astrophysical $\\rightarrow$ Reactions')
  assert.equal([...packages].sort().join(','), 'textcomp')
})

test('§ 1063 ABGB', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('§ 1063 ABGB'), '\\S{} 1063 ABGB')
})

test('Die Sicherungsübereignung', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Die Sicherungsübereignung'), 'Die Sicherungs\\"ubereignung')
})

test('Entscheidung nach § 98 EheG und anhängiges Verfahren', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Entscheidung nach § 98 EheG und anhängiges Verfahren'), 'Entscheidung nach \\S{} 98 EheG und anh\\"angiges Verfahren')
})

test('Object-based attentional selection–grouped arrays or spatially invariant representations?: comment on vecera and Farah (1994).', () => {
  const tx = new Transform('biblatex')
  assert.equal(
    tx.tolatex(
      'Object-based attentional selection–grouped arrays or spatially invariant representations?: '
        + 'comment on vecera and Farah (1994).',
    ),
    'Object-based attentional selection--grouped arrays or spatially invariant representations?: '
      + 'comment on vecera and Farah (1994).',
  )
})

test('De l’asynergie cerebelleuse', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('De l’asynergie cerebelleuse'), "De l'asynergie cerebelleuse")
})

test('Representational similarity analysis – connecting the branches of systems neuroscience.', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Representational similarity analysis – connecting the branches of systems neuroscience.'), 'Representational similarity analysis -- connecting the branches of systems neuroscience.')
})

test('Infants’ brain responses to speech suggest analysis by synthesis', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Infants’ brain responses to speech suggest analysis by synthesis'), "Infants' brain responses to speech suggest analysis by synthesis")
})

test('Bürgerliches Recht Band I Allgemeiner Teil', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Bürgerliches Recht Band I Allgemeiner Teil'), 'B\\"urgerliches Recht Band I Allgemeiner Teil')
})

// test("math: 0 < p < 1", () => {
//   tx({ text: "0 < p < 1", prefer: 'math' }, "$0 < p < 1$")
// })

test('non-breaking space: ; accented characters: ñ and ñ; tilde in URL: http://example.com/~user', () => {
  const tx = new Transform('minimal')
  assert.equal(tx.tolatex('non-breaking space: ; accented characters: ñ and ñ; tilde in URL: http://example.com/~user'), 'non-breaking space: ; accented characters: ñ and ñ; tilde in URL: http://example.com/\\textasciitilde user')
})

test('ogonek in bibtex-creator Munaf\u0102\u02db', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('ogonek in bibtex-creator Munaf\u0102\u02db'), 'ogonek in bibtex-creator Munaf{\\u A}{\\k{}}')
})
test('ogonek in bibtex Munaf\u0102\u02db', () => {
  const tx = new Transform('bibtex')
  assert.equal(tx.tolatex('ogonek in bibtex Munaf\u0102\u02db'), 'ogonek in bibtex Munaf\\u A\\k{}')
})

test('Molecular Theory of Atomic Collisions: Calculated Cross Sections for ${\\mathrm{H}}^{+\\}}+\\mathrm{F}(^{2}P)$', () => {
  const tx = new Transform('bibtex')
  assert.equal(tx.tolatex('Molecular Theory of Atomic Collisions: Calculated Cross Sections for ${\\mathrm{H}}^{+\\}}+\\mathrm{F}(^{2}P)$'), 'Molecular Theory of Atomic Collisions: Calculated Cross Sections for \\$\\textbraceleft\\textbackslash mathrm\\textbraceleft H\\textbraceright\\textbraceright\\textasciicircum\\textbraceleft +\\textbackslash\\textbraceright\\textbraceright +\\textbackslash mathrm\\textbraceleft F\\textbraceright (\\textasciicircum\\textbraceleft 2\\textbraceright P)\\$')
})

test('Pető', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Pető'), 'Pet\\H o')
})

test('K̅', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('K̅'), '$\\overline K$')
})

test('Lemaître', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Lemaître'), 'Lema\\^itre')
})

test('2 > 1', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('2 > 1'), '2 $>$ 1')
})

test('CJK quotes unchanged', () => {
  const tx = new Transform('minimal')
  assert.equal(tx.tolatex('“民族国家”的迷思与现代中国的形成'), '“民族国家”的迷思与现代中国的形成')
})

test('{Rafael', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('{Rafael'), '{\\textbraceleft}Rafael')
})
test('Pérez}', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('Pérez}'), "P{\\'e}rez{\\textbraceright}")
})
test('Pérez}, {Rafael', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('Pérez}, {Rafael'), "P{\\'e}rez{\\textbraceright}, {\\textbraceleft}Rafael")
})

test('Francisco Perdigón', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('bibtex-creator Francisco Perdigón'), "bibtex-creator Francisco Perdig{\\'o}n")
})
test('Francisco Perdigón', () => {
  const tx = new Transform('bibtex')
  assert.equal(tx.tolatex('bibtex Francisco Perdigón'), "bibtex Francisco Perdig\\'on")
})

test('Michał', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('Michał MichałMichał'), 'Micha{\\l} Micha{\\l}Micha{\\l}')
})

test('Paı̈doussis', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('Paı̈doussis'), 'Pa{\\"\\i}doussis')
})

test('Oxenløwe', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('Oxenløwe'), 'Oxenl{\\o}we')
})

test('episteme', () => {
  const input = "In philosophy, episteme (Ancient Greek: ἐπιστήμη, romanized: epistēmē, lit. 'science, knowledge'; French: épistémè) is a term that refers to a principle system of understanding (i.e., knowledge), such as scientific knowledge or practical knowledge. The term comes from the Ancient Greek verb ἐπῐ́στᾰμαι, epístamai, meaning 'to know, to understand, to be acquainted with'. The term epistemology (the branch of philosophy concerning knowledge) is derived from episteme. Plato contrasts episteme with doxa: common belief or opinion. The term episteme is also distinguished from techne: a craft or applied practice.  Socrates noted that nous and episteme is requisite for prudence (phronesis)."
  const output = "In philosophy, episteme (Ancient Greek: $\\acute{\\epsilon}\\pi\\iota\\sigma\\tau\\acute{\\eta}\\mu\\eta$, romanized: epist\\=em\\=e, lit.\\,'science, knowledge'; French: \\'epist\\'em\\`e) is a term that refers to a principle system of understanding (i.e., knowledge), such as scientific knowledge or practical knowledge. The term comes from the Ancient Greek verb $\\acute{\\epsilon}\\pi\\hat{\\iota}\\sigma\\tau\\breve{\\alpha}\\mu\\alpha\\iota$, ep\\'istamai, meaning 'to know, to understand, to be acquainted with'. The term epistemology (the branch of philosophy concerning knowledge) is derived from episteme. Plato contrasts episteme with doxa: common belief or opinion. The term episteme is also distinguished from techne: a craft or applied practice.  Socrates noted that nous and episteme is requisite for prudence (phronesis)."
  const tx = new Transform('bibtex')
  const packages = new Set()
  assert.equal(tx.tolatex(input, { packages }), output)
  assert.equal([...packages].sort().join(','), 'textalpha,textgreek')
})

test('Lavı́n biblatex', () => {
  const tx = new Transform('biblatex')
  assert.equal(tx.tolatex('Lavı́n'), "Lav{\\'\\i}n")
})

test('Lavı́n bibtex', () => {
  const tx = new Transform('bibtex')
  assert.equal(tx.tolatex('Lavı́n'), "Lav{\\'\\i}n")
})
test('Lavı́n creator', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('Lavı́n'), "Lav{\\'\\i}n")
})

test('Nguyễn, Xuân Thắng', () => {
  const tx = new Transform('bibtex-creator')
  assert.equal(tx.tolatex('Nguyễn, Xuân Thắng'), "Nguy{\\~{\\^e}}n, Xu{\\^a}n Th{\\'{\\u a}}ng")
})
