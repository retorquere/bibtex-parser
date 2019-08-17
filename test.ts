// tslint:disable no-console

const fs = require('fs')
const path = require('path')
import * as bibtex from './index'

function parse(file) {
  console.log(file)
  const input = fs.readFileSync(file, 'utf-8')
  const parsed = bibtex.parse(input)
  fs.writeFileSync(path.join('dump', + path.basename(file, path.extname(file)) + '.json'), JSON.stringify(parsed, null, 2))
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
