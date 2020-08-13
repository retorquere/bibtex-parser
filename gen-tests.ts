// tslint:disable no-console

import slugify from 'slugify'
import * as bibtex from './index'
import mkdirp = require('mkdirp')

// off, on, on+guess
process.env.SENTENCECASE = process.env.SENTENCECASE || 'on+guess'
if (! ['on+guess', 'on', 'off'].includes(process.env.SENTENCECASE)) throw new Error(`SENTENCECASE=${process.env.SENTENCECASE}`)

// off, strict, as-needed
process.env.CASEPROTECTION = process.env.CASEPROTECTION || 'as-needed'
if (! [ 'as-needed', 'strict', 'off' ].includes(process.env.CASEPROTECTION)) throw new Error(`CASEPROTECTION=${process.env.CASEPROTECTION}`)

process.env.UNABBREVIATE = process.env.UNABBREVIATE || 'off'
if (! [ 'on', 'off' ].includes(process.env.UNABBREVIATE)) throw new Error(`UNABBREVIATE=${process.env.UNABBREVIATE}`)

const fs = require('fs')
const path = require('path')

const snaps = path.join(__dirname, '__tests__', '__snapshots__')

const enable = {
  case: (process.env.TESTCASE || '').toLowerCase(),
  big: (process.env.BIG || process.env.CI) === 'true',
}
const big = [
  'Async import, large library #720.bib',
  'Really Big whopping library.bibtex',
  'long.bib',
  'Cache does not seem to fill #1296.bibtex',
  'Unabbreviate on import #1436-2.bib',
  'Unabbreviate on import #1436-3.bib',
]

function parseOptions(f) {
  const opts: bibtex.ParserOptions = {}

  switch (process.env.CASEPROTECTION) {
    case 'off':
      opts.caseProtection = false
      break

    case 'strict':
    case 'as-needed':
      opts.caseProtection = process.env.CASEPROTECTION
      break

    default:
      throw new Error(`CASEPROTECTION=${process.env.CASEPROTECTION}`)
  }
  opts.guessAlreadySentenceCased = process.env.SENTENCECASE.endsWith('guess')
  opts.sentenceCase = process.env.SENTENCECASE.startsWith('on')

  if (f.includes('/Async') || f.startsWith('Async')) { // Oh Mendeley....
    opts.verbatimFields = [ 'doi', 'eprint', 'verba', 'verbb', 'verbc' ]
  }

  if (f.includes('-raw.bib')) opts.raw = true

  return opts
}

const scripts = path.join(__dirname, '__tests__', 'cases')
mkdirp.sync(scripts)
for (const f of fs.readdirSync(scripts)) {
  fs.unlinkSync(path.join(scripts, f))
}

const mode = `sentencecase=${process.env.SENTENCECASE}+caseprotection=${process.env.CASEPROTECTION}`

let root = path.join(__dirname, '__tests__', 'other')
const cases: { caseName: string, input: string, options: bibtex.ParserOptions, size: number, snapshot: string, script: string, ignoreErrors?: boolean }[] = []

for (const f of fs.readdirSync(root)) {
  if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue
  if (enable.case && !f.toLowerCase().includes(enable.case)) continue
  if (!enable.big && big.includes(f)) continue

  const caseName = `${path.basename(f, path.extname(f))}-${mode}${path.extname(f)}`
  cases.push({
    caseName,
    script: path.join(scripts, slugify(caseName) + '.js'),
    input: path.join(root, f),
    size: fs.statSync(path.join(root, f)).size,
    options: parseOptions(f),
    snapshot: path.join(snaps, caseName + '.shot'),
    ignoreErrors: f.endsWith('/long.bib') || f === 'long.bib',
  })
}

for (const section of ['export', 'import', 'merge']) {
  root = path.join(__dirname, '__tests__', 'better-bibtex', section)
  for (const f of fs.readdirSync(root)) {
    if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue
    if (enable.case && !f.toLowerCase().includes(enable.case)) continue
    if (!enable.big && big.includes(f)) continue

    const caseName = `bbt-${section}-${path.basename(f, path.extname(f))}-${mode}${path.extname(f)}`
    cases.push({
      caseName,
      script: path.join(scripts, slugify(caseName) + '.js'),
      input: path.join(root, f),
      size: fs.statSync(path.join(root, f)).size,
      options: parseOptions(f),
      snapshot: path.join(snaps, caseName + '.shot'),
    })
  }
}

cases.sort((a, b) => {
  if (a.size === b.size || process.env.CI) return a.caseName.localeCompare(b.caseName)
  return a.size - b.size
})

fs.writeFileSync(path.join(scripts, 'order.json'), JSON.stringify(cases.map(c => c.script), null, 2), 'utf-8')

const unabbr = JSON.stringify(JSON.stringify(require(path.join(__dirname, 'unabbrev.json'))))

for (const {caseName, input, options, snapshot, script, ignoreErrors} of cases) {
  let js = `
  const fs = require('fs');
  const bibtex = require('../../index');
  require('jest-specific-snapshot');
  const caseName = ${JSON.stringify(caseName)};
  const input = fs.readFileSync(${JSON.stringify(input)}, 'utf-8');
  const options = ${JSON.stringify(options)};
  const snapshot = ${JSON.stringify(snapshot)};
  const ignoreErrors = ${JSON.stringify(ignoreErrors)};
  `

  if (process.env.UNABBREVIATE === 'on' || caseName.toLowerCase().includes('unabbre') || caseName.includes('873')) {
    js += `
    options.unabbreviate = JSON.parse(${unabbr})
    `
  }

  js += `
  if (ignoreErrors) {
    options.errorHandler = function ignoreErrors(e) {
      if (e.name === 'TeXError') return // ignore TeX
      throw e
    }
  }

  it(caseName, () => {
    const bib = bibtex.parse(input, options)
    bib.groups = bibtex.jabref(bib.comments)
    expect(bib).toMatchSpecificSnapshot(snapshot);
  })
  `
  fs.writeFileSync(script, js, 'utf-8')
}
