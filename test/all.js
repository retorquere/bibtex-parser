#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const os = require('os')
const glob = require('glob').globSync
const tap = require('tap')

const bibtex = require('../unified')

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

const prefix = 'npm_config_'
const valid = {
  sentence_case: [
    'on+guess',
    'on',
    'off',
  ],
  case_protection: [
    'as-needed',
    'off',
    'strict',
  ],
  preserve_quoted: [
    'true',
    'false',
  ],
}
const multi = ['test']

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

const config = Object.assign({
  all: '',
  sentence_case: valid.sentence_case.slice(0, 1),
  case_protection: valid.case_protection.slice(0, 1),
  preserve_quoted: valid.preserve_quoted.slice(0, 1),
  test: [''],
  snapshot: '',
  unabbreviations: path.resolve(path.join(__dirname, '..', 'unabbrev.json')),
  strings: path.resolve(path.join(__dirname, '..', 'strings.bib')),
}, require('./tap.json'))
if (process.env.CI === 'true') config.toobig = []

for (let [option, value] of Object.entries(process.env)) {
  if (!option.startsWith(prefix)) continue

  option = option.substr(prefix.length)

  let err
  if (valid[option] || multi.includes(option)) {
    value = value.split('\n\n')
    if (valid[option] && (err = value.find(v => !valid[option].includes(v)))) {
      throw new Error(`Invalid value ${JSON.stringify(err)} for ${option}`)
    }
  }
  else if (typeof config[option] === 'undefined') {
    continue
  }
  else if (option === 'big' || option === 'exception') {
    value = []
  }
  config[option] = value
}

if (config.snapshot || (config.all === 'true')) { // reset to all for snapshots
  for (const [key, value] of Object.entries(valid)) {
    if (!process.env[prefix + key]) config[key] = value
  }
  config.toobig = []
}
if (config.test.length !== 1 || config.test[0] !== '') config.toobig=[] // if you pick out a test, you want it ran

if (config.snapshot) process.env.TAP_SNAPSHOT = '1'
if (process.env.TAP_SNAPSHOT === '1') config.snapshot = 'true'

// if (require.main === module) console.log(config)

let testcases = []
for (const pattern of config.test) {
  testcases = testcases.concat(glob(path.join(__dirname, '**', (pattern ? '*' : '') + pattern + '*.{json,bib,bibtex,biblatex}'), { nocase: true, matchBase: true, nonull: false, nodir: true }))
  testcases.sort()
  testcases = testcases.slice(0, 270) // limit
  // testcases = testcases.filter(testcase => testcase.match(/Endnote/))
}

for (const bibfile of testcases) {
  const basename = path.basename(bibfile)
  const section = path.basename(path.dirname(bibfile))

  if (basename === 'tap.json') continue

  if (bibfile.endsWith('.json')) {
    ((bibfile, options, name, snapshot) => {
      tap.test(name, async t => {
        const result = tryparse({ bibfile, options })
        t.snapshotFile = snapshot
        t.matchSnapshot(normalize(result))
      })
    })(
      bibfile,
      {},
      `${section}=${basename}`,
      path.resolve(__dirname, 'tap-snapshots', section, basename + '.snap')
    )
    continue
  }

  for (const sentence_case of config.sentence_case) {
    for (const case_protection of config.case_protection) {
      for (const preserve_quoted of config.preserve_quoted) {
        if (config.toobig.includes(basename)) continue
  
        const unabbreviate = config.unabbreviate.includes(basename);
        const settings = `sentencecase=${sentence_case}^caseprotection=${case_protection}${preserve_quoted === 'true' ? '^preservequoted' : ''}`;
  
        ; ((bibfile, options, name, snapshot) => {
          tap.test(name, async t => {
            const result = tryparse({ bibfile, options })
            if (typeof result !== 'string' && result.errors.length && !config.error.includes(path.basename(bibfile))) throw JSON.stringify(result.errors[0], null, 2)
            t.snapshotFile = snapshot
            t.matchSnapshot(normalize(result))
          })
        })(
          bibfile,
          {
            caseProtection: case_protection === 'off' ? false : case_protection,
            sentenceCase: {
              langids: sentence_case.startsWith('on'),
              preserveQuoted: preserve_quoted === 'true',
              guess: sentence_case.endsWith('guess'),
              subSentence: true,
            },
            unabbreviations: unabbreviate && config.unabbreviations,
            strings: unabbreviate && config.strings,
            exception: config.exception.includes(basename),
            raw: config.raw.includes(basename),
            // Oh Mendeley....
            verbatimFields: config.mendeley.includes(basename) ? bibtex.fields.verbatim.filter(field => !field.startsWith('file')) : undefined
          },
          `${section}=${basename}`,
          path.resolve(__dirname, 'tap-snapshots', settings, section, basename + '.snap')
        )
      }
    }
  }
}
