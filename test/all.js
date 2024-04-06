#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const os = require('os')
const glob = require('glob').globSync
const tap = require('tap')

const bibtex = require('../index')

function tryparse({ bibfile, options }) {
  const source = fs.readFileSync(bibfile, 'utf-8')

  if (bibfile.endsWith('.json')) {
    const data = JSON.parse(source)
    return data.items.map(item => bibtex.toSentenceCase(item.title, { subSentenceCapitalization: false }))
  }

  let result = ''
  try {
    if (options.exception) {
      bibtex.parse(source, {...options, unsupported: (node, tex, entry) => { result = `unsupported ${node.type} (${tex})\n${entry.input}` } })
    }
    else {
      result = bibtex.parse(source, options)
    }
  }
  catch (err) {
    result = err.message + '\n' + err.stack
  }
  return result
}

function sortObject(obj) {
  if (Array.isArray(obj)) return obj.map(sortObject)
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  const sorted = {}
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = sortObject(obj[k])
  }
  return sorted
}

function normalize(result) {
  if (!Array.isArray(result.entries)) return result
  result.entries = JSON.parse(JSON.stringify(result.entries), (key, value) => typeof value === 'string' ? value.normalize('NFC') : value)

  if (result.preamble) result.preamble = []

  // temporary workarounds to match old return format
  for (const entry of result.entries) {
    // if (entry.fields.note) entry.fields.note = entry.fields.note.replace(/[\r\n]/g, '')
    delete entry.input
    for (let [field, value] of Object.entries(entry.fields)) {
      if (!Array.isArray(entry.fields[field])) entry.fields[field] = [ value ]

      switch (field) {
        case 'author':
          for (const cr of value) {
            for (const n of ['name', 'firstName', 'lastName']) {
              if (cr[n]) cr[n] = cr[n].replace(/\u00A0/g, ' ')
            }
            if (cr.name) {
              cr.literal = cr.name
              delete cr.name
            }
          }
          break

        case 'location':
        case 'publisher':
          entry.fields[field] = [ entry.fields[field].join(' and ') ]
          break
        default:
          entry.fields[field] = entry.fields[field].map(v => typeof v === 'number' ? `${v}` : v)
          break
      }
    }
  }
  result.entries = sortObject(result.entries)

  result.errors = [...new Set(result.errors.map(err => err.error ))].sort()

  return result
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
        bibtex.parse(source, {...options, unsupported: (node, tex, entry) => { result = `unsupported ${node.type} (${tex})\n${entry.input}` } })
      }
      else {
        result = bibtex.parse(source, options)
      }
    }
    catch (err) {
      result = err.message + '\n' + err.stack
    }
   
    if (typeof result !== 'string' && !config.tests.error.includes(path.basename(bibfile))) {
      for (const err of result.errors) {
        if (err.error.match(/Unresolved @string|unexpected \d+-part name/)) continue
        throw JSON.stringify(result.errors[0], null, 2)
      }
    }
    t.snapshotFile = snapshot
    t.matchSnapshot(normalize(result))
  })
}

function sentenceCase(input, name, snapshot) {
  tap.test(name, async t => {
    const source = fs.readFileSync(input, 'utf-8')
    const data = JSON.parse(source)
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
    caseProtection: config.caseProtection === 'off' ? false : config.caseProtection,
    sentenceCase: {
      langids: config.sentenceCase.startsWith('on'),
      language: config.tests.language.includes(basename),
      preserveQuoted: config.preserveQuoted,
      guess: config.sentenceCase.endsWith('guess'),
      subSentence: true,
    },
    unabbreviations: unabbreviate && unabbreviations,
    strings: unabbreviate && strings,
    exception: config.tests.exception.includes(basename),
    raw: config.tests.raw.includes(basename),
    // Oh Mendeley....
    verbatimFields: config.tests.mendeley.includes(basename) ? bibtex.fields.verbatim.filter(field => !field.startsWith('file')) : undefined,
  })
}
