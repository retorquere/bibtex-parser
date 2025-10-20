#!/usr/bin/env node

import minimist from 'minimist'
import { globSync } from 'glob'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import * as yaml from 'js-yaml'

import * as bibtex from '../dist/esm/index.js'

const here = path.dirname(new URL(import.meta.url).pathname)
const saved = path.resolve(here, 'run.yaml')

function load(filename) {
  const data = fs.readFileSync(filename, 'utf-8')
  switch (path.extname(filename)) {
    case '.yml':
    case '.yaml':
      return yaml.load(data)
    case '.json':
      return JSON.parse(data)
    default:
      throw new Error(`Unsupported data file ${JSON.stringify(filename)}`)
  }
}

const config = {
  sentenceCase: 'on+guess',
  caseProtection: 'as-needed',
  preserveQuoted: true,
  big: true,
  ...(fs.existsSync(saved) ? load(saved) : {}),
}

function verify(v, options) {
  if (options.includes(v)) return v
  throw new Error(`${v} must be one of ${options}`)
}

const args = minimist(process.argv.slice(2))
for (const [k, v] of Object.entries(args)) {
  switch (k) {
    case '_':
      config.only = config.only || []
      config.only = [...config.only, ...v]
      break

    case 's':
    case 'sc':
    case 'sentencecase':
      config.sentenceCase = verify(v, ['off', 'on+guess', 'on'])
      break

    case 'c':
    case 'cp':
    case 'caseprotection':
      config.caseProtection = verify(v, ['as-needed', 'off', 'strict'])
      break

    case 'P':
    case 'pq':
    case 'preservequoted':
      config.preserveQuoted = true
      break

    case 'p':
    case 'no-pq':
    case 'no-preservequoted':
      config.preserveQuoted = false
      break

    case 'b':
    case 'no-big':
      config.big = false
      break

    case 'B':
    case 'big':
      config.big = true
      break

    case 'save':
    case 'snap':
      break

    default:
      throw new Error(`Unexpected option ${k}`)
  }
}
if (config.only && !config.only.length) delete config.only
if (args.save) fs.writeFileSync(saved, yaml.dump(config))
console.log('running', config)

config.tests = load(path.resolve(here, 'config.yaml'))

const unabbreviations = load(path.resolve(here, '..', 'unabbrev.json'))
const strings = path.resolve(here, '..', 'strings.bib')

if (process.env.CI === 'true') config.tests.toobig = []

const testcases = globSync(path.resolve(here, '**', '*.{json,bib,bibtex,biblatex}'), {
  nocase: true,
  matchBase: true,
  nonull: false,
  nodir: true,
}).sort()

function stringify(obj) {
  return yaml.dump(obj, { sortKeys: true })
}

function matchSnapshot(actual, snapshot) {
  if (!fs.existsSync(snapshot)) {
    if (args.snap) {
      fs.mkdirSync(path.dirname(snapshot), { recursive: true })
      fs.writeFileSync(snapshot, stringify(actual))
      console.log(`Created snapshot: ${snapshot}`)
      return
    }
    else {
      assert.strictEqual(stringify(actual), '')
    }
  }
  else {
    const expected = fs.readFileSync(snapshot, 'utf-8')
    assert.strictEqual(stringify(actual), expected)
  }
}

let tested = 0
function skip(test) {
  if (config.n && tested > config.n) {
    return `skipping tests after ${config.n}`
  }
  else if (config.only && !config.only.find(o => o.toLowerCase().includes(path.basename(test.input).toLowerCase()))) {
    return `only testing ${config.only}`
  }
  else if (!config.big && config.tests.toobig.includes(path.basename(test.input))) {
    return 'too big'
  }
  else {
    return false
  }
}

function parse(bibfile, name, snapshot, options) {
  tested += 1
  test(name, { skip: skip({ input: bibfile }) }, async () => {
    const source = fs.readFileSync(bibfile, 'utf-8')
    let result = ''
    try {
      if (options.exception) {
        await bibtex.parseAsync(source, {
          ...options,
          unsupported: (node, tex, entry) => {
            result = `unsupported ${node.type} (${tex})\n${entry.input}`
          },
        })
      }
      else {
        result = await bibtex.parseAsync(source, options)
      }
    }
    catch (err) {
      result = err.message + '\n' + err.stack
    }
    matchSnapshot(result, snapshot)
  })
}

function sentenceCase(input, name, snapshot) {
  const source = fs.readFileSync(input, 'utf-8')
  const data = JSON.parse(source)
  if (!data.items) return

  test(name, async () => {
    const result = data.items.map(item => bibtex.toSentenceCase(item.title, { subSentenceCapitalization: false }))
    matchSnapshot(result, snapshot)
  })
}

for (const bibfile of testcases) {
  const basename = path.basename(bibfile)
  const section = path.basename(path.dirname(bibfile))

  if (bibfile.endsWith('.json')) {
    sentenceCase(
      bibfile,
      `${section}=${basename}`,
      path.resolve(here, 'snapshots', section, basename + '.yaml'),
    )
    continue
  }

  const unabbreviate = config.tests.unabbreviate.includes(basename)
  const settings = [
    `sentencecase=${config.sentenceCase}`,
    `caseprotection=${config.caseProtection}`,
    config.preserveQuoted ? 'preservequoted' : '',
  ]
    .filter(_ => _)
    .join('^')

  parse(
    bibfile,
    `${section}=${basename}`,
    path.resolve(here, 'snapshots', settings, section, basename + '.yaml'),
    {
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
      verbatimFields: config.tests.mendeley.includes(basename)
        ? bibtex.fields.verbatim.filter(field => !field.startsWith('file'))
        : undefined,
    },
  )
}
