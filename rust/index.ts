/** @module @retorquere/bibtex-parser */
import init, { initSync, parse as parseWasm, parseAsync as parseAsyncWasm, parseVerbatim as parseVerbatimWasm, parseVerbatimAsync as parseVerbatimAsyncWasm, toSentenceCase as toSentenceCaseWasm } from './bibtex_parser.js'
import englishDefaults from './english.json' with { type: 'json' }

/** Inputs for asynchronous WASM initialization: a URL-like resource to fetch, bytes, or a compiled module. */
export type { InitInput } from './bibtex_parser.js'
/** Inputs for synchronous WASM initialization: bytes or a compiled module; synchronous initialization cannot fetch a URL. */
export type { SyncInitInput } from './bibtex_parser.js'
/** @ignore */
export type { InitOutput } from './bibtex_parser.js'
/**
 * Loads and initializes the WebAssembly parser asynchronously.
 *
 * With no argument, the browser build fetches the package's WASM file relative to this module. Pass a URL-like resource to choose another location, or pass bytes when the caller loads the binary itself. Initialize once before calling parser functions.
 *
 * @example
 * ```ts
 * import init, { parse } from '@retorquere/bibtex-parser'
 *
 * await init()
 * const library = parse('@article{example, title={A title}}')
 * ```
 */
export { init }
/**
 * Initializes the WebAssembly parser from bytes or a compiled module without fetching it.
 * Call this before any parser function; prefer {@link init} when the binary should be loaded asynchronously.
 *
 * @example
 * ```ts
 * import { readFile } from 'node:fs/promises'
 * import { initSync, parse } from '@retorquere/bibtex-parser'
 *
 * initSync({ module: await readFile('bibtex_parser_bg.wasm') })
 * const library = parse('@article{example, title={A title}}')
 * ```
 */
export { initSync }
export default init

/** Describes how a BibTeX field is interpreted. */
export type ParseMode = 'namelist' | 'title' | 'verbatim' | 'richtext' | 'literallist' | 'literal' | 'verbatimlist' | 'annotations' | 'options'

/** A parsed personal or organizational name. */
export interface Name {
  /** Complete name when the parser cannot safely separate the name into components. */
  name?: string
  /** Family name, including any parsed name prefix. */
  lastName?: string
  /** Given name. */
  firstName?: string
  /** Name particle, such as "von" or "de", when separated from the family name. */
  prefix?: string
  /** Generational or other name suffix. */
  suffix?: string
  /** Initials of the given name. */
  initial?: string
  /** Whether the parsed family name includes a name prefix. */
  useprefix?: boolean
  /** Whether the source separated the suffix from the name with a comma. */
  juniorcomma?: boolean
}

/** Value text in a Biber annotation clause. */
export type AnnotationContent = string | string[]

/** One Biber annotation clause with its explicit scope and one-based selector. */
export type Annotation =
  | { scope: 'field'; value: AnnotationContent }
  | { scope: 'item'; index: number; value: AnnotationContent }
  | { scope: 'part'; index: number; name: string; value: AnnotationContent }

/** Parsed key/value pairs from a BibLaTeX options field. */
export type OptionMap = Record<string, string>
/** A normalized field value, including parsed names, lists, annotations and options. */
export type FieldValue = string | string[] | Name[] | Annotation[] | OptionMap

/** Name-list fields whose values are returned as arrays of {@link Name} objects. */
export type NameFields = {
  afterword?: Name[]
  author?: Name[]
  annotator?: Name[]
  bookauthor?: Name[]
  collaborator?: Name[]
  commentator?: Name[]
  director?: Name[]
  editor?: Name[]
  editora?: Name[]
  editorb?: Name[]
  editors?: Name[]
  foreword?: Name[]
  holder?: Name[]
  introduction?: Name[]
  namea?: Name[]
  nameb?: Name[]
  namec?: Name[]
  scriptwriter?: Name[]
  shortauthor?: Name[]
  shorteditor?: Name[]
  sortname?: Name[]
  translator?: Name[]
}

