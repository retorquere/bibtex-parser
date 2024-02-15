import { unified } from 'unified'
import { printRaw } from "@unified-latex/unified-latex-util-print-raw"
import * as chunker from './chunker'
import { unifiedLatexFromString } from '@unified-latex/unified-latex-util-parse'
// import { replaceNode } from '@unified-latex/unified-latex-util-replace'
import { parseLigatures } from '@unified-latex/unified-latex-util-ligatures'

const content = "``Heyns'', \\mbox{Emiliano} and Heyns, Emile, Jr."

const parser = unified().use(unifiedLatexFromString, {
  macros: {
    ElsevierGlyph: { signature: 'm' },
    bibcyr: { signature: 'm' },
    bibstring: { signature: 'm' },
    chsf: { signature: 'm' },
    cite: { signature: 'm' },
    citeauthor: { signature: 'm' },
    cyrchar: { signature: 'm' },
    ding: { signature: 'm' },
    emph: { signature: 'm' },
    enquote: { signature: 'm' },
    frac: { signature: 'm m' },
    href: { signature: 'm m' },
    hspace: { signature: 'm' },
    mathrm: { signature: 'm' },
    mbox: { signature: 'm' },
    mkbibbold: { signature: 'm' },
    mkbibemph: { signature: 'm' },
    mkbibitalic: { signature: 'm' },
    mkbibquote: { signature: 'm' },
    newcommand: { signature: 'm m' },
    noopsort: { signature: 'm' },
    ocirc: { signature: 'm' },
    sb: { signature: 'm' },
    section: { signature: 'm' },
    sp: { signature: 'm' },
    subsection: { signature: 'm' },
    subsubsection: { signature: 'm' },
    subsubsubsection: { signature: 'm' },
    t: { signature: 'm' },
    textbf: { signature: 'm' },
    textcite: { signature: 'm' },
    textit: { signature: 'm' },
    textrm: { signature: 'm' },
    textsc: { signature: 'm' },
    textsubscript: { signature: 'm' },
    textsuperscript: { signature: 'm' },
    texttt: { signature: 'm' },
    textup: { signature: 'm' },
    url: { signature: 'm' },
    vphantom: { signature: 'm' },
    vspace: { signature: 'm' },
    em:  { signature: 'm' },
  },
})

let input = require('./test.json').bib
input = "@article{x, x={\\em{x}\\href{url\\too}{label}}}"
const entries = chunker.entries(input).entries
import { visit } from '@unified-latex/unified-latex-util-visit'

function context(parents) {
  let ctx = {}
  for (const node of parents) {
    if (node.bibtex) ctx = {...node.bibtex, ...ctx}
  }
  return ctx
}

function convert(tree) {
  visit(tree, (nodes, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
    if (info.context.inMathMode || info.context.hasMathModeAncestor) return

    const parsed = parseLigatures(nodes)
    nodes.length = 0
    nodes.push(...parsed)
  }, { includeArrays: true, test: Array.isArray })
  
  visit(tree, (node, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
    if (node.type === 'macro' && node.content.match(/^(url|href)$/)) {
      node.args[0].content = [ { type: 'string', content: printRaw(node.args[0].content) } ]
    }
  })
}

/*
replaceNode(ast, (node) => {
    // return null to delete
    if (node.type == 'macro' && node.content == '_' && node.args[0].type == 'string' && node.args[0].content == '1') return {...node, type: 'string', content: '\u2081', args: null }
    // if (node.type === 'string' && node.content === '~') return {...node, content: '\u00A0' }
    return undefined
})
*/

const verbatim = [
    'doi',
    'eprint',
    'file',
    'files',
    'pdf',
    'groups', // jabref unilaterally decided to make this non-standard field verbatim                                                                                        'ids',
    'url',
    'verba',
    'verbb',
    'verbc',
]

for (const entry of entries) {
  for (const [k, v] of Object.entries(entry.fields)) {
    const ast = parser.parse(v)
    if (!verbatim.includes(k)) convert(ast)
    // console.log(entry.type, entry.key, k, JSON.stringify(ast, null, 2)) // eslint-disable-line no-console
  }
}
