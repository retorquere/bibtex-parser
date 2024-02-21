import { LatexPegParser } from '@unified-latex/unified-latex-util-pegjs'
import { visit } from '@unified-latex/unified-latex-util-visit'
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
const creator =[
  'author',
  'bookauthor',
  'collaborator',
  'commentator',
  'director',
  'editor',
  'editora',
  'editorb',
  'editors',
  'holder',
  'scriptwriter',
  'translator',
]

const narguments = {
  ElsevierGlyph: 1,
  bibcyr: 1,
  bibstring: 1,
  chsf: 1,
  cite: 1,
  citeauthor: 1,
  cyrchar: 1,
  ding: 1,
  emph: 1,
  enquote: 1,
  frac: 2,
  href: 2,
  hspace: 1,
  mathrm: 1,
  mbox: 1,
  mkbibbold: 1,
  mkbibemph: 1,
  mkbibitalic: 1,
  mkbibquote: 1,
  newcommand: 2,
  noopsort: 1,
  ocirc: 1,
  sb: 1,
  section: 1,
  sp: 1,
  subsection: 1,
  subsubsection: 1,
  subsubsubsection: 1,
  t: 1,
  textbf: 1,
  textcite: 1,
  textit: 1,
  textrm: 1,
  textsc: 1,
  textsubscript: 1,
  textsuperscript: 1,
  texttt: 1,
  textup: 1,
  url: 1,
  vphantom: 1,
  vspace: 1,
  em:  1,

  // math
  _: 1,
}
for (const m of combining.macros) {
  narguments[m] = 1
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

function ligature(nodes) {
  const max = 3
  const type = nodes.slice(0, max).map(n => n.type === 'string' ? 's' : ' ').join('')
  if (type[0] !== 's') return false

  let content = nodes.slice(0, max).map(n => n.type === 'string' ? n.content : '')
  let latex: string

  while (content.length) {
    if (type.startsWith('s'.repeat(content.length)) && (latex = latex2unicode[content.join('')])) {
      try {
        return { type: 'string', content: latex }
      }
      finally {
        nodes.splice(0, content.length)
      }
    }
    content.pop()
  }

  return false
}

function splitter(nodes, content) {
  switch (nodes.slice(0, 3).map(n => n.type === 'string' && n.content === content ? 'splitter' : n.type).join(',')) {
    case 'whitespace,splitter,whitespace':
      nodes.splice(0,3)
      return true

    case 'splitter,whitespace':
    case 'whitespace,splitter':
      nodes.splice(0,2)
      return true
  }

  return false
}

function argument(nodes) {
  if (!nodes.length) return false
  if (nodes[0].type === 'whitespace') nodes.shift()
  if (!nodes.length) return false
  return nodes.shift()
}

function convert(s: string, split?: string) {
  const ast = LatexPegParser.parse(s)

  // pass 1 -- mark & normalize
  visit(ast, (nodes, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument

    if (!Array.isArray(nodes)) {
      delete nodes.position

      if (info.context.inMathMode || info.context.hasMathModeAncestor) return

      if (nodes.type === 'inlinemath' || (nodes.type === 'group' && nodes.content[0]?.type === 'macro')) {
        nodes.bibtex = nodes.bibtex || {}
        nodes.bibtex.protectCase = true
      }

      return
    }

    let node
    const compacted = []
    while (nodes.length) {
      if (node = ligature(nodes)) {
        compacted.push(node)
        continue
      }

      node = nodes.shift()
      if (node.type === 'macro' && narguments[node.content]) {
        node.args = Array(narguments[node.content]).fill().map(i => argument(nodes)).filter(arg => arg !== false)
        if (node.content.match(/^(url|href)$/) && args.length) {
          node.args[0] = { type: 'verbatim', env: 'verbatim', content: printRaw(node.args[0].content) }
        }
      }

      compacted.push(node)
    }

    nodes.push(...compacted)
  }, { includeArrays: true })

  if (split) {
    const parts = []
    let last = -1
    while (ast.content.length) {
      if (!parts.length || splitter(ast.content, split)) {
        parts.push({ type: 'root', content: [] })
        last += 1
      }
      else {
        parts[last].content.push(ast.content.shift())
      }
    }
    console.log(show(parts))
    return parts.filter(p => p.content.length)
  }

  return ast
}

for (let bib of glob('test/better-bibtex/*/*.bib*')) {
  bib = bibtex.entries(fs.readFileSync(bib, 'utf-8')).entries
  for (const entry of bib) {
    for (const [field, value] of Object.entries(entry.fields)) {
      if (verbatim.find(m => typeof m === 'string' ? field === m : field.match(m))) continue
      if (creator.includes(field)) {
        convert(value, 'and')
      }
      else {
        // convert(value)
      }
    }
  }
}