/** List-valued fields whose elements remain strings. */
export type ArrayFields = {
  address?: string[]
  entryset?: string[]
  institution?: string[]
  labelname?: string[]
  language?: string[]
  location?: string[]
  organization?: string[]
  origlocation?: string[]
  origlanguage?: string[]
  origpublisher?: string[]
  pageref?: string[]
  publisher?: string[]
  related?: string[]
  relatedoptions?: string[]
  school?: string[]
  xdata?: string[]
  keywords?: string[]
  ids?: string[]
  lista?: string[]
  listb?: string[]
  listc?: string[]
}

/** Biber annotation fields keyed by their annotated field name and annotation name. */
export type AnnotationFields = {
  [field in `${string}+an:${string}`]?: Annotation[]
}

/** Fields whose values are parsed key/value maps. */
export type OptionFields = {
  options?: OptionMap
}

/** The known structured fields in a normalized entry. */
export type TypedFields = NameFields & ArrayFields & AnnotationFields & OptionFields
/** Named structured fields retain their precise types; unlisted default fields are scalar text. */
export type Fields = TypedFields & Omit<Record<string, string>, keyof TypedFields>

/** A normalized BibTeX entry returned by the parser. */
export interface Entry {
  /** Entry type from the source, such as `article` or `inproceedings`. */
  type: string
  /** Citation key identifying this entry. */
  key: string
  /** Parsed field values; each value is one of the Rust parser's serialized field variants. */

  /** Parsed field values, with known name, options and list fields represented as arrays. */
  fields: Fields

  /** Original text for fields whose parsed representation is structured. */
  verbatim: Record<string, string>

  /** Parsing mode used for each field; see {@link ParseMode}. */
  mode: Record<string, ParseMode>

  /** For fields inherited through `crossref`, records the parent entry key and source field name. */
  crossref?: Record<string, { parent: string; field: string }>

  /** Source text for this entry. */
  input: string
}

/** A parsing diagnostic. */
export interface ParseError {
  /** Human-readable diagnostic describing the parse or normalization issue. */
  error: string
  /** Source fragment associated with the diagnostic, when available. */
  input?: string
}

/** A JabRef group serialized by the Rust parser. */
export interface JabRefGroup {
  name: string
  entries: string[]
  groups: JabRefGroup[]
}

/** JabRef metadata serialized by the Rust parser. */
export interface JabRefMetadata {
  root: JabRefGroup[]
  fileDirectory?: string
  groupsversion?: number
  databaseType?: string
}

/** The parsed contents of a BibTeX library. */
export interface Library {
  /** Diagnostics collected while parsing; recoverable errors do not necessarily prevent entries from being returned. */
  errors: ParseError[]
  /** Successfully parsed entries, in source order. */
  entries: Entry[]
  /** Text from `@comment` directives. */
  comments: string[]
  /** Resolved values declared by `@string` directives. */
  strings: Record<string, string>
  /** Values from `@preamble` directives, in source order. */
  preambles: string[]
  /** JabRef metadata extracted from the library, including groups and file settings. */
  jabref: JabRefMetadata
}

/** Options used for sentence casing during BibTeX field normalization. */
export interface SentenceCaseOptions {
  guess?: boolean
  subSentence?: boolean
  preserveQuoted?: boolean
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
  /** Field-name glob patterns parsed as verbatim text rather than TeX (`*`, `?`, and `\\`). */
  verbatimFields?: string[]
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
  /** Stop after this many entries have been parsed; useful for quickly checking whether text is BibTeX. */
  maxEntries?: number
  /** Preload `@string` definitions as a name-to-value map or BibTeX source text. */
  strings?: Record<string, string> | string
}

