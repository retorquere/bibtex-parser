import { LatexPegParser } from '@unified-latex/unified-latex-util-pegjs'
import { printRaw } from "@unified-latex/unified-latex-util-print-raw"
import { inspect } from 'util'
import { latex2unicode, combining } from 'unicode2latex'
import { globSync as glob } from 'glob'
import * as fs from 'fs'
import * as bibtex from './chunker'

function show(obj) {
  return inspect(obj, {showHidden: false, depth: null, colors: true})
}

const verbatim = [
    'doi',
    'eprint',
    'file',
    'files',
    'pdf',
    'groups', // jabref unilaterally decided to make this non-standard field verbatim
    'ids',
    'url',
    'verba',
    'verbb',
    'verbc',
    /^citeulike-linkout-[0-9]+$/,
    /^bdsk-url-[0-9]+$/,
]

const macros = {
  ElsevierGlyph: 'm',
  bibcyr: 'm',
  bibstring: 'm',
  chsf: 'm',
  cite: 'm',
  citeauthor: 'm',
  cyrchar: 'm',
  ding: 'm',
  emph: 'm',
  enquote: 'm',
  frac: 'm m',
  href: 'm m',
  hspace: 'm',
  mathrm: 'm',
  mbox: 'm',
  mkbibbold: 'm',
  mkbibemph: 'm',
  mkbibitalic: 'm',
  mkbibquote: 'm',
  newcommand: 'm m',
  noopsort: 'm',
  ocirc: 'm',
  sb: 'm',
  section: 'm',
  sp: 'm',
  subsection: 'm',
  subsubsection: 'm',
  subsubsubsection: 'm',
  t: 'm',
  textbf: 'm',
  textcite: 'm',
  textit: 'm',
  textrm: 'm',
  textsc: 'm',
  textsubscript: 'm',
  textsuperscript: 'm',
  texttt: 'm',
  textup: 'm',
  url: 'm',
  vphantom: 'm',
  vspace: 'm',
  em:  'm',

  // math
  _: 'm',
}
for (const m of combining.macros) {
  macros[m] = 'm'
}

function textmatch(car, cdr, n) {
  if (car.type !== 'string') return undefined
  if (cdr.length < n) return undefined
  
  let latex = car.content
  for (let i = 0; i < n; i++) {
    if (cdr[i].type !== 'string') return undefined
    latex += cdr[i].content
  }

  if (!latex2unicode[latex]) return undefined

  for (let i = 0; i < n; i++) cdr.shift()
  return latex2unicode[latex]
}

function walk(node, info={ parents: [], inMath: false }) {
  delete node.position

  if (node.type === 'inlinemath' || (node.type === 'group' && node.content.length && node.content[0].type !== 'macro')) {
    node.bibtex = node.bibtex || {}
    node.bibtex.protectCase = true
  }

  if (Array.isArray(node.content)) {
    let child
    for (child of node.content) {
      walk(child, {...info, parents: [node, ...info.parents] })
    }
    
    const content = []
    let text
    let argspec
    while (child = node.content.shift()) {
      if (text = latex2unicode[printRaw(child)]) {
        child = { type: 'string', content: text }
      }
      else {
        // pure-text "macros"
        text = undefined
        for (let l = 2; l >= 0; l--) {
          text = textmatch(child, node.content, l)
          if (typeof text === 'string') {
            child = { type: 'string', content: text }
            break
          }
        }
      }

      if (child.type === 'macro' && (argspec = macros[child.content])) {
        child.args = []
        for (const spec of argspec.split(' ')) {
          let car = node.content.shift()
          if (car?.type === 'whitespace') car = node.content.shift()
          if (!car) {
            child.args.push({ type: 'string', content: '' })
          }
          else if (car.type === 'string') {
            child.args.push({ type: 'string', content: car.content[0] })
            if (car.content.length > 1) {
              node.content.unshift({ type: 'string', content: car.content.substring(1) })
            }
          }
          else {
            child.args.push(car)
          }
        }

        if (child.args.length && child.content.match(/^(href|url)$/)) {
          child.args[0] = { type: 'verbatim', env: 'verbatim', content: printRaw(child.args[0].content) }
        }

        const args = child.args.map(arg => `{${printRaw(arg.content)}}`).join('')
        if (text = (latex2unicode[`\\${child.content}${args}`] || latex2unicode[`${child.content}${args}`])) {
          child = { type: 'string', content: text }
        }
      }
      else if (child.type === 'macro' && (text = latex2unicode[`\\${child.content}`])) {
        child = { type: 'string', content: text }
      }

      content.push(child)
    }
    node.content = content
  }

  return node
}

for (let bib of glob('test/better-bibtex/*/*.bib*')) {
  bib = bibtex.entries(fs.readFileSync(bib, 'utf-8')).entries
  for (const entry of bib) {
    for (const [field, value] of Object.entries(entry.fields)) {
      if (verbatim.find(m => typeof m === 'string' ? field === m : field.match(m))) continue
      if (field !== 'author') continue
      // console.log(show(walk(LatexPegParser.parse(value))))
    }
  }
}

console.log(show(walk(LatexPegParser.parse('\\begin{markdown} some text here \\end{markdown}'))))
