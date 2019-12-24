// tslint:disable no-console

import * as failFast from '@retorquere/jasmine-fail-fast'
if (JSON.parse(process.env.npm_config_argv).original.includes('--bail')) {
  const jasmineEnv = (jasmine as any).getEnv()
  jasmineEnv.addReporter(failFast.init())
}

// off, on, on+guess
process.env.SENTENCECASE = process.env.SENTENCECASE || 'on+guess'
if (! ['on+guess', 'on', 'off'].includes(process.env.SENTENCECASE)) throw new Error(`SENTENCECASE=${process.env.SENTENCECASE}`)

// off, strict, as-needed
process.env.CASEPROTECTION = process.env.CASEPROTECTION || 'as-needed'
if (! [ 'as-needed', 'strict', 'off' ].includes(process.env.CASEPROTECTION)) throw new Error(`CASEPROTECTION=${process.env.CASEPROTECTION}`)

const fs = require('fs')
const path = require('path')
require('jest-specific-snapshot')

import * as bibtex from '../index'
const snaps = path.join(__dirname, '__snapshots__')

const enable = {
  case: (process.env.TESTCASE || '').toLowerCase(),
  big: (process.env.BIG || process.env.CI) === 'true',
}
const big = [
  'Async import, large library #720',
  'Really Big whopping library',
]

function ignoreErrors(e) {
  if (e.name === 'TeXError') return // ignore TeX
  throw e
}

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

  if (f.endsWith('/long.bib') || f === 'long.bib') opts.errorHandler = ignoreErrors
  if (f.includes('/Async') || f.startsWith('Async')) { // Oh Mendeley....
    opts.verbatimFields = [ 'doi', 'eprint', 'verba', 'verbb', 'verbc' ]
  }

  return opts
}

const mode = `sentencecase=${process.env.SENTENCECASE}+caseprotection=${process.env.CASEPROTECTION}`

let root = path.join(__dirname, 'other')
const cases: { caseName: string, input: string, options: bibtex.ParserOptions }[] = []

for (const f of fs.readdirSync(root)) {
  if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue
  if (enable.case && !f.toLowerCase().includes(enable.case)) continue

  const caseName = `${path.basename(f, path.extname(f))}-${mode}${path.extname(f)}`
  cases.push({
    caseName,
    input: fs.readFileSync(path.join(root, f), 'utf-8'),
    options: parseOptions(f),
  })
}

for (const section of ['export', 'import']) {
  root = path.join(__dirname, 'better-bibtex', section)
  for (const f of fs.readdirSync(root)) {
    if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue

    if (!enable.big && big.find(s => f.includes(s))) continue

    if (enable.case && !f.toLowerCase().includes(enable.case)) continue

    const caseName = `bbt-${section}-${path.basename(f, path.extname(f))}-${mode}${path.extname(f)}`
    cases.push({
      caseName,
      input: fs.readFileSync(path.join(root, f), 'utf-8'),
      options: parseOptions(f),
    })
  }
}

cases.sort(function(a, b) {
  if (a.input.length === b.input.length || process.env.CI) return a.caseName.localeCompare(b.caseName)
  return a.input.length - b.input.length
})

for (let {caseName, input, options} of cases) {
  it(`should parse ${caseName}`, () => {
    (expect(bibtex.parse(input, options)) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.shot'))
  })
}
