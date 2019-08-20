// tslint:disable no-console

const fs = require('fs')
const path = require('path')
require('jest-specific-snapshot')

import * as bibtex from '../index'
import astrocite = require('../astrocite-bibtex')
// import * as jabref from '../jabref'

const snaps = path.join(__dirname, '__snapshots__')

describe('BibTeX Parser', () => {
  /*
  it('should parse sample2', () => {
    expect(parse(fs.readFileSync('sample2.bib', 'utf-8'))).toMatchSnapshot()
  })
  */

  for (const mode of ['export', 'import']) {
    const root = path.join(__dirname, '../../better-bibtex/test/fixtures', mode)
    for (const f of fs.readdirSync(root).sort()) {
      if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue

      if (!process.env.BIG) {
        if (f === 'Async import, large library #720.bib') continue
        if (f === 'Really Big whopping library.bib') continue
        if (process.env.TEST && !f.includes(process.env.TEST)) continue
      }

      const caseName = `${path.basename(f, path.extname(f))}-${mode}`
      it(`should parse ${caseName}`, () => {
        (expect(bibtex.parse(fs.readFileSync(path.join(root, f), 'utf-8'))) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.shot'))
      })
      it(`should parse ${caseName} to an AST`, () => {
        (expect(astrocite.parse(fs.readFileSync(path.join(root, f), 'utf-8'))) as any).toMatchSpecificSnapshot(path.join(snaps, caseName + '.ast.shot'))
      })
    }
  }
})
// const bib = require('./dump/Maintain the JabRef group and subgroup structure when importing a BibTeX db #97-import.json')
// console.log(jabref.parse(bib.comments))
