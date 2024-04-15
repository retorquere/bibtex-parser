#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const os = require('os')
const glob = require('glob').globSync
const tap = require('tap')

const bibtex = require('../index')

function sortObject(obj) {
  if (Array.isArray(obj)) return obj.map(sortObject)
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  const sorted = {}
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = sortObject(obj[k])
  }
  return sorted
}

const config = { ...(require('./runtests.json')), tests: require('./tap.json') }
const unabbreviations = require('../unabbrev.json')
const strings = path.resolve(path.join(__dirname, '..', 'strings.bib'))

if (process.env.CI === 'true') config.tests.toobig = []

let testcases = glob(path.join(__dirname, '**', '*.{json,bib,bibtex,biblatex}'), { nocase: true, matchBase: true, nonull: false, nodir: true }).sort()
const tccount = testcases.length
if (config.n) testcases = testcases.slice(0, config.n)
if (config.only) testcases = testcases.filter(testcase => testcase.toLowerCase().includes(config.only.toLowerCase()))
const ignored = tccount - testcases.length
if (ignored) console.log('ignoring', ignored, 'of', tccount, 'cases')

function parse(bibfile, name, snapshot, options) {
  tap.test(name, async t => {
    const source = fs.readFileSync(bibfile, 'utf-8')

    let result = ''
    try {
      if (options.exception) {
        await bibtex.parseAsync(source, {...options, unsupported: (node, tex, entry) => { result = `unsupported ${node.type} (${tex})\n${entry.input}` } })
      }
      else {
        result = await bibtex.parseAsync(source, options)
      }
    }
    catch (err) {
      result = err.message + '\n' + err.stack
    }
   
    t.snapshotFile = snapshot
    t.matchSnapshot(result)
  })
}

function sentenceCase(input, name, snapshot) {
  const source = fs.readFileSync(input, 'utf-8')
  const data = JSON.parse(source)
  if (!data.items) return

  tap.test(name, async t => {
    const result = data.items.map(item => bibtex.toSentenceCase(item.title, { subSentenceCapitalization: false }))
    t.snapshotFile = snapshot
    t.matchSnapshot(result)
  })
}

for (const bibfile of testcases) {
  const basename = path.basename(bibfile)
  const section = path.basename(path.dirname(bibfile))

  if (basename === 'tap.json') continue

  if (bibfile.endsWith('.json')) {
    sentenceCase(bibfile, `${section}=${basename}`, path.resolve(__dirname, 'tap-snapshots', section, basename + '.snap'))
    continue
  }

  if (!config.big && config.tests.toobig.includes(basename)) continue
  
  const unabbreviate = config.tests.unabbreviate.includes(basename);
  const settings = `sentencecase=${config.sentenceCase}^caseprotection=${config.caseProtection}${config.preserveQuoted ? '^preservequoted' : ''}`;
  
  parse(bibfile, `${section}=${basename}`, path.resolve(__dirname, 'tap-snapshots', settings, section, basename + '.snap'), {
    english: config.sentenceCase.startsWith('on'),
    languageAsLangid: config.tests.language.includes(basename),
    sentenceCase: {
      preserveQuoted: config.preserveQuoted,
      guess: config.sentenceCase.endsWith('guess'),
      subSentence: true,
    },
    caseProtection: config.caseProtection === 'off' ? false : config.caseProtection,
    unabbreviations: unabbreviate && unabbreviations,
    strings: unabbreviate && strings,
    exception: config.tests.exception.includes(basename),
    raw: config.tests.raw.includes(basename),
    // Oh Mendeley....
    verbatimFields: config.tests.mendeley.includes(basename) ? bibtex.fields.verbatim.filter(field => !field.startsWith('file')) : undefined,
  })
}
