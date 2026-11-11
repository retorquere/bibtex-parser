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

export declare class Transform {
  constructor(mode: TranslationMode, options?: MapOptions)
  tolatex(text: string, options?: TranslateOptions): string
}

export declare function replace_macro_spacers(latex: string): string

export declare const biblatex: TeXMap
export declare const bibtex: TeXMap
export declare const minimal: TeXMap
export declare const combining: {
  macros: string[]
  tolatex: Record<string, { mode: OutputMode; macro: string }>
  tounicode: Record<string, string>
  regex: string
}
export declare const latex2unicode: Record<string, string | { text?: string; math?: string }>
