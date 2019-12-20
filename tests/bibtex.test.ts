// tslint:disable no-console

import * as failFast from '@retorquere/jasmine-fail-fast'
if (JSON.parse(process.env.npm_config_argv).original.includes('--bail')) {
  const jasmineEnv = (jasmine as any).getEnv()
  jasmineEnv.addReporter(failFast.init())
}

const fs = require('fs')
const path = require('path')
require('jest-specific-snapshot')

import * as bibtex from '../index'
const snaps = path.join(__dirname, '__snapshots__')

const enable = {
  zotero: process.env.ZOTERO !== 'false',
  case: (process.env.TESTCASE || '').toLowerCase(),
  big: (process.env.BIG || process.env.CI) === 'true',
  strict: !!process.env.STRICT
}
const big = [
  'Async import, large library #720',
  'Really Big whopping library',
]

const ignoreErrors = {
  errorHandler(e) {
    return
    // if (e.name === 'TeXError') return // ignore TeX
    // throw e
  }
}

describe('BibTeX Parser', () => {
  let root = path.join(__dirname, 'cases')
  const cases: { caseName: string, input: string, options: any }[] = []

  for (const f of fs.readdirSync(root)) {
    if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue
    if (enable.case && !f.toLowerCase().includes(enable.case)) continue

    const options = f.endsWith('/long.bib') || f === 'long.bib' ? ignoreErrors : { strictNoCase: enable.strict }
    cases.push({
      caseName: path.basename(f),
      input: fs.readFileSync(path.join(root, f), 'utf-8'),
      options,
    })
  }

  for (const mode of ['export', 'import']) {
    root = path.join(__dirname, 'better-bibtex', mode)
    for (const f of fs.readdirSync(root)) {
      if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue

      if (!enable.big && big.find(s => f.includes(s))) continue

      if (enable.case && !f.toLowerCase().includes(enable.case)) continue

      const options = f.endsWith('/long.bib') || f === 'long.bib' ? ignoreErrors : { strictNoCase: enable.strict }
      cases.push({
        caseName: `bbt-${mode}-${path.basename(f)}`,
        input: fs.readFileSync(path.join(root, f), 'utf-8'),
        options,
      })
    }
  }

  cases.sort(function(a, b) {
    if (a.input.length === b.input.length) return a.caseName.localeCompare(b.caseName)
    return a.input.length - b.input.length
  })

  for (let {caseName, input, options} of cases) {
    if (enable.zotero) {
      it(`should parse ${caseName}`, () => {
        (expect(bibtex.parse(input, options)) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.shot'))
      })
    }
  }
})
