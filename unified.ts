/* eslint-disable no-underscore-dangle */
import { Root, Macro, String as StringNode, Node, Argument, Group, Environment } from '@unified-latex/unified-latex-types'
import { replaceNode } from '@unified-latex/unified-latex-util-replace'
import { LatexPegParser } from '@unified-latex/unified-latex-util-pegjs'
import { visit } from '@unified-latex/unified-latex-util-visit'
import { printRaw } from '@unified-latex/unified-latex-util-print-raw'
import { latex2unicode, combining } from 'unicode2latex'
import * as bibtex from './chunker'
import * as JabRef from './jabref'

import crossref from './crossref.json'
import allowed from './fields.json'
const unabbreviate = require('./unabbrev.json')

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
   * By default, when a TeX command is encountered which the parser does not know about, the parser will throw an error. You can pass a function here to return the appropriate text output for the command.
   */
  unsupported?: 'ignore' | unsupportedHandler

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
  crossref?: {
    donated: string[]
    inherited: string[]
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
for (const m in combining.tounicode) { // eslint-disable-line guard-for-in
  narguments[m] = 1
}

type unsupportedHandler = (node: Node, tex?: string, entry?: Entry) => string | undefined

type Context = {
  mode: ParseMode
  caseProtected?: boolean
}

async function* asyncGenerator<T>(array: T[]): AsyncGenerator<T, void, unknown> {
  for (const item of array) {
    yield await Promise.resolve(item)
  }
}

class BibTeXParser {
  private fallback: unsupportedHandler
  private current: Entry

  private splitter(nodes: Node[], splitter: RegExp): boolean {
    // eslint-disable-next-line no-magic-numbers
    const types = nodes.slice(0, 3).map(n => n.type === 'string' && n.content.match(splitter) ? 'splitter' : n.type).join(',')
    const match = /^(whitespace,?)?(splitter)(,?whitespace)?/.exec(types)
    if (!match) return false
    nodes.splice(0, match.slice(1).filter(t => t).length)
    return true
  }

  private split(ast: Group | Root, splitter: string | RegExp): Root[] {
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

  private parseCreator(ast: Root): Creator {
    if (ast.content.length === 1 && ast.content[0].type === 'group') return { name: this.stringify(ast, { mode: 'creator' }) }

    if (ast.content.find(node => node.type === 'string' && node.content === ',')) {
      const nameparts: string[][] = this.split(ast, ',')
        .map((part: Node) => this.stringify(part, { mode: 'creator' }))
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

          case 'given':
            name.firstName = value
            break
          case 'family':
            name.lastName = value
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
      const nameparts = this.split(ast, ' ').map(part => this.stringify(part, { mode: 'creator' })).filter(n => n)
      if (nameparts.length === 1) return { name: nameparts[0] }
      const prefix = nameparts.findIndex(n => n.match(/^[a-z]/))
      if (prefix > 0) return { firstName: nameparts.slice(0, prefix).join(' '), lastName: nameparts.slice(prefix).join(' ') }
      return { lastName: nameparts.pop(), firstName: nameparts.join(' ') }
    }
  }

  private ligature(nodes: Node[]): StringNode {
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

  private wraparg(node) : Argument {
    return { type: 'argument', content: [ node ], openMark: '', closeMark: '' }
  }
  private argtogroup(node: Argument): Group {
    if (node.content.length === 1 && node.content[0].type === 'group') return node.content[0]
    return { type: 'group', content: node.content }
  }
  private argument(nodes: Node[]): Argument {
    if (!nodes.length) return null
    if (nodes[0].type === 'whitespace') nodes.shift()
    if (!nodes.length) return null
    if (nodes[0].type === 'string') {
      const char = nodes[0].content[0]
      nodes[0].content = nodes[0].content.substr(1)
      if (!nodes[0].content) nodes.shift()
      return this.wraparg({ type: 'string', content: char })
    }
    return this.wraparg(nodes.shift())
  }

  // stringifier
  private tags = {
    enquote: { open: '\u201c', close: '\u201d' },
  }

  private unsupported(node: Node): string {
    if (this.fallback) return this.fallback(node, printRaw(node), this.current) ?? ''

    switch (node.type) {
      case 'macro':
        throw new Error(`unhandled ${node.type} ${node.content} (${printRaw(node)})`)
      case 'environment':
        throw new Error(`unhandled ${node.type} ${node.env} (${printRaw(node)})`)
      default:
        throw new Error(`unhandled ${node.type} (${printRaw(node)})`)
    }
  }

  private wrap(text: string, tag, wrap=true): string {
    if (!text) return ''
    if (!wrap) return text
    if (!this.tags[tag]) this.tags[tag] = { open: `<${tag}>`, close: `</${tag}>` }
    const { open, close } = this.tags[tag]
    return `${open}${text}${close}`
  }

  private macro(node: Macro, context: Context): string {
    const text = latex2unicode[printRaw(node)]
    if (text) return text

    let url: Argument
    let label: Argument
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

      case 'textup':
      case 'textsc':
      case 'textrm':
      case 'texttt':
      case 'mathrm':
      case 'mbox':
        return node.args.map(n => this.stringify(n, context)).join('')

      case 'href':
      case 'url':
        if (node.args) {
          url = node.args[0]
          label = node.args[node.content === 'url' ? 0 : 1]
        }
        return `<a href="${this.stringify(url, context)}">${this.stringify(label, context)}</a>`

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
      case 'mkbibbold':
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
      case 'textcite':
      case 'citeauthor':
        return this.wrap(this.stringify(node.args?.[0], context), 'nc', context.mode === 'title')

      default:
        return this.unsupported(node)
    }
  }

  private environment(node: Environment, context: Context) {
    if (node.content.length && node.content[0].type === 'whitespace') node.content.shift()
    if (node.content.length && node.content[node.content.length - 1].type === 'whitespace') node.content.pop()

    switch (node.env) {
      case 'quotation':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'blockquote', context.mode === 'html')

      case 'itemize':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'ul', context.mode === 'html')

      case 'em':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'i', context.mode === 'html')

      default:
        return this.unsupported(node)
    }
  }

  private stringify(node: Node | Argument, context: Context): string {
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
          (context.mode === 'title') && !context.caseProtected && !!node._renderInfo.protectCase
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
        return this.unsupported(node)
    }
  }

  private protect(node) {
    if (node.type === 'inlinemath') return true
    if (node.type !== 'group') return false
    if (!node.content.length) return false
    return (node.content[0].type !== 'macro')
  }

  private field(entry: Entry, field: string, value: string) {
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
      // only root groups offer case protecten -- but it may be as an macro arg, so mark here before gobbling
      if (this.protect(node)) node._renderInfo = { protectCase: true }
    }

    // pass 1 -- mark & normalize
    visit(ast, (nodes, _info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
      if (!Array.isArray(nodes)) {
        delete nodes.position
        if (!nodes._renderInfo) nodes._renderInfo = {}

        if (nodes.type === 'macro' && typeof nodes.escapeToken !== 'string') nodes.escapeToken = '\\'

        // if (info.context.inMathMode || info.context.hasMathModeAncestor) return
        return
      }

      let node: Node
      const compacted: Node[] = []
      while (nodes.length) {
        if (node = this.ligature(nodes)) {
          compacted.push(node)
          continue
        }

        node = nodes.shift()
        if (node.type === 'macro' && narguments[node.content]) {
          node.args = Array(narguments[node.content]).fill(undefined).map(_i => this.argument(nodes)).filter(arg => arg)
          if (node.content.match(/^(url|href)$/) && node.args.length) {
            let url: Node[] = node.args[0].content
            if (url.length === 1 && url[0].type === 'group') url = url[0].content
            node.args[0] = this.wraparg({ type: 'string', content: printRaw(url) })
          }
        }
        else if (node.type === 'macro' && node.content.match(/^[a-z]+$/) && nodes[0]?.type === 'whitespace') {
          nodes.shift()
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
      latex += (node.args || []).map(arg => printRaw(this.argtogroup(arg))).join('')
      if (latex in latex2unicode) return { type: 'string', content: latex2unicode[latex] }
      // return null to delete
    })

    switch (mode) {
      case 'creator':
        entry.fields[field] = this.split(ast, /^and$/i).map(cr => this.parseCreator(cr))
        break
      case 'commalist':
        entry.fields[field] = this.split(ast, /^[;,]$/).map(elt => this.stringify(elt, { mode: 'literal'}))
        break
      case 'literallist':
        entry.fields[field] = this.split(ast, /^and$/i).map(elt => this.stringify(elt, { mode: 'literal'}))
        break
      default:
        entry.fields[field] = this.stringify(ast, { mode })
        if (FieldAction.unabbrev.includes(field)) entry.fields[field] = unabbreviate[entry.fields[field] as string] || entry.fields[field]
        if ((entry.fields[field] as string).match(/^[0-9]+$/)) entry.fields[field] = parseInt(entry.fields[field] as string)
        break
    }
  }

  private applyCrossrefField(parent: Entry, parentfield: string, child: Entry, childfield: string) {
    if (child.fields[childfield] || !parent.fields[parentfield]) return false

    const register = (arr: string[], elt: string) => [...(new Set([...arr, elt]))].sort()

    child.fields[childfield] = parent.fields[parentfield]

    child.crossref.inherited = register(child.crossref.inherited, childfield)
    parent.crossref.donated = register(parent.crossref.donated, parentfield)

    return true
  }

  private applyCrossref(entry: Entry, entries: Entry[]) {
    entry.crossref = entry.crossref || { donated: [], inherited: [] }
    if (!entry.fields.crossref) return

    const parent = entries.find(p => p.key === entry.fields.crossref)

    // first apply crossref on parent, because inheritance can chain
    this.applyCrossref(parent, entries)

    let applied = false
    for (const mappings of [crossref[entry.type], crossref['*']].filter(m => m)) {
      for (const mapping of [mappings[parent.type], mappings['*']].filter(m => m)) {
        for (const [target, source] of Object.entries(mapping as Record<string, string>)) {
          if (this.applyCrossrefField(parent, source, entry, target)) applied = true
        }

        for (const field of (allowed[entry.type] || []) as string[]) {
          if (this.applyCrossrefField(parent, field, entry, field)) applied = true
        }
      }
    }

    // prevent loops
    if (applied) delete entry.fields.crossref
  }

  private empty(options: ParserOptions = {}): Bibliography {
    this.fallback = options.unsupported === 'ignore' ? ((_node: Node, _tex: string): string => '') : options.unsupported

    return {
      errors: [],
      entries: [],
      comments: [],
      strings: {},
      preamble: [],
      jabref: null,
    }
  }

  private reparse(bib: Bibliography, entry: bibtex.Entry) {
    this.current = entry
    try {
      for (const [field, value] of Object.entries(entry.fields)) {
        this.field(entry, field, value)
      }
      bib.entries.push(entry as Entry)
    }
    catch (err) {
      bib.errors.push({ error: `${err.message}\n${entry.input}`, input: entry.input })
    }
  }

  private finalize(bib: Bibliography, base: bibtex.Bibliography, options) {
    if (options.applyCrossRef ?? true) {
      for (const entry of bib.entries) {
        this.applyCrossref(entry, bib.entries)
      }
    }

    const s: Entry = { key: '', type: '', fields: {} }
    for (const [k, v] of Object.entries(base.strings)) {
      this.field(s, 'string', v)
      bib.strings[k] = s.fields.string as string
    }

    const { comments, jabref } = JabRef.parse(base.comments)
    bib.comments = comments
    bib.jabref = jabref

    bib.preamble = base.preambles
    bib.errors = [...base.errors, ...bib.errors]
  }

  public parse(input: string, options: ParserOptions = {}): Bibliography {
    const bib: Bibliography = this.empty(options)

    const base = bibtex.parse(input)

    for (const entry of base.entries) {
      this.reparse(bib, entry)
    }

    this.finalize(bib, base, options)
    return bib
  }

  public async parseAsync(input: string, options: ParserOptions = {}): Promise<Bibliography> {
    const bib: Bibliography = this.empty(options)

    const base = await bibtex.promises.parse(input)

    for await (const entry of asyncGenerator(base.entries)) {
      this.reparse(bib, entry)
    }

    this.finalize(bib, base, options)
    return bib
  }
}
export const Parser = new BibTeXParser
