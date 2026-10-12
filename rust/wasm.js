import init, {
  initSync,
  parseNormalized as parseNormalizedWasm,
  parseVerbatim as parseVerbatimWasm,
  tokenize as tokenizeWasm,
  toSentenceCase as toSentenceCaseWasm,
} from './bibtex_parser.js'

export { init, initSync }
export default init

const english = [
  '', 'american', 'british', 'canadian', 'english', 'australian', 'newzealand',
  'usenglish', 'ukenglish', 'en', 'eng', 'en-au', 'en-bz', 'en-ca', 'en-cb',
  'en-gb', 'en-ie', 'en-jm', 'en-nz', 'en-ph', 'en-tt', 'en-us', 'en-za', 'en-zw', 'anglais',
]

function rustOptions(options = {}) {
  const rust = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))

  if (rust.unsupported !== undefined && typeof rust.unsupported !== 'string') {
    throw new TypeError('unsupported must be ignore, keep, or throw')
  }
  if (rust.unsupported !== undefined && !['ignore', 'keep', 'throw'].includes(rust.unsupported)) {
    throw new TypeError('unsupported must be ignore, keep, or throw')
  }

  if (typeof rust.strings === 'string') {
    rust.stringsSource = rust.strings
    delete rust.strings
  }
  else if (!rust.strings) {
    delete rust.strings
  }
  if (typeof rust.english === 'boolean') {
    rust.english = rust.english ? english : []
  }
  else if (Array.isArray(rust.english)) {
    const configured = rust.english
    rust.english = [...english]
    configured.forEach((language, index) => {
      rust.english[index] = language
    })
  }
  if (rust.sentenceCase === false) {
    rust.english = []
    rust.sentenceCase = { guess: false, subSentence: false, preserveQuoted: false }
  }
  if (rust.caseProtection === false) rust.caseProtection = 'off'
  if (rust.caseProtection === true) rust.caseProtection = 'as-needed'
  if (Array.isArray(rust.verbatimFields)) {
    rust.verbatimFields = rust.verbatimFields.filter(field => typeof field === 'string')
  }
  if (rust.unsupported === 'ignore') rust.ignoreUnsupported = true
  delete rust.unsupported
  return rust
}

function library(result) {
  if (Array.isArray(result.preambles)) {
    result.preamble = result.preambles
    delete result.preambles
  }
  return result
}

function throwOnUnsupported(result) {
  const unsupported = result.errors.find(error => error.error.startsWith('unhandled macro ') || error.error.startsWith('unhandled environment '))
  if (unsupported) throw new Error(unsupported.error)
  return result
}

export function parseVerbatim(input, options = {}) {
  const result = parseVerbatimWasm(input, rustOptions(options))
  delete result.jabref
  return result
}

export function parseNormalized(input, options = {}) {
  const selectors = options.verbatimFields || []
  const patterns = selectors.filter(selector => selector instanceof RegExp)
  let normalizedOptions = options
  if (patterns.length) {
    const exactFields = new Set(selectors.filter(selector => typeof selector === 'string'))
    const raw = parseVerbatimWasm(input, rustOptions({
      ...options,
      verbatimFields: [...exactFields],
    }))
    for (const entry of raw.entries) {
      for (const field of Object.keys(entry.fields)) {
        if (patterns.some(pattern => field.match(new RegExp(
          pattern.source,
          pattern.flags.includes('i') ? pattern.flags : `${pattern.flags}i`,
        )))) {
          exactFields.add(field)
        }
      }
    }
    normalizedOptions = { ...options, verbatimFields: [...exactFields] }
  }
  const result = library(parseNormalizedWasm(input, rustOptions(normalizedOptions)))
  if (options.unsupported === 'throw') return throwOnUnsupported(result)
  return result
}

export function parse(input, options = {}) {
  return parseNormalized(input, options)
}

export async function parseAsync(input, options = {}) {
  return parseNormalized(input, options)
}

export function toSentenceCase(input, options = {}) {
  return toSentenceCaseWasm(input, options)
}

export function tokenize(input, markup) {
  if (!(markup instanceof RegExp)) return tokenizeWasm(input)
  const masked = input.replace(markup, match => '\u2060'.repeat(match.length))
  return tokenizeWasm(masked)
}