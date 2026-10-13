/** @module wasm */
import init, { initSync, parse as parseWasm, parseAsync as parseAsyncWasm, parseVerbatim as parseVerbatimWasm, parseVerbatimAsync as parseVerbatimAsyncWasm, tokenize as tokenizeWasm, toSentenceCase as toSentenceCaseWasm } from './bibtex_parser.js'

export type { InitInput, InitOutput, SyncInitInput } from './bibtex_parser.js'
export { init, initSync }
export default init

export type ParseMode = 'creatorlist' | 'title' | 'verbatim' | 'richtext' | 'literallist' | 'literal' | 'verbatimlist'

export interface Creator {
  name?: string
  lastName?: string
  firstName?: string
  prefix?: string
  suffix?: string
  initial?: string
  useprefix?: boolean
  juniorcomma?: boolean
}

export type FieldValue = string | string[] | Creator[]

export interface Entry {
  type: string
  key: string
  fields: Record<string, FieldValue>
  mode: Record<string, ParseMode>
  crossref?: Record<string, { parent: string; field: string }>
  input: string
}

export interface ParseError {
  error: string
  input?: string
}

export interface JabRefGroup {
  name: string
  entries: string[]
  groups: JabRefGroup[]
}

export interface JabRefMetadata {
  root: JabRefGroup[]
  groups: Record<string, JabRefGroup>
  fileDirectory?: string
  groupsversion?: number
  databaseType?: string
}

export interface Library {
  errors: ParseError[]
  entries: Entry[]
  comments: string[]
  strings: Record<string, string>
  preambles: string[]
  jabref: JabRefMetadata
}

export interface SentenceCaseOptions {
  guess?: boolean
  subSentence?: boolean
  preserveQuoted?: boolean
}

export interface Token {
  type: 'word' | 'domain' | 'whitespace' | 'number' | 'email' | 'handle' | 'website' | 'markup' | 'other' | 'punctuation'
  subtype: '' | 'preposition' | 'acronym' | 'contraction' | 'ordinal' | 'word' | 'end' | 'colon' | 'ellipsis'
  text: string
  start: number
  end: number
  shape: string
  sentenceStart: boolean
  subSentenceStart: boolean
  hyphenated?: Token[]
}

export interface Options extends ParserOptions {
  english?: string[]
  languageAsLangid?: boolean
  sentenceCase?: SentenceCaseOptions
  caseProtection?: 'off' | 'as-needed' | 'strict'
  unsupported?: 'ignore' | 'keep' | 'throw'
  verbatimFields?: (string | RegExp)[]
  removeOuterBraces?: string[]
  fieldMode?: Record<string, ParseMode>
  raw?: boolean
  applyCrossRef?: boolean
}

export interface ParserOptions {
  maxEntries?: number
  strings?: Record<string, string> | string
}

export interface VerbatimEntry {
  input: string
  type: string
  key: string
  fields: Record<string, string>
}

export interface VerbatimLibrary {
  entries: VerbatimEntry[]
  strings: Record<string, string>
  comments: string[]
  errors: ParseError[]
  preambles: string[]
  jabref: JabRefMetadata
}

export const english = [
  '',
  'american',
  'british',
  'canadian',
  'english',
  'australian',
  'newzealand',
  'usenglish',
  'ukenglish',
  'en',
  'eng',
  'en-au',
  'en-bz',
  'en-ca',
  'en-cb',
  'en-gb',
  'en-ie',
  'en-jm',
  'en-nz',
  'en-ph',
  'en-tt',
  'en-us',
  'en-za',
  'en-zw',
  'anglais',
]

function prepare(input: string, options: Options | ParserOptions = {}): { input: string; options: Record<string, unknown> } {
  const parserOptions: Record<string, unknown> = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
  if (typeof parserOptions.strings === 'string') {
    input = `${parserOptions.strings}\n${input}`
    delete parserOptions.strings
  }

  if (parserOptions.unsupported && !['ignore', 'keep', 'throw'].includes(parserOptions.unsupported as unknown as string)) {
    throw new TypeError('unsupported must be ignore, keep, or throw')
  }
  if (parserOptions.unsupported === 'ignore') parserOptions.ignoreUnsupported = true
  delete parserOptions.unsupported

  if (Array.isArray(parserOptions.verbatimFields)) {
    parserOptions.verbatimFields = parserOptions.verbatimFields.map((field: string | RegExp) => {
      if (typeof field === 'string') return field
      const flags = `${field.multiline ? 'm' : ''}${field.dotAll ? 's' : ''}`
      const source = flags ? `(?${flags}:${field.source})` : field.source
      return { source: field.sticky ? `\\A(?:${source})` : source }
    })
  }

  return { input, options: parserOptions }
}

function throwOnUnsupported(result: Library): Library {
  const unsupported = result.errors.find(error => error.error.startsWith('unhandled macro ') || error.error.startsWith('unhandled environment '))
  if (unsupported) throw new Error(unsupported.error)
  return result
}

export function parseVerbatim(input: string, options: ParserOptions = {}): VerbatimLibrary {
  const prepared = prepare(input, options)
  return parseVerbatimWasm(prepared.input, prepared.options) as VerbatimLibrary
}

export async function parseVerbatimAsync(input: string, options: ParserOptions = {}): Promise<VerbatimLibrary> {
  const prepared = prepare(input, options)
  return await parseVerbatimAsyncWasm(prepared.input, prepared.options) as VerbatimLibrary
}

export function parse(input: string, options: Options = {}): Library {
  const prepared = prepare(input, options)
  const result = parseWasm(prepared.input, prepared.options) as Library
  if (options.unsupported === 'throw') return throwOnUnsupported(result)
  return result
}

export async function parseAsync(input: string, options: Options = {}): Promise<Library> {
  const prepared = prepare(input, options)
  const result = await parseAsyncWasm(prepared.input, prepared.options) as Library
  if (options.unsupported === 'throw') return throwOnUnsupported(result)
  return result
}

export function toSentenceCase(input: string, options: { preserveQuoted?: boolean; subSentenceCapitalization?: boolean; guess?: boolean } = {}): string {
  return toSentenceCaseWasm(input, options)
}

export function tokenize(input: string, markup?: RegExp): Token[] {
  if (!(markup instanceof RegExp)) return tokenizeWasm(input) as Token[]
  const masked = input.replace(markup, match => '\u2060'.repeat(match.length))
  return tokenizeWasm(masked) as Token[]
}
