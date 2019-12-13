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
  ast: (process.env.AST || process.env.CI) === 'true',
  zotero: process.env.ZOTERO !== 'false',
  case: (process.env.TESTCASE || '').toLowerCase(),
  big: (process.env.BIG || process.env.CI) === 'true',
}
const big = [
  'Async import, large library #720',
  'Really Big whopping library',
]

const ignoreErrors = {
  errorHandler(e) {
    if (e.name === 'TeXError') return // ignore TeX
    throw e
  }
}

describe('BibTeX Parser', () => {
  /*
  it('should parse sample2', () => {
    expect(parse(fs.readFileSync('sample2.bib', 'utf-8'))).toMatchSnapshot()
  })
  */

  let root = path.join(__dirname, 'cases')
  for (const f of fs.readdirSync(root).sort()) {
    if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue
    if (enable.case && !f.toLowerCase().includes(enable.case)) continue

    const caseName = path.basename(f)

    const input = fs.readFileSync(path.join(root, f), 'utf-8')
    if (enable.ast) {
      it(`should parse ${caseName} to an AST`, () => {
        (expect(bibtex.ast(input, f === 'long.bib' ? ignoreErrors : {})) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.ast.shot'))
      })
    }

    if (enable.zotero) {
      it(`should parse ${caseName}`, () => {
        (expect(bibtex.parse(input, f === 'long.bib' ? ignoreErrors : {})) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.shot'))
      })
    }
  }

  for (const mode of ['export', 'import']) {
    root = path.join(__dirname, 'better-bibtex', mode)
    for (const f of fs.readdirSync(root).sort()) {
      if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue

      if (!enable.big && big.find(s => f.includes(s))) continue

      if (enable.case && !f.toLowerCase().includes(enable.case)) continue

      const caseName = `bbt-${mode}-${path.basename(f)}`

      const input = fs.readFileSync(path.join(root, f), 'utf-8')

      if (enable.ast) {
        it(`should parse ${caseName} to an AST`, () => {
          (expect(bibtex.ast(input)) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.ast.shot'))
        })
      }

      if (enable.zotero) {
        it(`should parse ${caseName}`, () => {
          (expect(bibtex.parse(input)) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.shot'))
        })
      }
    }
  }
})
// const bib = require('./dump/Maintain the JabRef group and subgroup structure when importing a BibTeX db #97-import.json')
// console.log(jabref.parse(bib.comments))
