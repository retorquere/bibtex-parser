// tslint:disable no-console

const unicode2latex = require('unicode2latex/tables/ascii.json')
import jsesc = require('jsesc')
import * as fs from 'fs'

const latex2unicode = {}

function set(latex, unicode) {
  latex = (latex || '').replace(/{}$/, '')
  if (!latex) return

  if (! latex[0].match(/[\\{_^]/)) {
    console.log('unicode2latex: skipping', jsesc({ latex, unicode }))
    return
  }

  latex2unicode[latex] = unicode
}

for (const [unicode, tex] of Object.entries(unicode2latex)) {
  for (const mode of ['math', 'text']) {
    let alts = tex[`${mode}alt`]
    if (!alts) alts = []
    if (!Array.isArray) alts = [ alts ]

    for (const alt of alts) {
      set(alt, unicode)
    }

    set(tex[mode], unicode)
  }
}

// tweaks
latex2unicode['\\'] = '\\'
latex2unicode['\\textmu{}'] = '\u03BC'
latex2unicode['\\to{}'] = '\u2192'
latex2unicode['\\varGamma{}'] = '\u0393'
latex2unicode['\\ocirc{u}'] = '\u016F'
latex2unicode['\\textless{}'] = '<'
latex2unicode['\\textgreater{}'] = '>'
latex2unicode['{\\~ w}'] = 'w\u0303'
latex2unicode['\\textasciitilde{}'] = '~'
latex2unicode['\\LaTeX{}'] = 'LaTeX'
latex2unicode['{\\c e}'] = '\u1E1D'
latex2unicode['\\neg{}'] = '\u00ac'
latex2unicode['\\Box{}'] = '\u25a1'
latex2unicode['\\le{}'] = '\u2264'
latex2unicode["\\'\\i"] = '\u00ED'

// this can't be in the final table
latex2unicode['\\relax'] = '\u200C'

fs.writeFileSync('latex2unicode.js', 'module.exports = ' + jsesc(latex2unicode, { compact: false, indent: '  ' }))
