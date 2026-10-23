/** @module wasm */
import init, { initSync, parse as parseWasm, parseAsync as parseAsyncWasm, parseVerbatim as parseVerbatimWasm, parseVerbatimAsync as parseVerbatimAsyncWasm, tokenize as tokenizeWasm, toSentenceCase as toSentenceCaseWasm } from './bibtex_parser.js'
import { JabRefMetadata } from './jabref.js'

export { JabRefMetadata }
export type { Group as JabRefGroup } from './jabref.js'

export type { InitInput, InitOutput, SyncInitInput } from './bibtex_parser.js'
/** Initializes the WebAssembly parser; await this before using its exports. */
export { init, initSync }
export default init

/** Describes how a BibTeX field is interpreted. */
export type ParseMode = 'creatorlist' | 'title' | 'verbatim' | 'richtext' | 'literallist' | 'literal' | 'verbatimlist'

/** A parsed personal or organizational name. */
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

export type CreatorFields = {
  author?: Creator[]
  bookauthor?: Creator[]
  collaborator?: Creator[]
  commentator?: Creator[]
  director?: Creator[]
  editor?: Creator[]
  editora?: Creator[]
  editorb?: Creator[]
  editors?: Creator[]
  holder?: Creator[]
  scriptwriter?: Creator[]
  translator?: Creator[]
}

export type ArrayFields = {
  keywords?: string[]
  institution?: string[]
  publisher?: string[]
  origpublisher?: string[]
  organization?: string[]
  location?: string[]
  origlocation?: string[]
}

export type TypedFields = CreatorFields & ArrayFields
export type Fields = TypedFields & Omit<Record<string, string>, keyof TypedFields>

/** A normalized BibTeX entry returned by the parser. */
export interface Entry {
  type: string
  key: string
  fields: Fields
  mode: Record<string, ParseMode>
  crossref?: Record<string, { parent: string; field: string }>
  input: string
}

/** A parsing diagnostic. */
export interface ParseError {
  error: string
  input?: string
}

/** The parsed contents of a BibTeX library. */
export interface Library {
  errors: ParseError[]
  entries: Entry[]
  comments: string[]
  strings: Record<string, string>
  preambles: string[]
  jabref: JabRefMetadata
}

/** Options controlling title sentence casing. */
export interface SentenceCaseOptions {
  guess?: boolean
  subSentence?: boolean
  preserveQuoted?: boolean
}

/** A classified text token returned by {@link tokenize}. */
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

/** Options for normalized BibTeX parsing. */
export interface Options extends ParserOptions {
  /** Language identifiers treated as English for title casing. */
  english?: string[]
  /** Use the `language` field as a fallback language identifier. */
  languageAsLangid?: boolean
  /** Configure sentence-casing behavior. */
  sentenceCase?: SentenceCaseOptions
  /** Control preservation of capitalization inside braces. */
  caseProtection?: 'off' | 'as-needed' | 'strict'
  /** Merge adjacent equal markup spans separated only by whitespace (default true). */
  collapseMarkup?: boolean
  /** Render URL commands as HTML links (default true), or as case-protected destinations. */
  richURL?: boolean
  /** Policy for unsupported TeX commands and environments. */
  unsupported?: 'tex' | 'text' | 'ignore' | 'throw'
  /** Fields parsed as verbatim text rather than TeX. */
  verbatimFields?: (string | RegExp)[]
  /** Fields for which a redundant outer brace pair is removed. */
  removeOuterBraces?: string[]
  /** Override the default parsing mode for individual fields. */
  fieldMode?: Record<string, ParseMode>
  /** Return field text without LaTeX-to-Unicode conversion. */
  raw?: boolean
  /** Inherit missing fields from cross-referenced entries. */
  applyCrossRef?: boolean
}

/** Options shared by the normalized and verbatim parsers. */
export interface ParserOptions {
  /** Stop after this many entries have been parsed. */
  maxEntries?: number
  /** Preload string definitions as a dictionary or BibTeX source. */
  strings?: Record<string, string> | string
}

/** An entry whose field values retain their original BibTeX text. */
export interface VerbatimEntry {
  input: string
  type: string
  key: string
  fields: Record<string, string>
}

/** The library returned by the verbatim parser. */
export interface VerbatimLibrary {
  entries: VerbatimEntry[]
  strings: Record<string, string>
  comments: string[]
  errors: ParseError[]
  preambles: string[]
  jabref: JabRefMetadata
}

/** Default language identifiers treated as English. */
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

  if (parserOptions.unsupported !== undefined && !['tex', 'text', 'ignore', 'throw'].includes(parserOptions.unsupported as unknown as string)) {
    throw new TypeError('unsupported must be tex, text, ignore, or throw')
  }

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

function withJabRef<Parsed extends { jabref: JabRefMetadata }>(result: Parsed): Parsed {
  result.jabref = new JabRefMetadata(result.jabref)
  return result
}

/** Parses BibTeX while leaving field contents uninterpreted. */
export function parseVerbatim(input: string, options: ParserOptions = {}): VerbatimLibrary {
  const prepared = prepare(input, options)
  return withJabRef(parseVerbatimWasm(prepared.input, prepared.options) as VerbatimLibrary)
}

/** Asynchronous variant of {@link parseVerbatim}. */
export async function parseVerbatimAsync(input: string, options: ParserOptions = {}): Promise<VerbatimLibrary> {
  const prepared = prepare(input, options)
  return withJabRef(await parseVerbatimAsyncWasm(prepared.input, prepared.options) as VerbatimLibrary)
}

/** Parses BibTeX or BibLaTeX source into a normalized library. */
export function parse(input: string, options: Options = {}): Library {
  const prepared = prepare(input, options)
  const result = withJabRef(parseWasm(prepared.input, prepared.options) as Library)
  if (options.unsupported === 'throw') return throwOnUnsupported(result)
  return result
}

/** Asynchronous variant of {@link parse}, yielding during large parses. */
export async function parseAsync(input: string, options: Options = {}): Promise<Library> {
  const prepared = prepare(input, options)
  const result = withJabRef(await parseAsyncWasm(prepared.input, prepared.options) as Library)
  if (options.unsupported === 'throw') return throwOnUnsupported(result)
  return result
}

/** Converts a title to sentence case using heuristic token classification. */
export function toSentenceCase(input: string, options: { preserveQuoted?: boolean; subSentenceCapitalization?: boolean; guess?: boolean } = {}): string {
  return toSentenceCaseWasm(input, options)
}

/** Splits text into classified tokens with source offsets. */
export function tokenize(input: string, markup?: RegExp): Token[] {
  if (!(markup instanceof RegExp)) return tokenizeWasm(input) as Token[]
  const masked = input.replace(markup, match => '\u2060'.repeat(match.length))
  return tokenizeWasm(masked) as Token[]
}
