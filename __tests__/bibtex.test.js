const bibtex = require('../index')

const fs = require('fs')
const path = require('path')
require('jest-specific-snapshot')

const options = {
  sentencecase: ['on+guess', 'on', 'off'].find(mode => (process.env.SENTENCECASE || 'on+guess') === mode),
  caseprotection: [ 'as-needed', 'strict', 'off' ].find(mode => (process.env.CASEPROTECTION || 'as-needed') === mode),
  testcase: (process.env.TESTCASE || '').toLowerCase(),
  big: (process.env.BIG || process.env.CI) === 'true',
  unabbreviate: process.env.UNABBREVIATE === 'on'
}
if (!options.sentencecase) throw new Error(`'${process.env.SENTENCECASE}' is not a valid SENTENCECASE option`)
if (!options.caseprotection) throw new Error(`'${process.env.CASEPROTECTION}' is not a valid CASEPROTECTION option`)

const cases = []
const tests = ['export', 'import', 'merge'].map(p => path.join(__dirname, 'better-bibtex', p)).concat(path.join(__dirname, 'other'))

for (const root of tests) {
  for (const f of fs.readdirSync(root)) {
    if (!f.replace(/(la)?tex$/, '').endsWith('.bib')) continue
    if (options.testcase && !f.toLowerCase().includes(options.testcase)) continue
    if (!options.big && fs.statSync(path.join(root, f)).size > 5000000) continue

    cases.push({
      name: `${path.basename(root)} ${path.basename(f)}`,
      input: path.join(root, f),
    })
  }
}

const snaps = path.join(__dirname, '__snapshots__')
for (const testcase of cases) {
  it(testcase.name, async () => {
    const unabbreviate = options.unabbreviate || testcase.name.toLowerCase().includes('unabbre') || testcase.name.includes('873')
    const opts = {
      caseProtection: options.caseprotection === 'off' ? false : options.caseprotection,
      guessAlreadySentenceCased: options.sentencecase.endsWith('guess'),
      sentenceCase: options.sentencecase.startsWith('on'),
      // Oh Mendeley....
      verbatimFields: path.basename(testcase.input) === 'Async import, large library #720.bib' ? [ 'doi', 'eprint', 'verba', 'verbb', 'verbc' ] : undefined,
      raw: testcase.input.endsWith('-raw.bib'),
      unabbreviate: unabbreviate ? JSON.parse(JSON.stringify(require(path.join(__dirname, '..', 'unabbrev.json')))) : undefined,
      errorHandler: path.basename(testcase.input) !== 'long.bib' ? undefined : function ignoreErrors(e) { if (e.name !== 'TeXError') throw e },
    }

    const snapdir = `sentencecase=${options.sentencecase}, caseprotection=${options.caseprotection}`
    expect(await bibtex.parseAsync(fs.readFileSync(testcase.input, 'utf-8'), opts)).toMatchSpecificSnapshot(path.join(snaps, snapdir, testcase.name + '.shot'));
  })
}