/** An entry whose field values retain their BibTeX text instead of being interpreted as LaTeX. */
export interface VerbatimEntry {
  /** Source text for this entry. */
  input: string
  /** Entry type from the source. */
  type: string
  /** Citation key identifying this entry. */
  key: string
  /** Field names mapped to their text values; name names and LaTeX are not normalized. */
  fields: Record<string, string>
}

/** The library returned by the verbatim parser, before normalized field parsing. */
export interface VerbatimLibrary {
  /** Successfully parsed entries, in source order. */
  entries: VerbatimEntry[]
  /** Resolved values declared by `@string` directives. */
  strings: Record<string, string>
  /** Text from `@comment` directives. */
  comments: string[]
  /** Diagnostics collected while parsing. */
  errors: ParseError[]
  /** Values from `@preamble` directives, in source order. */
  preambles: string[]
}

/** Default language identifiers treated as English. */
export const english: string[] = englishDefaults

function prepare(input: string, options: Options | ParserOptions = {}): { input: string; options: Record<string, unknown> } {
  const parserOptions: Record<string, unknown> = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
  if (typeof parserOptions.strings === 'string') {
    input = `${parserOptions.strings}\n${input}`
    delete parserOptions.strings
  }

  if (parserOptions.unsupported !== undefined && !['tex', 'text', 'ignore', 'throw'].includes(parserOptions.unsupported as unknown as string)) {
    throw new TypeError('unsupported must be tex, text, ignore, or throw')
  }

  return { input, options: parserOptions }
}

function throwOnUnsupported(result: Library): Library {
  const unsupported = result.errors.find(error => error.error.startsWith('unhandled macro ') || error.error.startsWith('unhandled environment '))
  if (unsupported) throw new Error(unsupported.error)
  return result
}

/**
 * Parses BibTeX without converting LaTeX field contents to Unicode or structured name values.
 * `@string` references are resolved, while each entry's fields remain strings for later processing.
 *
 * @example
 * ```ts
 * const library = parseVerbatim('@article{example, title={A \\LaTeX title}}')
 * const rawTitle = library.entries[0]?.fields.title
 * ```
 */
export function parseVerbatim(input: string, options: ParserOptions = {}): VerbatimLibrary {
  const prepared = prepare(input, options)
  return parseVerbatimWasm(prepared.input, prepared.options) as VerbatimLibrary
}

/** Asynchronous variant of {@link parseVerbatim}; yields while processing large inputs. */
export async function parseVerbatimAsync(input: string, options: ParserOptions = {}): Promise<VerbatimLibrary> {
  const prepared = prepare(input, options)
  return await parseVerbatimAsyncWasm(prepared.input, prepared.options) as VerbatimLibrary
}

/**
 * Parses BibTeX or BibLaTeX source into normalized entries and field values.
 * Recoverable problems are reported in `Library.errors`; set `unsupported: 'throw'` to throw on unsupported TeX commands or environments.
 *
 * @example
 * ```ts
 * const { entries, errors } = parse('@article{example, author={Ada Lovelace}, title={A title}}')
 * const title = entries[0]?.fields.title
 * ```
 */
export function parse(input: string, options: Options = {}): Library {
  const prepared = prepare(input, options)
  const result = parseWasm(prepared.input, prepared.options) as Library
  if (options.unsupported === 'throw') return throwOnUnsupported(result)
  return result
}

/** Asynchronous variant of {@link parse}; returns the same result shape and yields between batches for large inputs. */
export async function parseAsync(input: string, options: Options = {}): Promise<Library> {
  const prepared = prepare(input, options)
  const result = await parseAsyncWasm(prepared.input, prepared.options) as Library
  if (options.unsupported === 'throw') return throwOnUnsupported(result)
  return result
}

/** Converts a title to sentence case using heuristic token classification. */
export function toSentenceCase(input: string, options: { preserveQuoted?: boolean; subSentenceCapitalization?: boolean; guess?: boolean } = {}): string {
  return toSentenceCaseWasm(input, options)
}
