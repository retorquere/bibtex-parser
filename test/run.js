#!/usr/bin/env node

import { globSync } from 'glob'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import * as bibtex from '../dist/esm/index.js'

import * as yaml from 'js-yaml'

const here = path.dirname(new URL(import.meta.url).pathname)

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
  ...(fs.existsSync(path.resolve(here, 'run.yaml')) ? load(path.resolve(here, 'run.yaml')) : {}),
  tests: load(path.resolve(here, 'config.yaml')),
}
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
    fs.mkdirSync(path.dirname(snapshot), { recursive: true })
    fs.writeFileSync(snapshot, stringify(actual))
    console.log(`Created snapshot: ${snapshot}`)
  }
  else {
    const expected = fs.readFileSync(snapshot, 'utf-8')
    assert.strictEqual(stringify(actual), expected)
  }
}

let tested = 0
function skip(test) {
  if (config.n && tested > config.n) return true
  if (config.only && !path.basename(test.input).toLowerCase().includes(config.only.toLowerCase())) return true
  if (!config.big && config.tests.toobig.includes(path.basename(test.input))) return true
  return false
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
