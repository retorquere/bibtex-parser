// tslint:disable:no-console

import * as csv from 'csv-parse/lib/sync'
import * as fs from 'fs'
import * as path from 'path'
import * as bibtex from '../index'

const unabbrev: Record<string, any> = {}
const strings: Record<string, string> = {}
function parse(list) {
  console.log('parsing', list, '...')
  for (const [journal, abbr] of csv(fs.readFileSync(list, 'utf-8'), { delimiter: ';'})) {
    if (!journal || !abbr) continue
    if (journal.toLowerCase() === abbr.toLowerCase()) continue

    if (abbr.match(/^#.+#$/)) {
      strings[abbr.slice(1, -1)] = journal
    } else {
      unabbrev[abbr] = journal.replace(/\\$/, '') // what?
    }
  }
}

const journals = 'abbrv.jabref.org/journals'
for (const list of fs.readdirSync(journals)) {
  if (list.endsWith('.csv')) parse(path.join(journals, list))
}

parse('jabref/src/main/resources/journals/IEEEJournalListCode.csv')
parse('jabref/src/main/resources/journals/IEEEJournalListText.csv')
parse('jabref/src/main/resources/journals/journalList.csv')

for (const [abbr, full] of Object.entries(unabbrev)) {
  const bib = `@article{key, journal={${full}}}`
  unabbrev[abbr] = bibtex.ast(bib)[0].children[0].fields[0].value
}

fs.writeFileSync('unabbrev.json', JSON.stringify(unabbrev, null, 2))
fs.writeFileSync('strings.json', JSON.stringify(strings, null, 2))
