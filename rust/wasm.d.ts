import type { InitInput, InitOutput, SyncInitInput } from './bibtex_parser.js'

export type { InitInput, InitOutput, SyncInitInput }
export { initSync } from './bibtex_parser.js'
export { default as init } from './bibtex_parser.js'
export { default } from './bibtex_parser.js'

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
  preamble: string[]
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

export interface Options {
  english?: string[] | boolean
  languageAsLangid?: boolean
  sentenceCase?: false | SentenceCaseOptions
  caseProtection?: 'as-needed' | 'strict' | boolean
  unsupported?: 'ignore' | 'keep' | 'throw'
  verbatimFields?: (string | RegExp)[]
  removeOuterBraces?: string[]
  fieldMode?: Record<string, ParseMode>
  raw?: boolean
  strings?: Record<string, string> | string
  applyCrossRef?: boolean
}

export interface ParserOptions {
  maxEntries?: number
  strings?: Record<string, string> | string
  stringsSource?: string
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
}

export function parseVerbatim(input: string, options?: ParserOptions): VerbatimLibrary
export function parseNormalized(input: string, options?: Options): Library
export function parse(input: string, options?: Options): Library
export function parseAsync(input: string, options?: Options): Promise<Library>
export function toSentenceCase(input: string, options?: {
  preserveQuoted?: boolean
  subSentenceCapitalization?: boolean
  guess?: boolean
}): string
export function tokenize(input: string, markup?: RegExp): Token[]