/* eslint-disable no-underscore-dangle */
import { Root, Macro, String as StringNode, Node, Argument, Group, Environment } from '@unified-latex/unified-latex-types'
import { replaceNode } from '@unified-latex/unified-latex-util-replace'
import { LatexPegParser } from '@unified-latex/unified-latex-util-pegjs'
import { visit } from '@unified-latex/unified-latex-util-visit'
import { printRaw } from '@unified-latex/unified-latex-util-print-raw'
import { latex2unicode, combining } from 'unicode2latex'
import * as bibtex from './chunker'
import * as JabRef from './jabref'

const unabbreviate = require('./unabbrev.json')

interface Creator {
  name?: string
  lastName?: string
  firstName?: string
  prefix?: string
  suffix?: string
  initial?: string
  useprefix?: boolean
  juniorcomma?: boolean
}

interface Entry {
  type: string
  key: string
  fields: {
    author?: Creator[]
    bookauthor?: Creator[]
    collaborator?: Creator[]
    commentator?: Creator[]
    director?: Creator[]
    editor?: Creator[]
    editora?: Creator[]
    editorb?: Creator[]
    editors?: Creator[]
    holder?: Creator[]
    scriptwriter?: Creator[]
    translator?: Creator[]

    keywords?: string[]
    institution?: string[]
    publisher?: string[]
    origpublisher?: string[]
    organization?: string[]
    location?: string[]
    origlocation?: string[]

    [key: string]: number | string | string[] | Creator[]
  }
}

