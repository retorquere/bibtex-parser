import { unified } from 'unified'
import { printRaw } from "@unified-latex/unified-latex-util-print-raw"
import * as chunker from './chunker'
import { unifiedLatexFromString } from '@unified-latex/unified-latex-util-parse'
import { replaceNode } from '@unified-latex/unified-latex-util-replace'
import { parseLigatures } from '@unified-latex/unified-latex-util-ligatures'
import { latex2unicode, combining } from 'unicode2latex'

import * as fs from 'fs'

const content = "``Heyns'', \\mbox{Emiliano} and Heyns, Emile, Jr."

function argumentParser

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

import { visit } from '@unified-latex/unified-latex-util-visit'

function context(parents) {
  let ctx = {}
  for (const node of parents) {
    if (node.bibtex) ctx = {...node.bibtex, ...ctx}
  }
  return ctx
}

function convert(tree) {
  /*
  visit(tree, {
    enter(node, info) {
      let parent
      switch (node.type) {
        case 'group':
          node.bibtex = { protectCase: true }
          break
        case 'argument':
          node.bibtex = { protectCase: node.openMark === '{' }
          break

        case 'macro':
          if ((parent = info.parents[0]) && parent.bibtex && (Array.isArray(parent.content) ? parent.content[0] : parent.content) === node) {
            delete parent.bibtex.protectCase
          }
          break
      }
    },
    leave(node, info) {
      // console.log('  '.repeat(info.parents.length), 'leave', info, node.type)
    }
  })
  */

  replaceNode(tree, (node, info) => {
    if (info.parents[0]?.type === 'macro' && info.parents[0].content.match(/^(url|href)$/) && node === info.parents[0].args[0]) {
      return {
        type: 'verbatim',
        env: 'verbatim',
        content: printRaw(node.content),
      }
    }

    // return null to delete
    if (node.type === 'macro') {
      let text: string
      switch (node.content) {
        case 'frac':
          if (text = latex2unicode[`\\frac{${printRaw(node.args[0].content)}}{${printRaw(node.args[1].content)}}`]) {
            return { type: 'string', content: text }
          }
          else {
            return [...node.args[0].content, { type: 'string', contents: '\u2044' }, ...node.args[1].content]
          }
      }
    }
    else if (node.type === 'string') {
      if (node.content === '~') return {...node, content: '\u00A0' }
    }
  })

  visit(tree, (nodes, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
    if (info.context.inMathMode || info.context.hasMathModeAncestor) return

    const parsed = parseLigatures(nodes)
    nodes.length = 0
    nodes.push(...parsed)
  }, { includeArrays: true, test: Array.isArray })

  visit(tree, (nodes, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
    if (nodes.length === 1) return
    const condensed = []
    let node
    while (node = nodes.shift()) {
      if (!condensed.length || node.type !== 'string' || condensed[condensed.length - 1].type !== 'string') {
        condensed.push(node)
      }
      else {
        condensed[condensed.length - 1].content += node.content
      }
    }
    nodes.push(...condensed)
  }, { includeArrays: true, test: Array.isArray })
}

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

let input = fs.readFileSync('test.bib', 'utf-8')
const entries = chunker.entries(input).entries

for (const entry of entries) {
  for (const [k, v] of Object.entries(entry.fields)) {
    const ast = parser.parse(v)
    if (!verbatim.includes(k)) {
      convert(ast)
      console.log(entry.type, entry.key, k, JSON.stringify(ast, null, 2)) // eslint-disable-line no-console
    }
  }
}
