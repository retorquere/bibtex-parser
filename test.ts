// tslint:disable no-console

const fs = require('fs')
const path = require('path')
import * as bibtex from './index'

const markup = {
  enquote: { open: '"', close: '"' },
  sub: { open: '<sub>', close: '</sub>' },
  sup: { open: '<sup>', close: '</sup>' },
  bold: { open: '<b>', close: '</b>' },
  italics: { open: '<i>', close: '</i>' },
  smallCaps: { open: '<span style="font-variant:small-caps;">', close: '</span>' },
  caseProtectCreator: { open: '"', close: '"' },
  caseProtect: { open: '<span class="nocase">', close: '</span>' },
}

function parse(file) {
  console.log(file)
  const input = fs.readFileSync(file, 'utf-8')
  const parsed = bibtex.parse(input, markup)
  const dump = path.join('dump', path.basename(file, path.extname(file)) + '.json')
  fs.writeFileSync(dump, JSON.stringify(parsed, null, 2))
}

parse('sample2.bib')

for (const mode of ['import', 'export']) {
  const root = `../better-bibtex/test/fixtures/${mode}`

  for (const f of fs.readdirSync(root).sort()) {
    // if (f === 'Async import, large library #720.bib') continue
    // if (f === 'Really Big whopping library.bib') continue

    if (f.replace(/(la)?tex$/, '').endsWith('.bib')) {
      parse(`${root}/${f}`)
    }
  }
}

const bib = require('./dump/Maintain the JabRef group and subgroup structure when importing a BibTeX db #97.json')
import * as jabref from './jabref'
console.log(jabref.parse(bib.comments))
