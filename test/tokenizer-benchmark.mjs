import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const loader = pathToFileURL(path.join(root, 'pkg/bibtex_parser.js')).href
const fixture = fs.readFileSync(path.join(root, 'test/other/sentence-case-utf16.bib'), 'utf8').split(/\r?\n/)
if (fixture.at(-1) === '') fixture.pop()
const inputs = fixture.concat([
  'A TITLE: AN EXPLANATION',
  'The Effect of DNA on RNA in Cells',
  'According to the State-of-the-Art Results',
  'Email a+b@example.org or Visit https://example.org/path?!',
  'An Ex<i>ample</i> with \u{1f600} and \u{301}\u{e9} Unicode',
])
const options = { guess: false, subSentenceCapitalization: true, preserveQuoted: true }
const arguments_ = process.argv.slice(2)
const variants = (arguments_.length ? arguments_ : ['current=pkg/bibtex_parser_bg.wasm']).map(argument => {
  const separator = argument.indexOf('=')
  assert.ok(separator > 0, 'Expected label=path/to/module.wasm')
  const label = argument.slice(0, separator)
  const bytes = fs.readFileSync(path.resolve(root, argument.slice(separator + 1)))
  return { label, bytes, firstCalls: [], initialization: [], trials: [], engine: undefined }
})
const iterations = Number(process.env.TOKENIZER_BENCH_ITERATIONS ?? 500)
assert.ok(Number.isSafeInteger(iterations) && iterations > 0, 'Iterations must be a positive integer')

/** Return the middle sample without changing trial order. */
function median(samples) {
  return [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)]
}

let expected
for (let trial = 0; trial < 7; trial++) {
  const ordered = trial % 2 ? [...variants].reverse() : variants
  for (const variant of ordered) {
    // A separate loader module creates a fresh WASM instance, including any lazy regex cache.
    const engine = await import(`${loader}?tokenizer-benchmark=${encodeURIComponent(variant.label)}-${trial}`)
    let started = performance.now()
    await engine.default({ module_or_path: variant.bytes })
    variant.initialization.push(performance.now() - started)
    started = performance.now()
    engine.toSentenceCase(inputs[0], options)
    variant.firstCalls.push(performance.now() - started)
    const outputs = inputs.map(input => engine.toSentenceCase(input, options))
    if (expected) assert.deepEqual(outputs, expected, `${variant.label}: sentence-case parity`)
    else expected = outputs
    variant.engine = engine
  }
}

let checksum = 0
for (const variant of variants) {
  for (let iteration = 0; iteration < 100; iteration++) {
    for (const input of inputs) checksum += variant.engine.toSentenceCase(input, options).length
  }
}
for (let trial = 0; trial < 7; trial++) {
  const ordered = trial % 2 ? [...variants].reverse() : variants
  for (const variant of ordered) {
    const started = performance.now()
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (const input of inputs) checksum += variant.engine.toSentenceCase(input, options).length
    }
    variant.trials.push(performance.now() - started)
  }
}
console.log(JSON.stringify({
  inputs: inputs.length,
  iterations,
  checksum,
  variants: variants.map(variant => ({
    label: variant.label,
    wasmBytes: variant.bytes.length,
    gzipBytes: gzipSync(variant.bytes, { level: 9 }).length,
    initializationMedianMs: median(variant.initialization),
    firstSentenceCaseMedianMs: median(variant.firstCalls),
    warmedMedianMs: median(variant.trials),
    warmedTrialsMs: variant.trials,
  })),
}, null, 2))