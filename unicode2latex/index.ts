import init, { initSync, RawTransform, replace_macro_spacers } from './unicode2latex.js'
import biblatexTable from '../tables/unicode2latex/biblatex.json' with { type: 'json' }
import bibtexTable from '../tables/unicode2latex/bibtex.json' with { type: 'json' }
import combiningTable from '../tables/unicode2latex/combining.json' with { type: 'json' }
import latex2unicodeTable from '../tables/unicode2latex/latex2unicode.json' with { type: 'json' }
import minimalTable from '../tables/unicode2latex/minimal.json' with { type: 'json' }

export { init, initSync, replace_macro_spacers }
export default init
export type { InitInput, SyncInitInput, InitOutput } from './unicode2latex.js'

export interface TeXChar {
  math?: string
  text?: string
  macrospacer?: boolean
  stopgap?: boolean
  combining?: boolean
  alt?: string[]
}

export type CharMap = Record<string, TeXChar>

export interface TeXMap {
  base: CharMap
  package: Record<string, CharMap>
}

export type TranslationMode = 'minimal' | 'biblatex' | 'bibtex' | 'bibtex-creator'
export type OutputMode = 'text' | 'math'

export interface MapOptions {
  packages?: string[]
  math?: string
  text?: string
  ascii?: string
  charmap?: CharMap
}

export interface TranslateOptions {
  bracemath?: boolean
  preservemacrospacers?: boolean
  packages?: Set<string>
}

export const biblatex = biblatexTable as TeXMap
export const bibtex = bibtexTable as TeXMap
export const minimal = minimalTable as TeXMap
export const combining = combiningTable as {
  macros: string[]
  tolatex: Record<string, { mode: OutputMode; macro: string }>
  tounicode: Record<string, string>
  regex: string
}
export const latex2unicode = latex2unicodeTable as Record<string, string | { text?: string; math?: string }>

/** Convert Unicode text to LaTeX with the initialized Rust transformer. */
export class Transform {
  #transform: RawTransform

  /** Load the selected mode and mapping options into the Rust transformer. */
  constructor(mode: TranslationMode, options: MapOptions = {}) {
    this.#transform = new RawTransform(mode, options)
  }

  /** Translate text and add suggested package names to the caller's set. */
  tolatex(text: string, options: TranslateOptions = {}): string {
    const result = this.#transform.translate(text, !!options.bracemath, !!options.preservemacrospacers)
    if (options.packages) {
      for (const name of result.packages) options.packages.add(name)
    }
    return result.latex
  }
}
