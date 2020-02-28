// tslint:disable:no-console

import * as csv from 'csv-parse/lib/sync'
import * as fs from 'fs'
import * as path from 'path'
import * as bibtex from '../index'
import { markdown } from 'markdown'

const unabbrev: Record<string, any> = {}
const strings: Record<string, string> = {}
const abbrev: Record<string, Record<string, string>> = {}

const journals = 'abbrv.jabref.org/journals'

const readme = markdown.parse(fs.readFileSync(path.join(journals, 'README.md'), 'utf-8'))
const lists: Record<string, string> = {
  'IEEEJournalListCode.csv': 'IEEEStrings',
  'IEEEJournalListText.csv': 'IEEE',
  'journalList.csv': 'JabRef',
}
function find_links(tree) {
  if (!Array.isArray(tree)) return

  if (tree[0] === 'link') {
    if (tree[1].href.startsWith('journal_abbreviations_')) lists[tree[1].href] = tree[2]
  } else {
    tree.forEach(find_links)
  }
}
find_links(readme)

const obviously_wrong = [
  '20 21',
]
function unjunk(str) {
  // so much junk in there
  str = (str || '').replace(/\s*[\\\/]+$/, '')
  if (str.replace(/[^$]/g, '').length % 2 == 1) return null // *really*?!
  return str.trim()
}
function parse(list, mode = ['abbr', 'unabbr']) {
  console.log('parsing', list, '...')
  for (let [journal, abbr] of csv(fs.readFileSync(list, 'utf-8'), { delimiter: ';'})) {
    journal = unjunk(journal)
    abbr = unjunk(abbr)

    if (!journal || !abbr) continue
    if (journal.toLowerCase() === abbr.toLowerCase()) continue
    if (obviously_wrong.includes(abbr)) continue

    if (abbr.match(/^#.+#$/)) {
      strings[abbr.slice(1, -1)] = journal
    } else {
      if (mode.includes('unabbr')) unabbrev[abbr] = journal

      if (mode.includes('abbr')) {
        const id = lists[path.basename(list)]
        if (!abbrev[id]) abbrev[id] = {}
        abbrev[id][journal] = abbr
      }
    }
  }
}

parse('unabbr-amendments.csv', ['unabbr'])
for (const list of fs.readdirSync(journals)) {
  if (list.endsWith('.csv')) parse(path.join(journals, list))
}

parse('jabref/src/main/resources/journals/IEEEJournalListCode.csv')
parse('jabref/src/main/resources/journals/IEEEJournalListText.csv')
parse('jabref/src/main/resources/journals/journalList.csv')

console.log('AST-ing unabbreviations')
for (const [abbr, full] of Object.entries(unabbrev)) {
  const bib = `@article{key, journal={${full}}}`
  unabbrev[abbr] = bibtex.ast(bib)[0].children[0].fields[0].value
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
