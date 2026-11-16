import Benchmark from 'benchmark'
import { randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'glob'
import * as yaml from 'js-yaml'
import { English as jsEnglish, parse as parseJs } from '../dist/esm/index.js'
import { english as rustEnglish, initSync, parse as parseRust } from '../pkg/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const testConfig = yaml.load(fs.readFileSync(path.join(here, 'config.yaml'), 'utf8'))
const ignored = new Set((testConfig.ignore?.js ?? []).map(filename => path.resolve(here, filename)))
const candidates = globSync(path.resolve(here, '**/*.{bib,bibtex,biblatex}'), {
  ignore: [...ignored],
  nocase: true,
  nodir: true,
}).filter(filename => !ignored.has(path.resolve(filename)))

if (candidates.length < 10) throw new Error(`Expected at least 10 JS-eligible fixtures; found ${candidates.length}`)

/** Choose distinct fixture paths uniformly without replacement. */
function sampleFixtures(files, count) {
  const shuffled = [...files]
  for (let index = 0; index < count; index++) {
    const selected = randomInt(index, shuffled.length)
    ;[shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]]
  }
  return shuffled.slice(0, count).map(filename => ({
    name: path.relative(root, filename),
    source: fs.readFileSync(filename, 'utf8'),
  }))
}

/** Pick one value uniformly from a benchmark setting's supported choices. */
function choose(values) {
  return values[randomInt(values.length)]
}

const fixtures = sampleFixtures(candidates, 10)
const settings = {
  sentenceCase: choose(['off', 'on', 'on+guess']),
  caseProtection: choose(['as-needed', 'off', 'strict']),
  preserveQuoted: choose([true, false]),
}
const sentenceCase = {
  guess: settings.sentenceCase === 'on+guess',
  subSentence: true,
  preserveQuoted: settings.preserveQuoted,
}
const jsOptions = {
  english: settings.sentenceCase === 'off' ? [] : [...jsEnglish],
  sentenceCase,
  caseProtection: settings.caseProtection === 'off' ? false : settings.caseProtection,
}
const rustOptions = {
  english: settings.sentenceCase === 'off' ? [] : [...rustEnglish],
  sentenceCase,
  caseProtection: settings.caseProtection,
}

initSync({ module: fs.readFileSync(path.join(root, 'pkg/bibtex_parser_bg.wasm')) })

console.log(`Fixtures: ${fixtures.length} randomly selected (excluding test/config.yaml ignore.js)`)
for (const fixture of fixtures) console.log(`  ${fixture.name}`)
console.log(`Settings: ${JSON.stringify(settings)}`)

function runJs() {
  for (const fixture of fixtures) {
    parseJs(fixture.source, jsOptions)
  }
}
function runRust() {
  for (const fixture of fixtures) {
    parseRust(fixture.source, rustOptions)
  }
}

runJs()
runRust()

const maxTime = Number(process.env.PARSER_BENCH_MAX_TIME ?? 2)
if (!Number.isFinite(maxTime) || maxTime <= 0) {
  throw new Error('PARSER_BENCH_MAX_TIME must be a positive number of seconds')
}

const suite = new Benchmark.Suite()
suite
  .add('JavaScript', runJs, { maxTime })
  .add('Rust WASM', runRust, { maxTime })
  .on('cycle', event => console.log(String(event.target)))
  .on('complete', function() {
    const js = this[0]
    const rust = this[1]
    console.log(`Rust/JS throughput: ${(rust.hz / js.hz).toFixed(2)}x (operations parse all 10 fixtures)`)
  })
  .run()