import { tokenize as tokenizeWasm } from './bibtex_tokenizer.js'

export { default, initSync } from './bibtex_tokenizer.js'
export type { InitInput, InitOutput, SyncInitInput } from './bibtex_tokenizer.js'

export type TokenType = 'word' | 'domain' | 'whitespace' | 'number' | 'email' | 'handle' | 'website' | 'markup' | 'other'

export interface Token {
  type: TokenType
  text: string
  shape: string
  sentenceStart: boolean
  subSentenceStart: boolean
}

export function tokenize(input: string): Token[] {
  return tokenizeWasm(input) as Token[]
}