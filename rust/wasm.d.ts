import type { InitInput, InitOutput, SyncInitInput } from './bibtex_parser.js'

export type { InitInput, InitOutput, SyncInitInput }
export { initSync } from './bibtex_parser.js'
export { default as init } from './bibtex_parser.js'
export { default } from './bibtex_parser.js'

export interface ParserOptions {
  maxEntries?: number
  strings?: Record<string, string>
  stringsSource?: string
}

export interface ParseError {
  error: string
  input: string
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

export interface Creator {
  name: string | null
  lastName: string | null
  firstName: string | null
  prefix: string | null
  suffix: string | null
  initial: string | null
  useprefix: boolean | null
  juniorcomma: boolean | null
}

export type FieldValue =
  | { kind: 'text'; value: string }
  | { kind: 'creators'; value: Creator[] }
  | { kind: 'list'; value: string[] }

export interface ParsedEntry {
  input: string
  type: string
  key: string
  fields: Record<string, FieldValue>
  mode: Record<string, string>
}

export interface ParsedLibrary {
  entries: ParsedEntry[]
  strings: Record<string, string>
  comments: string[]
  errors: ParseError[]
  preamble: string[]
}

export function parseVerbatim(input: string, options?: ParserOptions): VerbatimLibrary
export function parseNormalized(input: string, options?: ParserOptions): ParsedLibrary