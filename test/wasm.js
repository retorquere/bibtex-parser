#!/usr/bin/env node

import minimist from 'minimist'
import { globSync } from 'glob'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'
import * as yaml from 'js-yaml'

import init, { english, parseAsync, toSentenceCase } from '../rust/pkg/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
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

function verify(value, options) {
  if (options.includes(value)) return value
  throw new Error(`${value} must be one of ${options}`)
}

const args = minimist(process.argv.slice(2))
for (const [key, value] of Object.entries(args)) {
  switch (key) {
    case '_':
      config.only = config.only || []
      config.only = [...config.only, ...value]
      break

    case 's':
    case 'sc':
    case 'sentencecase':
      config.sentenceCase = verify(value, ['off', 'on+guess', 'on'])
      break

    case 'c':
    case 'cp':
    case 'caseprotection':
      config.caseProtection = verify(value, ['as-needed', 'off', 'strict'])
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
    case 'force':
      break

    default:
      throw new Error(`Unexpected option ${key}`)
  }
}
if (config.only && !config.only.length) delete config.only
if (args.save) fs.writeFileSync(saved, yaml.dump(config))
console.log('running rust wasm', config)

config.tests = load(path.resolve(here, 'config.yaml'))
const unabbreviations = load(path.resolve(here, '..', 'unabbrev.json'))
const strings = fs.readFileSync(path.resolve(here, '..', 'strings.bib'), 'utf-8')
if (process.env.CI === 'true') config.tests.toobig = []

const testcases = globSync(path.resolve(here, '**', '*.{json,bib,bibtex,biblatex}'), {
  nocase: true,
  matchBase: true,
  nonull: false,
  nodir: true,
}).sort()

function normalize(value) {
  const normalized = JSON.parse(JSON.stringify(value))
  for (const entry of normalized?.entries ?? []) {
    if (Array.isArray(entry.fields?.keywords)) entry.fields.keywords.sort()
  }
  return normalized
}

function stringify(value) {
  return yaml.dump(normalize(value), { sortKeys: true })
}

function matchSnapshot(actual, snapshot) {
  if (!fs.existsSync(snapshot) || (args.snap && args.force)) {
    if (args.snap) {
      fs.mkdirSync(path.dirname(snapshot), { recursive: true })
      fs.writeFileSync(snapshot, stringify(actual))
      console.log(`Created snapshot: ${snapshot}`)
      return
    }
    assert.deepEqual(normalize(actual), '')
  }
  else {
    const expected = normalize(load(snapshot))
    assert.deepEqual(normalize(actual), expected)
  }
}

let tested = 0
function skip(input) {
  if (config.n && tested > config.n) return `skipping tests after ${config.n}`
  if (config.only && !config.only.find(only => only.toLowerCase().includes(path.basename(input).toLowerCase()))) {
    return `only testing ${config.only}`
  }
  if (!config.big && config.tests.toobig.includes(path.basename(input))) return 'too big'
  return false
}

function parse(bibfile, name, snapshot, options) {
  tested += 1
  test(name, { skip: skip(bibfile) }, async () => {
    const source = fs.readFileSync(bibfile, 'utf-8')
    let result = ''
    try {
      if (options.exception) {
        await assert.rejects(parseAsync(source, {
          ...options,
          unsupported: 'throw',
        }), /unhandled macro \\/)
        return
      }
      else {
        result = await parseAsync(source, options)
      }
    }
    catch (error) {
      result = `${error.message ?? error}\n${error.stack ?? ''}`
    }
    matchSnapshot(result, snapshot)
  })
}

function sentenceCase(input, name, snapshot) {
  const source = fs.readFileSync(input, 'utf-8')
  const data = JSON.parse(source)
  if (!data.items) return
  test(name, () => {
    const result = data.items.map(item => toSentenceCase(item.title, { subSentenceCapitalization: false }))
    matchSnapshot(result, snapshot)
  })
}

before(async () => {
  const wasm = fs.readFileSync(path.resolve(root, 'rust/pkg/bibtex_parser_bg.wasm'))
  await init({ module_or_path: wasm })
})

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
  const loadstrings = config.tests.strings.includes(basename)
  const settings = [
    `sentencecase=${config.sentenceCase}`,
    `caseprotection=${config.caseProtection}`,
    config.preserveQuoted ? 'preservequoted' : '',
  ]
    .filter(Boolean)
    .join('^')

  parse(
    bibfile,
    `${section}=${basename}`,
    path.resolve(here, 'snapshots', settings, section, basename + '.yaml'),
    {
      english: config.sentenceCase.startsWith('on') ? english : [],
      languageAsLangid: config.tests.language.includes(basename),
      sentenceCase: {
        preserveQuoted: config.preserveQuoted,
        guess: config.sentenceCase.endsWith('guess'),
        subSentence: true,
      },
      caseProtection: config.caseProtection,
      unabbreviations: unabbreviate && unabbreviations,
      strings: loadstrings ? strings : undefined,
      exception: config.tests.exception.includes(basename),
      raw: config.tests.raw.includes(basename),
      verbatimFields: config.tests.mendeley.includes(basename)
        ? ['doi', 'eprint', 'files', 'pdf', 'groups', 'ids', 'url', 'verba', 'verbb', 'verbc']
        : undefined,
    },
  )
}
