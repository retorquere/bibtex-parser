// tslint:disable no-console

const fs = require('fs')
const path = require('path')
import * as bibtex from './index'
import astrocite = require('./astrocite-bibtex')

function parse(file, basename) {
  console.log(file)
  const input = fs.readFileSync(file, 'utf-8')
  let parsed, dump

  parsed = bibtex.parse(input)
  dump = path.join('dump', basename + '.json')
  fs.writeFileSync(dump, JSON.stringify(parsed, null, 2))

  parsed = astrocite.parse(input)
  dump = path.join('dump', basename + '.ast.json')
  fs.writeFileSync(dump, JSON.stringify(parsed, null, 2))
}

parse('sample2.bib', 'sample2')

const big = (process.argv[2] === '+')
const single = !big && process.argv[2]

for (const mode of ['export', 'import']) {
  const root = `../better-bibtex/test/fixtures/${mode}`

  for (const f of fs.readdirSync(root).sort()) {
    if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue

    if (!big) {
      if (f === 'Async import, large library #720.bib') continue
      if (f === 'Really Big whopping library.bib') continue
      if (single && !f.includes(single)) continue
    }

    parse(`${root}/${f}`, `${path.basename(f, path.extname(f))}-${mode}`)
  }
}

const bib = require('./dump/Maintain the JabRef group and subgroup structure when importing a BibTeX db #97-import.json')
import * as jabref from './jabref'
console.log(jabref.parse(bib.comments))
