import { Argument, Group } from '@unified-latex/unified-latex-types'
import { replaceNode } from '@unified-latex/unified-latex-util-replace'
import { LatexPegParser } from '@unified-latex/unified-latex-util-pegjs'
import { visit } from '@unified-latex/unified-latex-util-visit'
import { printRaw } from "@unified-latex/unified-latex-util-print-raw"
import { latex2unicode, combining } from 'unicode2latex'
import { globSync as glob } from 'glob'
import * as fs from 'node:fs'
import * as bibtex from './chunker'

const unabbreviate = require('./unabbrev.json')

type Creator = {
  type: string
  name?: string
  family?: string
  given?: string
  prefix?: string
  suffix?: string
  initial?: string
  useprefix?: boolean
  juniorcomma?: boolean
}

type Entry = Record<string, Creator[] | string[] | string>

export const fieldMode = {
  creator: [
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
  ],
  title: [
    'title',
    'series',
    'shorttitle',
    'booktitle',
    'type',
    'origtitle',
    'maintitle',
    'eventtitle',
  ],
  verbatim: [
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
  ],
  html: [
    'annotation',
    'comment',
    'annote',
    'review',
    'notes',
    'note',
  ],
  commalist: [
    'keywords',
  ],
  literallist: [
    'institution',
    'publisher',
    'origpublisher',
    'organization',
    'location',
    'origlocation',
  ],
}

const fieldAction = {
  unnest: [
    'publisher',
    'location',
  ],
  unabbrev: [
    'journal',
    'journaltitle',
    'journal-full',
  ],
}

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
  '^': 1,
}
for (const m of combining.macros) {
  narguments[m] = 1
}

const splitter = new class {
  private splitter(nodes, splitter: RegExp) {
    const types = nodes.slice(0, 3).map(n => n.type === 'string' && n.content.match(splitter) ? 'splitter' : n.type).join(',')
    const match = /^(whitespace,?)?(splitter)(,?whitespace)?/.exec(types)
    if (!match) return false
    nodes.splice(0, match.slice(1).filter(t => t).length)
    return true
  }

  split(ast, splitter: string | RegExp) {
    const parts = [ { type: 'root', content: [] } ]
    let part = 0

    if (splitter === ' ') {
      for (const node of ast.content) {
        if (node.type === 'whitespace') {
          parts.push({ type: 'root', content: [] })
          part = parts.length - 1
        }
        else {
          parts[part].content.push(node)
        }
      }
      return parts.filter(part => part.content.length)
    }

    while (ast.content.length) {
      if (this.splitter(ast.content, splitter as RegExp)) {
        parts.push({ type: 'root', content: [] })
        part = parts.length - 1
      }
      else {
        parts[part].content.push(ast.content.shift())
      }
    }
    return parts
  }
}