export const FieldMode = {
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

type ParseMode = keyof typeof FieldMode | 'literal'

const FieldAction = {
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

const Splitter = new class {
  private splitter(nodes: Node[], splitter: RegExp): boolean {
    // eslint-disable-next-line no-magic-numbers
    const types = nodes.slice(0, 3).map(n => n.type === 'string' && n.content.match(splitter) ? 'splitter' : n.type).join(',')
    const match = /^(whitespace,?)?(splitter)(,?whitespace)?/.exec(types)
    if (!match) return false
    nodes.splice(0, match.slice(1).filter(t => t).length)
    return true
  }

  split(ast: Group | Root, splitter: string | RegExp): Root[] {
    const parts: Root[] = [ { type: 'root', content: [] } ]
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
      return parts.filter(p => p.content.length)
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

function parseCreator(ast: Root): Creator {
  if (ast.content.length === 1 && ast.content[0].type === 'group') return { name: Stringifier.stringify(ast, { mode: 'creator' }) }

  if (ast.content.find(node => node.type === 'string' && node.content === ',')) {
    const nameparts: string[][] = Splitter.split(ast, ',')
      .map((part: Node) => Stringifier.stringify(part, { mode: 'creator' }))
      // eslint-disable-next-line no-magic-numbers
      .map((part: string) => part.match(/^([^=]+)=(.*)/)?.slice(1, 3) || ['', part])

    if (!nameparts.find(p => p[0])) {
      let [lastName, suffix, firstName] = nameparts.length === 2
        ? [nameparts[0][1], undefined, nameparts[1][1]]
        // > 3 nameparts are invalid and are dropped
        // eslint-disable-next-line no-magic-numbers
        : nameparts.slice(0, 3).map(p => p[1])
      let prefix
      const m = lastName.match(/^([a-z'. ]+) (.+)/)
      if (m) {
        prefix = m[1]
        lastName = m[2]
      }
      return {
        lastName,
        firstName,
        ...(typeof prefix === 'undefined' ? {} : { prefix }),
        ...(typeof suffix === 'undefined' ? {} : { suffix }),
      }
    }

    const name: Creator = {}
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
    const nameparts = Splitter.split(ast, ' ').map(part => Stringifier.stringify(part, { mode: 'creator' })).filter(n => n)
    if (nameparts.length === 1) return { name: nameparts[0] }
    const prefix = nameparts.findIndex(n => n.match(/^[a-z]/))
    if (prefix > 0) return { firstName: nameparts.slice(0, prefix).join(' '), lastName: nameparts.slice(prefix).join(' ') }
    return { lastName: nameparts.pop(), firstName: nameparts.join(' ') }
  }
}

function ligature(nodes: Node[]): StringNode {
  const max = 3
  const type = nodes.slice(0, max).map(n => n.type === 'string' ? 's' : ' ').join('')
  if (type[0] !== 's') return null

  const content = nodes.slice(0, max).map(n => n.type === 'string' ? n.content : '')
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

  return null
}

function wraparg(node) : Argument {
  return { type: 'argument', content: [ node ], openMark: '', closeMark: '' }
}
function argtogroup(node: Argument): Group {
  if (node.content.length === 1 && node.content[0].type === 'group') return node.content[0]
  return { type: 'group', content: node.content }
}
function argument(nodes: Node[]): Argument {
  if (!nodes.length) return null
  if (nodes[0].type === 'whitespace') nodes.shift()
  if (!nodes.length) return null
  if (nodes[0].type === 'string') {
    const char = nodes[0].content[0]
    nodes[0].content = nodes[0].content.substr(1)
    if (!nodes[0].content) nodes.shift()
    return wraparg({ type: 'string', content: char })
  }
  return wraparg(nodes.shift())
}

type StringifierContext = {
  mode: ParseMode
  caseProtected?: boolean
}

const Stringifier = new class {
  private tags = {
    enquote: { open: '\u201c', close: '\u201d' },
  }

  wrap(text: string, tag, wrap = true): string {
    if (!text) return ''
    if (!wrap) return text
    if (!this.tags[tag]) this.tags[tag] = { open: `<${tag}>`, close: `</${tag}>` }
    const { open, close } = this.tags[tag]
    return `${open}${text}${close}`
  }

  macro(node: Macro, context: StringifierContext): string {
    const text = latex2unicode[printRaw(node)]
    if (text) return text

    switch (node.content) {
      case 'LaTeX':
        return 'LaTeX'

      case 'vphantom':
      case 'noopsort':
        return ''

      case 'hspace':
        if (node.args && node.args.length) {
          if (printRaw(node.args).match(/^[{]?0[a-z]*$/)) return ''
          return ' '
        }
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

      case 'relax':
      case 'aftergroup':
      case 'ignorespaces':
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
      case 'mkbibemph':
        return this.wrap(this.stringify(node.args?.[0], context), 'i')

      case 'textsuperscript':
      case '^':
        return this.wrap(this.stringify(node.args?.[0], context), 'sup')

      case 'textsubscript':
      case '_':
        return this.wrap(this.stringify(node.args?.[0], context), 'sub')

      case 'enquote':
      case 'mkbibquote':
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
        throw new Error(`unhandled macro ${node.content} ${printRaw(node)}`)
    }
  }

  environment(node: Environment, context: StringifierContext) {
    switch (node.env) {
      case 'quotation':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'blockquote', context.mode === 'html')

      case 'itemize':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'ul', context.mode === 'html')

      default:
        throw new Error(`unhandled environment ${printRaw(node)}`)
    }
  }

  stringify(node: Node | Argument, context: StringifierContext): string {
    if (!node) return ''

    switch (node.type) {
      case 'root':
      case 'argument':
        return node.content.map(n => this.stringify(n, context)).join('')

      case 'group':
      case 'inlinemath':
        return this.wrap(
          node.content.map(n => this.stringify(n, {...context, caseProtected: (context.caseProtected || node._renderInfo.protectCase) as boolean})).join(''),
          'nc',
          (context.mode === 'title') && !context.caseProtected && (node._renderInfo.protectCase as boolean)
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
        throw new Error(`unhandled ${node.type} ${printRaw(node as Node)}`)
    }
  }
}

function convert(entry: Entry, field: string, value: string) {
  let mode: ParseMode = 'literal'
  for (const [selected, fields] of Object.entries(FieldMode)) {
    if (fields.find(match => typeof match === 'string' ? field === match : field.match(match))) mode = selected as ParseMode
  }

  if (mode === 'verbatim') {
    entry.fields[field] = value
    return
  }

  const ast: Root = LatexPegParser.parse(value)
  if (FieldAction.unnest.includes(field) && ast.content.length === 1 && ast.content[0].type === 'group') {
    ast.content = ast.content[0].content
  }

  for (const node of ast.content) {
    delete node.position
    // only root groups offer case protecten -- but it may be as an macro arg, so mark here before gobbling
    if (node.type === 'inlinemath' || (node.type === 'group' && node.content[0]?.type !== 'macro')) {
      node._renderInfo = { protectCase: true }
    }
  }

  // pass 1 -- mark & normalize
  visit(ast, (nodes, _info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
    if (!Array.isArray(nodes)) {
      if (!nodes._renderInfo) nodes._renderInfo = {}

      if (nodes.type === 'macro' && typeof nodes.escapeToken !== 'string') nodes.escapeToken = '\\'

      // if (info.context.inMathMode || info.context.hasMathModeAncestor) return
      return
    }

    let node: Node
    const compacted: Node[] = []
    while (nodes.length) {
      if (node = ligature(nodes)) {
        compacted.push(node)
        continue
      }

      node = nodes.shift()
      if (node.type === 'macro' && narguments[node.content]) {
        node.args = Array(narguments[node.content]).fill(undefined).map(_i => argument(nodes)).filter(arg => arg)
        if (node.content.match(/^(url|href)$/) && node.args.length) {
          node.args[0] = wraparg({ type: 'string', content: printRaw(node.args[0].content) })
        }
      }

      compacted.push(node)
    }

    nodes.push(...compacted)
  }, { includeArrays: true })

  replaceNode(ast, (node, _info) => {
    if (node.type !== 'macro') return

    if (node.escapeToken && combining.tounicode[node.content]) {
      let arg: Node
      // no args, args of zero length, or first arg has no content
      if (!node.args || node.args.length === 0 || node.args[0].content.length === 0) {
        arg = { type: 'string', content: ' ' }
      }
      else if (node.args.length !== 1 || node.args[0].content.length !== 1) {
        return
      }
      else {
        arg = node.args[0].content[0]
      }

      if (arg.type === 'group') {
        switch (arg.content.length) {
          case 0:
            arg = { type: 'string', content: ' ' }
            break
          case 1:
            arg = arg.content[0]
            break
          default:
            return
        }
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
      entry.fields[field] = Splitter.split(ast, /^and$/i).map(parseCreator)
      break
    case 'commalist':
      entry.fields[field] = Splitter.split(ast, /^[;,]$/).map(elt => Stringifier.stringify(elt, { mode: 'literal'}))
      break
    case 'literallist':
      entry.fields[field] = Splitter.split(ast, /^and$/i).map(elt => Stringifier.stringify(elt, { mode: 'literal'}))
      break
    default:
      entry.fields[field] = Stringifier.stringify(ast, { mode })
      if (FieldAction.unabbrev.includes(field)) entry.fields[field] = unabbreviate[entry.fields[field] as string] || entry.fields[field]
      if ((entry.fields[field] as string).match(/^[0-9]+$/)) entry.fields[field] = parseInt(entry.fields[field] as string)
      break
  }
}

// ----------------------------------------------------------

export interface Bibliography {
  /**
   * errors found while parsing
   */
  errors: bibtex.ParseError[]

  /**
   * entries in the order in which they are found, omitting those which could not be parsed.
   */
  entries: Entry[]

  /**
   * `@comment`s found in the bibtex file.
   */
  comments: string[]

  /**
   * `@string`s found in the bibtex file.
   */
  strings: Record<string, string>

  /**
   * `@preamble` declarations found in the bibtex file
   */
  preamble: string[]

  /**
   * jabref metadata (such as groups information) found in the bibtex file
   */
  jabref: JabRef.JabRefMetadata
}

export interface ParserOptions {
  /**
   * BibTeX files are expected to store title-type fields in Sentence Case, where other reference managers (such as Zotero) expect them to be stored as Sentence case. When there is no language field, or the language field
   * is one of the languages (case insensitive) passed in this option, the parser will attempt to sentence-case title-type fields as they are being parsed. This uses heuristics and does not employ any kind of natural
   * language processing, so you should always inspect the results. Default languages to sentenceCase are:
   *
   * - american
   * - british
   * - canadian
   * - english
   * - australian
   * - newzealand
   * - usenglish
   * - ukenglish
   * - en
   * - eng
   * - en-au
   * - en-bz
   * - en-ca
   * - en-cb
   * - en-gb
   * - en-ie
   * - en-jm
   * - en-nz
   * - en-ph
   * - en-tt
   * - en-us
   * - en-za
   * - en-zw
   *
   * If you pass an empty array, or `false`, no sentence casing will be applied (even when there's no language field).
   */
  sentenceCase?: string[] | boolean

  /**
   * If you have sentence-casing on, you can independently choose whether quoted titles within a title are preserved as-is (true) or also sentence-cased(false)
   */
  sentenceCasePreserveQuoted?: boolean

  /**
   * Some bibtex has titles in sentence case, or all-uppercase. If this is on, and there is a field that would normally have sentence-casing applied in which more words are all-`X`case
   * (where `X` is either lower or upper) than mixed-case, it is assumed that you want them this way, and no sentence-casing will be applied to that field
   */
  guessAlreadySentenceCased?: boolean

  /**
   * translate braced parts of text into a case-protected counterpart; uses the [[MarkupMapping]] table in `markup`. Default == true == as-needed.
   * In as-needed mode the parser will assume that words that have capitals in them imply "nocase" behavior in the consuming application. If you don't want this, turn this option on, and you'll get
   * case protection exactly as the input has it
   */
  caseProtection?: 'as-needed' | 'strict' | boolean

  /**
   * By default, when an unexpected parsing error is found (such as a TeX command which the parser does not know about), the parser will throw an error. You can pass a function to handle the error instead,
   * where you can log it, display it, or even still throw an error
   */
  errorHandler?: false | ((err: Error) => void)

  /**
   * By default, when a TeX command is encountered which the parser does not know about, the parser will throw an error. You can pass a function here to return the appropriate text output for the command.
   */
  unknownMacro?: false | ((macro: Macro) => string)

  /**
   * Some fields such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands. You can change the default list here if you want,
   * for example to help parse Mendeley `file` fields, which against spec are not in verbatim mode.
   */
  verbatimFields?: (string | RegExp)[]

  /**
   * In the past many bibtex entries would just always wrap a field in double braces, likely because whomever was writing them couldn't figure out the case meddling rules (and who could
   * blame them). Fields listed here will either have one outer layer of braces treated as case-preserve, or have the outer braced be ignored completely, if this is detected.
   */
  unnestFields?: string[]
  unnestMode?: 'preserve' | 'unwrap'

  /**
   * Some note-like fields may have more rich formatting. If listed here, more HTML conversions will be applied.
   */
  htmlFields?: string[]

  /**
   * If this flag is set entries will be returned without conversion of LaTeX to unicode equivalents.
   */
  raw?: boolean

  /**
   * You can pass in an existing @string dictionary
   */
  strings?: Record<string, string> | string

  /**
   * BibTeX files may have abbreviations in the journal field. If you provide a dictionary, journal names that are found in the dictionary are replaced with the attached full name
   */
  unabbreviate?: Record<string, string>

  /**
   * Apply crossref inheritance
   */
  applyCrossRef?: boolean
}

/**
 * parse bibtex. This will try to convert TeX commands into unicode equivalents, and apply `@string` expansion
 */
export function parse(input: string, _options: ParserOptions = {}): Bibliography {
  const base = bibtex.parse(input)
  const bib: Bibliography = {
    errors: base.errors,
    entries: [],
    comments: [],
    strings: {},
    preamble: base.preambles,
    jabref: null,
  }
  for (const entry of base.entries) {
    for (const [field, value] of Object.entries(entry.fields)) {
      convert(entry, field, value)
    }
    bib.entries.push(entry as Entry)
  }

  const s: Entry = { key: '', type: '', fields: {} }
  for (const [k, v] of Object.entries(base.strings)) {
    convert(s, 'string', v)
    bib.strings[k] = s.fields.string as string
  }

  const { comments, jabref } = JabRef.parse(base.comments)
  bib.comments = comments
  bib.jabref = jabref

  return bib
}

/*
export const promises = {
  async parse(input: string, options: ParserOptions = {}): Promise<Bibliography> { // eslint-disable-line prefer-arrow/prefer-arrow-functions
    const parser = new Parser(options)
    return await parser.parseAsync(input)
  },
}
*/

export { bibtex }

// import { globSync as glob } from 'glob'
// import * as fs from 'node:fs'
// for (const bibfile of glob('test/better-bibtex/*/*.bib*')) {
//   const bib = parse(fs.readFileSync(bibfile, 'utf-8')).entries
//   console.log(JSON.stringify(bib, null, 2))
// }
