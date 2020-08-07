// tslint:disable:no-console

import * as csv from 'csv-parse/lib/sync'
import * as fs from 'fs'
import * as path from 'path'
import * as bibtex from '../index'
import { markdown } from 'markdown'

const unabbrev: Record<string, { ast: any, text: string}> = {}
const strings: Record<string, any> = {}
const abbrev: Record<string, Record<string, string>> = {}

const journals = 'abbrv.jabref.org/journals'

const readme = markdown.parse(fs.readFileSync(path.join(journals, 'README.md'), 'utf-8'))
const titles: Record<string, string> = {
  'journalList.csv': 'JabRef',
}
function find_links(tree) {
  if (!Array.isArray(tree)) return

  if (tree[0] === 'link') {
    if (tree[1].href.startsWith('journal_abbreviations_')) titles[tree[1].href] = tree[2]
  } else {
    tree.forEach(find_links)
  }
}
find_links(readme)

const obviously_wrong = {
  abbr: ['20 21', 'Journal'],
  full: ['IEEE Expert (through 1997)', 'The Journal'],
}
function unjunk(str) {
  // so much junk in there
  str = (str || '').replace(/\s*[\\\/]+$/, '') // trailing slashes
  if (str.replace(/[^$]/g, '').length % 2 == 1) return null // unbalanced math
  if (str.match(/^".*"$/)) str = str.slice(1, -1)
  return str.trim()
}
function parse(list) {
  console.log('parsing', list, '...')
  if (!fs.existsSync(list)) {
    console.log('!!!', list, 'IS GONE!!!')
    return
  }
  for (const row of csv(fs.readFileSync(list, 'utf-8'), { delimiter: ';', relax_column_count: true })) {
    let [journal, abbr] = row.slice(0, 2)
    journal = unjunk(journal)
    abbr = unjunk(abbr)

    if (!abbr) continue
    if (!journal) journal = ''
    if (journal.toLowerCase() === abbr.toLowerCase()) journal = ''
    if (obviously_wrong.abbr.includes(abbr)) continue
    if (obviously_wrong.full.includes(journal)) continue

    if (abbr.match(/^#.+#$/)) {
      strings[abbr.slice(1, -1)] = [{ kind: 'Text', value: journal, mode: 'text' }]
    } else if (!journal) {
      delete unabbrev[abbr]

    } else {
      unabbrev[abbr] = { text: journal, ast: null }

      if (list === 'unabbr-amendments.csv') {
        if (abbr.includes('. ')) unabbrev[abbr.replace(/\. /g, ' ').replace(/\.$/, '')] = { text: journal, ast: null }
      } else {
        const id = titles[path.basename(list)]
        if (!abbrev[id]) abbrev[id] = {}
        abbrev[id][journal] = abbr
      }
    }
  }
}

for (const list of require('./load-order.json')) {
  parse(list)
}

console.log('AST-ing unabbreviations')
for (const [abbr, full] of Object.entries(unabbrev)) {
  const bib = `@article{key, journal={${full.text}}}`
  unabbrev[abbr].ast = bibtex.ast(bib)[0].children[0].fields[0].value

  if (unabbrev[abbr].ast.length !== 1 || unabbrev[abbr].ast[0].kind !== 'Text') unabbrev[abbr].text = ''
}

for (const [list, mapping] of Object.entries(abbrev)) {
  console.log('Scrubbing TeX from abbreviation mapping', list)
  for (const full of Object.keys(mapping)) {
    // const bib = `@article{key, abbr={${abbr}},full={${full}}}`
    const bib = `@article{key, full={${full}}}`
    for (const field of bibtex.ast(bib)[0].children[0].fields) {
      // has TeX, don't bother
      if (field.value.length !== 1 || field.value[0].kind !== 'Text') {
        delete mapping[full]
        break
      }
    }
  }
}

fs.writeFileSync('unabbrev.json', JSON.stringify(unabbrev, null, 2))
fs.writeFileSync('strings.json', JSON.stringify(strings, null, 2))
fs.writeFileSync('abbrev.json', JSON.stringify(abbrev, null, 2))