function parseCreator(ast, type): Creator {
  if (ast.content.length === 1 && ast.content[0].type === 'group') return { type, name: stringifier.stringify(ast, { mode: 'creator' }) }

  if (ast.content.find(node => node.type === 'string' && node.content === ',')) {
    const nameparts = splitter
      .split(ast, ',')
      .map(part => stringifier.stringify(part, { mode: 'creator' }))
      .map(part => part.match(/^([^=]+)=(.*)/)?.slice(1, 3) || ['', part])
    if (!nameparts.find(p => p[0])) {
      let [family, suffix, given] = nameparts.length === 2
        ? [nameparts[0][1], undefined, nameparts[1][1]]
        // > 3 nameparts are invalid and are dropped
        : nameparts.slice(0, 3).map(p => p[1])
      let prefix
      const m = family.match(/^([a-z'. ]+) (.+)/)
      if (m) {
        prefix = m[1]
        family = m[2]
      }
      return {
        type,
        family,
        given,
        ...(typeof prefix === 'undefined' ? {} : { prefix }),
        ...(typeof suffix === 'undefined' ? {} : { suffix }),
      }
    }

    const name: Creator = { type }
    for (let [attr, value] of nameparts) {
      attr = attr.toLowerCase()
      switch (attr) {
        case '':
          break

        case 'given-i':
          name.initial = value
          break

        case 'useprefix':
        case 'juniorcomma':
          name[attr] = value.toLowerCase() === 'true'
          break

        default:
          name[attr] = value
          break
      }
    }
    return name
  }
  else {
    const nameparts = splitter.split(ast, ' ').map(part => stringifier.stringify(part, { mode: 'creator' })).filter(n => n)
    if (nameparts.length === 1) return { type, name: nameparts[0] }
    const prefix = nameparts.findIndex(n => n.match(/^[a-z]/))
    if (prefix > 0) return { type, given: nameparts.slice(0, prefix).join(' '), family: nameparts.slice(prefix).join(' ') }
    return { type, family: nameparts.pop(), given: nameparts.join(' ') }
  }
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

function wraparg(node) : Argument {
  return { type: 'argument', content: [ node ], openMark: '', closeMark: '' }
}
function argtogroup(node: Argument): Group {
  if (node.content.length === 1 && node.content[0].type === 'group') return node.content[0]
  return { type: 'group', content: node.content }
}
function argument(nodes) {
  if (!nodes.length) return false
  if (nodes[0].type === 'whitespace') nodes.shift()
  if (!nodes.length) return false
  return wraparg(nodes.shift())
}

const stringifier = new class {
  private tags = {
    enquote: { open: '\u201c', close: '\u201d' },
  }
  wrap(text: string, tag, wrap = true) {
    if (!text) return ''
    if (!wrap) return text
    if (!this.tags[tag]) this.tags[tag] = { open: `<${tag}>`, close: `</${tag}>` }
    const { open, close } = this.tags[tag]
    return `${open}${text}${close}`
  }

  macro(node, context) {
    switch (node.content) {
      case 'vphantom':
      case 'noopsort':
        return ''

      case 'textsc':
      case 'textrm':
      case 'texttt':
      case 'mathrm':
      case 'mbox':
        return node.args.map(n => this.stringify(n, context)).join('')

      case 'href':
      case 'url':
        return `<a href="${this.stringify(node.args?.[0], context)}">${this.stringify(node.args?.[node.content === 'url' ? 0 : 1], context)}</a>`

      case 'aap':
      case 'ud':
      case 'path':

      case 'em':
      case 'it':
      case 'tt':
      case 'sl':
        return ''

      case 'rm':
      case 'sc':
        return ''

      case 'textbf':
        return this.wrap(this.stringify(node.args?.[0], context), 'b')

      case 'textit':
      case 'emph':
        return this.wrap(this.stringify(node.args?.[0], context), 'i')

      case 'textsuperscript':
      case '^':
        return this.wrap(this.stringify(node.args?.[0], context), 'sup')

      case 'textsubscript':
      case '_':
        return this.wrap(this.stringify(node.args?.[0], context), 'sub')

      case 'enquote':
        return this.wrap(this.stringify(node.args?.[0], context), 'enquote')

      case '\\':
        return context.mode === 'html' ? '<b>' : ' '

      case 'par':
        return context.mode === 'html' ? '<p>' : ' '

      case 'item':
        return context.mode === 'html' ? '<li>' : ' '

      case 'section':
      case 'subsection':
      case 'subsubsection':
      case 'subsubsubsection':
        return this.wrap(this.stringify(node.args?.[0], context), `h${node.content.split('sub').length}`)

      case 'frac':
        return `${this.stringify(node.args?.[0], context)}\u2044${this.stringify(node.args?.[1], context)}`

      // a bit cheaty to assume these to be nocased, but it's just more likely to be what people want
      case 'chsf':
      case 'bibstring':
      case 'cite':
        return this.wrap(this.stringify(node.args?.[0], context), 'nc', context.mode === 'title')

      default:
        throw new Error(`unhandled macro ${JSON.stringify(node)} ${printRaw(node)}`)
    }
  }

  environment(node, context) {
    switch (node.env) {
      case 'quotation':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'blockquote', context.mode === 'html')

      case 'itemize':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'ul', context.mode === 'html')

      default:
        throw new Error(`unhandled environment ${printRaw(node)}`)
    }
  }

  stringify(node, context) {
    if (!node) return ''

    switch (node.type) {
      case 'root':
      case 'argument':
        return node.content.map(n => this.stringify(n, context)).join('')

      case 'group':
      case 'inlinemath':
        return this.wrap(
          node.content.map(n => this.stringify(n, {...context, caseProtected: context.caseProtected || node._renderInfo.protectCase })).join(''),
          'nc',
          context.mode === 'title' && !context.caseProtected && node._renderInfo.protectCase
        )

      case 'string':
      case 'verbatim':
        return node.content

      case 'macro':
        return this.macro(node, context)

      case 'parbreak':
        return context.mode === 'html' ? '<p>' : ' '

      case 'whitespace':
        return ' '

      case 'comment':
        return ''

      case 'environment':
        return this.environment(node, context)

      case 'verb':
        return node.content

      default:
        throw new Error(`unhandled ${node.type} ${printRaw(node)}`)
    }
  }
}

function convert(entry: Entry, field: string, value: string) {
  let mode = ''
  for (const [selected, fields] of Object.entries(fieldMode)) {
    if (fields.find(match => typeof match === 'string' ? field === match : field.match(match))) mode = selected
  }

  if (mode === 'verbatim') {
    entry[field] = value
    return
  }

  const ast = LatexPegParser.parse(value)
  if (fieldAction.unnest.includes(field) && ast.content.length === 1 && ast.content[0].type === 'group') {
    ast.content = ast.content[0].content
  }

  // pass 1 -- mark & normalize
  visit(ast, (nodes, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
    if (!Array.isArray(nodes)) {
      delete nodes.position
      if (!nodes._renderInfo) nodes._renderInfo = {}

      if (nodes.type === 'macro' && typeof nodes.escapeToken !== 'string') nodes.escapeToken = '\\'

      if (info.context.inMathMode || info.context.hasMathModeAncestor) return

      if (nodes.type === 'inlinemath' || (nodes.type === 'group' && nodes.content[0]?.type !== 'macro')) {
        nodes._renderInfo.protectCase = true
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
        node.args = Array(narguments[node.content]).fill(undefined).map(i => argument(nodes)).filter(arg => arg !== false)
        if (node.content.match(/^(url|href)$/) && node.args.length) {
          node.args[0] = { type: 'string', content: printRaw(node.args[0].content) }
        }
      }

      compacted.push(node)
    }

    nodes.push(...compacted)
  }, { includeArrays: true })

  replaceNode(ast, (node, info) => {
    if (node.type !== 'macro') return

    if (node.escapeToken && combining.tounicode[node.content]) {
      if (!node.args || !node.args.length) node.args = [ wraparg({ type: 'string', content: ' ' }) ]
      if (node.args.length > 1) return
      if (node.args[0].content.length !== 1) return
      let arg = node.args[0].content[0]
      if (arg.type === 'group') {
        if (arg.content.length > 1) return
        arg = arg.content[0]
      }
      switch (arg.type) {
        case 'verbatim':
        case 'string':
          return { type: 'string', content: `${arg.content}${combining.tounicode[node.content]}` }
        default:
          return
      }
    }

    let latex = `${node.escapeToken}${node.content}`
    latex += (node.args || []).map(arg => printRaw(argtogroup(arg))).join('')
    if (latex in latex2unicode) return { type: 'string', content: latex2unicode[latex] }
    // return null to delete
  })

  switch (mode) {
    case 'creator':
      entry.creators = [ ...(entry.creators as Creator[]), ...(splitter.split(ast, /^and$/i).map(name => parseCreator(name, field)) as Creator[]) ]
      break
    case 'commalist':
      entry[field] = splitter.split(ast, /^[;,]$/).map(elt => stringifier.stringify(elt, {}))
      break
    case 'literallist':
      entry[field] = splitter.split(ast, /^and$/i).map(elt => stringifier.stringify(elt, {}))
      break
    default:
      entry[field] = stringifier.stringify(ast, { mode })
      if (fieldAction.unabbrev.includes(field)) entry[field] = unabbreviate[entry[field] as string] || entry[field]
      if (entry[field].match(/^[0-9]+$/)) entry[field] = parseInt(entry[field])
      break
  }
}

for (let bibfile of glob('test/better-bibtex/*/*.bib*')) {
  const bib = bibtex.entries(fs.readFileSync(bibfile, 'utf-8')).entries
  for (const verbatim of bib) {
    const entry: Entry = { type: verbatim.type, key: verbatim.key, creators: [] }
    for (const [field, value] of Object.entries(verbatim.fields)) {
      convert(entry, field.toLowerCase(), value)
    }
    console.log(JSON.stringify(entry, null, 2))
  }
}
