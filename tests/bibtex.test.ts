// tslint:disable no-console

const fs = require('fs')
const path = require('path')
require('jest-specific-snapshot')

import * as bibtex from '../index'
import astrocite = require('../astrocite-bibtex')
// import * as jabref from '../jabref'

const snaps = path.join(__dirname, '__snapshots__')

const enable = {
  ast: process.env.AST !== 'false',
  zotero: process.env.ZOTERO !== 'false',
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
    const caseName = path.basename(f, path.extname(f))
    const input = fs.readFileSync(path.join(root, f), 'utf-8')
    if (enable.ast) {
      it(`should parse ${caseName} to an AST`, () => {
        (expect(astrocite.parse(input)) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.ast.shot'))
      })
    }

    if (enable.zotero) {
      it(`should parse ${caseName}`, () => {
        (expect(bibtex.parse(input)) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.shot'))
      })
    }
  }

  for (const mode of ['export', 'import']) {
    root = path.join(__dirname, 'better-bibtex', mode)
    for (const f of fs.readdirSync(root).sort()) {
      if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue

      if (!process.env.BIG) {
        if (f === 'Async import, large library #720.bib') continue
        if (f === 'Really Big whopping library.bib') continue
        if (process.env.TEST && !f.includes(process.env.TEST)) continue
      }

      const caseName = `${path.basename(f, path.extname(f))}-${mode}`
      const input = fs.readFileSync(path.join(root, f), 'utf-8')

      if (enable.ast) {
        it(`should parse ${caseName} to an AST`, () => {
          (expect(astrocite.parse(input)) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.ast.shot'))
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
