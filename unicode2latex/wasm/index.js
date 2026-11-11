import { readFileSync } from 'node:fs'
import { initSync, RawTransform, replace_macro_spacers } from './raw/unicode2latex.js'

const table = name => JSON.parse(readFileSync(new URL(`./tables/${name}.json`, import.meta.url), 'utf8'))
export const biblatex = table('biblatex')
export const bibtex = table('bibtex')
export const minimal = table('minimal')
export const combining = table('combining')
export const latex2unicode = table('latex2unicode')
export { replace_macro_spacers }

// Node loads the compiled module synchronously, preserving the existing constructor API.
initSync({ module: readFileSync(new URL('./raw/unicode2latex_bg.wasm', import.meta.url)) })

/** Preserve the JavaScript API while keeping conversion state in Rust. */
export class Transform {
  #transform

  /** Load package layers, character preferences, and custom entries into Rust. */
  constructor(mode, options = {}) {
    this.#transform = new RawTransform(mode, JSON.stringify(options))
  }

  /** Translate in Rust and accumulate package hints in the caller's existing Set. */
  tolatex(text, options = {}) {
    const result = JSON.parse(this.#transform.translate(text, !!options.bracemath, !!options.preservemacrospacers))
    if (options.packages) {
      for (const name of result.packages) options.packages.add(name)
    }
    return result.latex
  }
}