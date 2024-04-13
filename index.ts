/* eslint-disable no-underscore-dangle */
import { Root, Macro, String as StringNode, Node, Argument, Group, Environment } from '@unified-latex/unified-latex-types'
import { replaceNode } from '@unified-latex/unified-latex-util-replace'
import { LatexPegParser } from '@unified-latex/unified-latex-util-pegjs'
import { visit } from '@unified-latex/unified-latex-util-visit'
import { printRaw } from '@unified-latex/unified-latex-util-print-raw'
import { latex2unicode as latex2unicodemap, combining } from 'unicode2latex'
import * as bibtex from './verbatim'
import * as JabRef from './jabref'
export { JabRefMetadata } from './jabref'
export { ParseError } from './verbatim'
export { toSentenceCase } from './sentence-case'
import { toSentenceCase } from './sentence-case'
import { tokenize } from './tokenizer'

import CrossRef from './crossref.json'
import allowed from './fields.json'
const unabbreviations: Record<string, string> = require('./unabbrev.json')

import { merge } from './merge'

function latexMode(node: Node | Argument): 'math' | 'text' {
  return node._renderInfo.mode as 'math' | 'text'
}

function latex2unicode(tex: string, node: Node): string {
  const text: string | Record<string, string> = latex2unicodemap[tex]
  if (typeof text === 'string') return text
  return text && text[latexMode(node)]
}

const open: Record<string, string> = {}
const close: Record<string, string> = {}
for (const tag of ['i', 'b', 'sc', 'nc', 'ncx', 'br', 'p', 'li', 'code']) {
  open[tag] = `\x0E${tag}\x0F`
  close[tag] = `\x0E/${tag}\x0F`
}
const collapsable = /\x0E\/([a-z]+)\x0F(\s*)\x0E\1\x0F/ig

type CreatorFields = {
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
}
type ArrayFields = {
  keywords?: string[]
  institution?: string[]
  publisher?: string[]
  origpublisher?: string[]
  organization?: string[]
  location?: string[]
  origlocation?: string[]
}
type TypedFields = CreatorFields & ArrayFields
type Fields = TypedFields & Omit<Record<string, string>, keyof TypedFields>

export type Entry = {
  type: string
  key: string
  fields: Fields
  mode: Record<string, ParseMode>
  crossref?: {
    inherited: string[]
    donated: string[]
  }
  input: string
}

const Month = {
  jan: '1',
  january: '1',
  feb: '2',
  february: '2',
  mar: '3',
  march: '3',
  apr: '4',
  april: '4',
  may: '5',
  jun: '6',
  june: '6',
  jul: '7',
  july: '7',
  aug: '8',
  august: '8',
  sep: '9',
  september: '9',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
}

export interface Library {
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

export interface Options {
  sentenceCase?: {
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
    langids?: string[] | boolean

    /**
      * By default, `langid` and `hyphenation` are used to determine whether an entry should be sentence-cased, but some sources (ab)use the `language` field
      * for this. If you turn on this option, this field will also be taken into account as a source for `langid`.
      */
    language?: boolean

    /**
     * Some bibtex files will have titles in sentence case, or all-uppercase. If this is on, and there is a field that would normally have sentence-casing applied in which there are all-lowercase words that are not prepositions
     * (where `X` is either lower or upper) than mixed-case, it is assumed that you want them this way, and no sentence-casing will be applied to that field
     */
    guess?: boolean

    /**
     * Capitalize sub-sentences after colons. Given the input title "Structured Interviewing For OCB: Construct Validity, Faking, And The Effects Of Question Type":
     * - when `true`, sentence-cases to "Structured interviewing for OCB: Construct validity, faking, and the effects of question type"
     * - when `false`, sentence-cases to "Structured interviewing for OCB: construct validity, faking, and the effects of question type"
     */
    subSentence?: boolean

    /**
     * If you have sentence-casing on, you can independently choose whether quoted titles within a title are preserved as-is (true) or also sentence-cased(false)
     */
    preserveQuoted?: boolean
  }

  /**
   * translate braced parts of text into a case-protected counterpart; Default == true == as-needed.
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
  removeOuterBraces?: string[]

  /**
   * Specify parsing mode for specific fields
   */
  fieldMode?: Record<string, ParseMode>

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
  unabbreviations?: boolean | Record<string, string>

  /**
   * Apply crossref inheritance
   */
  applyCrossRef?: boolean
}

export interface Creator {
  name?: string
  lastName?: string
  firstName?: string
  prefix?: string
  suffix?: string
  initial?: string
  useprefix?: boolean
  juniorcomma?: boolean
}

export const FieldMode = {
  creatorlist: [
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
    'subtitle',
    'series',
    'shorttitle',
    'booktitle',
    // 'type',
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
    /^keywords([+]duplicate-\d+)?$/,
    /^citeulike-linkout-[0-9]+$/,
    /^bdsk-url-[0-9]+$/,
  ],
  richtext: [
    'annotation',
    'comment',
    'annote',
    'review',
    'notes',
    'note',
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

type ParseMode = keyof typeof FieldMode | 'literal' | 'verbatimlist'

const English = [
  '',
  'american',
  'british',
  'canadian',
  'english',
  'australian',
  'newzealand',
  'usenglish',
  'ukenglish',
  'en',
  'eng',
  'en-au',
  'en-bz',
  'en-ca',
  'en-cb',
  'en-gb',
  'en-ie',
  'en-jm',
  'en-nz',
  'en-ph',
  'en-tt',
  'en-us',
  'en-za',
  'en-zw',
  'anglais', // don't do this people
]

const FieldAction = {
  removeOuterBraces: [
    'doi',
    // 'publisher',
    // 'location',
  ],
  unabbrev: [
    'journal',
    'journaltitle',
    'journal-full',
    'series',
  ],
  parseInt: [
    'year',
    'month',
  ],
  noCrossRef: [
    'file',
  ],
}

const narguments = {
  advance: 1,
  ElsevierGlyph: 1,
  bar: 1,
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
  hbox: 1,
  href: 2,
  hskip: 1,
  hspace: 1,
  ht: 1,
  mathrm: 1,
  mbox: 1,
  mkbibbold: 1,
  mkbibemph: 1,
  mkbibitalic: 1,
  mkbibquote: 1,
  newcommand: 2,
  noopsort: 1,
  ocirc: 1,
  overline: 1,
  ProvideTextCommandDefault: 2,
  rlap: 1,
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
  textsl: 1,
  textsubscript: 1,
  textsuperscript: 1,
  texttt: 1,
  textup: 1,
  url: 1,
  vphantom: 1,
  vspace: 1,
  wd: 1,

  // math
  'math\t_': 1,
  'math\t^': 1,
}
for (const m in combining.tounicode) { // eslint-disable-line guard-for-in
  narguments[m] = 1
}

type unsupportedHandler = (node: Node, tex: string, entry: Entry) => string

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
  private options: Options
  private fieldMode: typeof FieldMode
  private newcommands: Record<string, Argument> = {}
  private bib: Library
  private unhandled: Set<string> = new Set

  private split(ast: Group | Root, sep: RegExp, split: RegExp): Root[] {
    const roots: Root[] = []

    const nodes = [...ast.content]
    const types = nodes.map(node => {
      if (node.type === 'whitespace') return ' '
      if (node.type === 'string' && node.content.match(sep)) return '&'
      return '.'
    }).join('')

    types.split(split).forEach((match, i) => {
      const content = match.length ? nodes.splice(0, match.length) : []
      if ((i % 2) === 0) roots.push({ type: 'root', content })
    })

    return roots
  }

  private trimCreator(cr: Creator): Creator {
    // trims strings but coincidentally removes undefined fields
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(JSON.stringify(cr, (k, v) => typeof v === 'string' ? (v.trim() || undefined) : v)) as Creator
  }

  private parseCreator(ast: Root): Creator {
    if (ast.content.length === 1 && ast.content[0].type === 'group') return this.trimCreator({ name: this.stringify(ast, { mode: 'creatorlist' }) })

    if (ast.content.find(node => node.type === 'string' && node.content === ',')) {
      const nameparts: string[] = this.split(ast, /^,$/, /(&)/).map((part: Node) => this.stringify(part, { mode: 'creatorlist' }).trim())
      const extended = nameparts.every(p => p.match(/^[a-z][-a-z]+\s*=/i))

      if (!extended) {
        // eslint-disable-next-line no-magic-numbers
        if (nameparts.length === 3 && nameparts[2] === '') nameparts.pop()

        // eslint-disable-next-line no-magic-numbers
        if (nameparts.length > 3) {
          const key = this.current.key ? `@${this.current.key}: ` : ''
          this.bib.errors.push({
            // eslint-disable-next-line no-magic-numbers
            error: `${key}unexpected ${nameparts.length}-part name "${nameparts.join(', ')}", dropping "${nameparts.slice(3).join(', ')}"`,
            input: nameparts.join(', '),
          })
        }

        let [lastName, suffix, firstName] = (nameparts.length === 2)
          ? [nameparts[0], undefined, nameparts[1]]
          // > 3 nameparts are invalid and are dropped
          // eslint-disable-next-line no-magic-numbers
          : nameparts.slice(0, 3)
        let prefix
        const m = lastName.match(/^([a-z'. ]+) (.+)/)
        if (m) {
          prefix = m[1]
          lastName = m[2]
        }
        return this.trimCreator({
          lastName,
          firstName,
          prefix,
          suffix,
        })
      }

      const name: Creator = {}
      // eslint-disable-next-line no-magic-numbers
      for (let [attr, value] of nameparts.map(p => p.match(/^([^=]+)=(.*)/)?.slice(1, 3))) {
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
      return this.trimCreator(name)
    }
    else { // first-last mode
      const nameparts = this.split(ast, /^$/, /( )/).map(part => this.stringify(part, { mode: 'creatorlist' })).filter(n => n)
      if (nameparts.length === 1) return this.trimCreator({ lastName: nameparts[0] })

      const prefix = nameparts.findIndex(n => n.match(/^[a-z]/))
      const postfix = prefix <= 0 ? -1 : nameparts.findIndex((n, i) => i > prefix && !n.match(/^[a-z]/))
      if (postfix === -1) {
        const lastName = nameparts.pop()
        return this.trimCreator({ lastName, firstName: nameparts.join(' ') })
      }

      return this.trimCreator({
        firstName: nameparts.slice(0, prefix).join(' '),
        prefix: nameparts.slice(prefix, postfix).join(' '),
        lastName: nameparts.slice(postfix).join(' '),
      })
    }
  }

  private ligature(nodes: Node[]): StringNode {
    if (latexMode(nodes[0]) !== 'text') return null

    const max = 3
    const slice = nodes.slice(0, max)
    const type = slice.map(n => n.type === 'string' ? 's' : ' ').join('')
    if (type[0] !== 's') return null

    const content = slice.map(n => n.type === 'string' ? n.content : '')
    let latex: string

    while (content.length) {
      if (type.startsWith('s'.repeat(content.length)) && (latex = latex2unicode(content.join(''), slice[0]))) {
        try {
          return { type: 'string', content: latex, _renderInfo: {} }
        }
        finally {
          nodes.splice(0, content.length)
        }
      }
      content.pop()
    }

    return null
  }

  private wraparg(node: Node, macro: Macro) : Argument {
    if (macro.content.match(/^(itshape|textsl|textit|emph|mkbibemph)$/)) node._renderInfo.emph = true
    if (macro.content.match(/^(textbf|mkbibbold|bfseries)$/)) node._renderInfo.bold = true
    if (macro.content.match(/^(textsc)$/)) node._renderInfo.smallCaps = true
    if (macro.content.match(/^(texttt)$/)) node._renderInfo.code = true
    return { type: 'argument', content: [ node ], openMark: '', closeMark: '', _renderInfo: { mode: node._renderInfo.mode } }
  }

  private argtogroup(node: Argument): Group {
    if (node.content.length === 1 && node.content[0].type === 'group') return node.content[0]
    return { type: 'group', content: node.content }
  }

  private argument(nodes: Node[], macro: Macro): Argument {
    if (!nodes.length) return null
    if (nodes[0].type === 'whitespace') nodes.shift()
    if (!nodes.length) return null
    if (nodes[0].type === 'string') {
      const char = nodes[0].content[0]
      nodes[0].content = nodes[0].content.substr(1)
      const arg = { ...nodes[0], content: char }
      if (!nodes[0].content) nodes.shift()
      return this.wraparg(arg, macro)
    }
    return this.wraparg(nodes.shift(), macro)
  }

  private unsupported(node: Node): string {
    const tex = printRaw(node)
    if (this.fallback) return this.fallback(node, tex, this.current) ?? ''

    let id: string
    switch (node.type) {
      case 'macro':
        id = `${node.type}.${node.content}`
        if (!this.unhandled.has(id)) {
          this.unhandled.add(id)
          this.bib.errors.push({ error: `unhandled ${node.type} ${printRaw(node)}`, input: printRaw(node) })
        }
        break
      case 'environment':
        id = `${node.type}.${node.env}`
        if (!this.unhandled.has(id)) {
          this.unhandled.add(id)
          this.bib.errors.push({ error: `unhandled ${node.type} ${node.env} (${printRaw(node)})`, input: printRaw(node) })
        }
        break
      default:
        this.bib.errors.push({ error: `unhandled ${node.type} (${printRaw(node)})`, input: printRaw(node) })
        break
    }

    return tex
  }

  private wrap(text: string, tag, wrap=true): string {
    if (!text || !wrap) return text || ''
    return `\x0E${tag}\x0F${text}\x0E/${tag}\x0F`
  }

  private registercommand(node: Macro): string {
    const types = (nodes: Node[]) => nodes.map(n => n.type).join('.')

    const group = (arg: Argument, kind: string): Node[] => {
      if (!arg) throw new Error(`missing ${kind} for ${printRaw(node)} @ ${JSON.stringify(node.position)}`)
      if (types(arg.content) !== 'group') throw new Error(`Malformed ${kind} for ${printRaw(node)} @ ${JSON.stringify(node.position)}`)
      return (<Group>arg.content[0]).content
    }

    if (!node.args) throw new Error(`No arguments for ${printRaw(node)} @ ${JSON.stringify(node.position)}`)

    const namearg = group(node.args[0], 'name')
    if (types(namearg) !== 'macro') throw new Error(`Unexpected name for ${printRaw(node)} @ ${JSON.stringify(node.position)}`)

    this.newcommands[(<Macro>namearg[0]).content] = node.args[1]
    return ''
  }

  private subp(text: string, macro: string) {
    let subp = ''
    for (let char of text) {
      char = latex2unicodemap[`${macro}{${char}}`]
      if (char) {
        subp += char
      }
      else {
        const tag = {_: 'sub', '^': 'sup'}[macro]
        return `\x0E${tag}\x0F${text}\x0E/${tag}\x0F`
      }
    }
    return subp
  }

  private macro(node: Macro, context: Context): string {
    const text = latex2unicode(printRaw(node), node)
    if (text) return text

    let url: Argument
    let label: Argument
    let arg: string[]
    let resolved: string
    switch (node.content) {
      case 'newcommand':
      case 'ProvideTextCommandDefault':
        return this.registercommand(node)

      // too complex to deal with these
      case 'raise':
      case 'accent':
      case 'def':
      case 'hss':
      case 'ifmmode':
      case 'makeatletter':
      case 'makeatother':
      case 'scriptscriptstyle':
      case 'setbox':
      case 'dimen':
      case 'advance':
        return ''

      case 'vphantom':
      case 'noopsort':
      case 'left':
      case 'right':
      case 'ensuremath':
      case 'wd':
      case 'ht':
        return ''

      case 'path':
        return '' // until https://github.com/siefkenj/unified-latex/issues/94 is fixed

      case 'hspace':
      case 'hskip':
        if (node.args && node.args.length) {
          if (printRaw(node.args).match(/^[{]?0[a-z]*$/)) return ''
          return ' '
        }
        return ''

      case 'overline':
      case 'bar':
        return node.args.map(a => this.stringify(a, context)).join('').replace(/[a-z0-9]/ig, m => `${m}\u0305`)

      // accents dealt with by preprocessor
      case 'textup':
      case 'textsc':
      case 'textrm':
      case 'texttt':
      case 'mathrm':
      case 'mbox':
      case 'hbox':
      case 'rlap':
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

      // bold/emph/smallcaps is handled in the wrapper
      case 'textbf':
      case 'mkbibbold':
      case 'textit':
      case 'emph':
      case 'mkbibemph':
        return this.stringify(node.args?.[0], context)

      case 'textsuperscript':
        return this.subp(this.stringify(node.args?.[0], context), '^')

      case 'textsubscript':
        return this.subp(this.stringify(node.args?.[0], context), '_')

      case '_':
      case '^':
        switch (latexMode(node)) {
          case 'math':
            return this.subp(this.stringify(node.args?.[0], context), node.content)
          default:
            return node.content
        }

      case 'LaTeX':
        return this.wrap(`L${this.subp('A', '^')}T${this.subp('E', '_')}X`, 'ncx')

      case 'enquote':
      case 'mkbibquote':
        return this.wrap(this.stringify(node.args?.[0], context), 'enquote')

      case '\\':
        return context.mode === 'richtext' ? open.br : ' '

      case 'par':
        return context.mode === 'richtext' ? open.p : ' '

      case 'item':
        return context.mode === 'richtext' ? open.li : ' '

      case 'section':
      case 'subsection':
      case 'subsubsection':
      case 'subsubsubsection':
        return this.wrap(this.stringify(node.args?.[0], context), `h${node.content.split('sub').length}`)

      case 'frac':
        arg = node.args.map(a => this.stringify(a, context))
        if (arg.length === 2 && (resolved = latex2unicodemap[`\\frac${arg.map(a => `{${a}}`).join('')}`])) return resolved
        return arg.map((part, i) => this.subp(part, i ? '_' : '^')).join('\u2044')

      case 'chsf':
      case 'bibstring':
      case 'cite':
      case 'textcite':
      case 'citeauthor':
        // ncx protects but will be stripped later
        return this.wrap(this.stringify(node.args?.[0], context), 'ncx', context.mode === 'title')

      default:
        if (this.newcommands[node.content]) return this.stringify(this.newcommands[node.content], context)
        return this.unsupported(node)
    }
  }

  private what(node: Node) {
    if (!node) return ''

    switch (node.type) {
      case 'macro': return `macro:${<string>node._renderInfo.mode ?? 'text'}:${node.content}`
      case 'environment': return `env:${node.env}`
      default: return node.type
    }
  }
  private environment(node: Environment, context: Context) {
    while (node.content.length && this.what(node.content[0]).match(/^parbreak|whitespace|macro:text:par$/)) node.content.shift()
    while (node.content.length && this.what(node.content[node.content.length - 1]).match(/^parbreak|whitespace|macro:text:par$/)) node.content.pop()

    switch (node.env) {
      case 'quotation':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'blockquote', context.mode === 'richtext')

      case 'itemize':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'ul', context.mode === 'richtext')

      case 'em':
        return this.wrap(node.content.map(n => this.stringify(n, context)).join(''), 'i', context.mode === 'richtext')

      default:
        return this.unsupported(node)
    }
  }

  private stringify(node: Node | Argument, context: Context): string {
    let content = this.stringifyContent(node, context)
    if (content && node._renderInfo) {
      if (node._renderInfo.emph) content = `${open.i}${content}${close.i}`
      if (node._renderInfo.bold) content = `${open.b}${content}${close.b}`
      if (node._renderInfo.smallCaps) content = `${open.sc}${content}${close.sc}`
      if (node._renderInfo.code) content = `${open.code}${content}${close.code}`
      if (node._renderInfo.protectCase) content = `${open.nc}${content}${close.nc}`
    }
    return content
  }

  private stringifyContent(node: Node | Argument, context: Context): string {
    if (!node) return ''

    switch (node.type) {
      case 'root':
      case 'argument':
      case 'group':
      case 'inlinemath':
        return node.content.map(n => this.stringify(n, context)).join('')

      case 'string':
      case 'verbatim':
        return node.content

      case 'macro':
        return this.macro(node, context)

      case 'parbreak':
        return context.mode === 'richtext' ? open.p : ' '

      case 'whitespace':
        return node._renderInfo.mode === 'math' ? '' : ' '

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

  private mode(field: string): ParseMode {
    if (this.options.verbatimFields && this.options.verbatimFields.find(name => typeof name === 'string' ? (name === field) : field.match(name))) return 'verbatim'

    let mode: ParseMode = 'literal'
    for (const [selected, fields] of Object.entries(this.fieldMode)) {
      if (fields.find(match => typeof match === 'string' ? field === match : field.match(match))) mode = <ParseMode>selected
    }
    return mode
  }

  private restoreMarkup(s: string): string {
    if (!s.includes('\x0E')) return s

    const restored: string[] = [s.replace(/\x0E\/?ncx\x0F/ig, '')]
    while (restored[0] !== restored[1]) {
      restored.unshift(restored[0].replace(collapsable, '$2'))
    }

    return restored[0]
      .replace(/(\x0Ep\x0F\s*){2,}/ig, '\x0Ep\x0F')
      .replace(/\s*(\x0E\/p\x0F){2,}/ig, '\x0E/p\x0F')
      .replace(/\x0Eenquote\x0F/ig, '\u201C').replace(/\x0E\/enquote\x0F/ig, '\u201D')
      .replace(/\x0Esc\x0F/ig, '<span style="font-variant:small-caps;">').replace(/\x0E\/sc\x0F/ig, '</span>')
      .replace(/\x0Enc\x0F/ig, '<span class="nocase">').replace(/\x0E\/nc\x0F/ig, '</span>')
      .replace(/\x0E/ig, '<').replace(/\x0F/ig, '>')
  }

  private stringField(field: string, value: string, mode: string, sentenceCase: boolean, guess: boolean): string {
    if (FieldAction.unabbrev.includes(field)) {

      let full = this.options.unabbreviations[value.toUpperCase()] || this.options.unabbreviations[value.toUpperCase().replace(/s\S+$/, '')]
      if (!full) {
        const m = value.toUpperCase().match(/(.*)(\s+\S*\d\S*)$/)
        if (m) {
          full = this.options.unabbreviations[m[1]]
          if (full) full += m[2]
        }
      }
      if (full) value = full
      if (!sentenceCase) return value
    }

    if (field === 'crossref') return value

    if (FieldAction.parseInt.includes(field) && value.trim().match(/^-?\d+$/)) return `${parseInt(value)}`

    if (mode === 'title' && sentenceCase) {
      value = toSentenceCase(value, {
        preserveQuoted: this.options.sentenceCase.preserveQuoted,
        subSentenceCapitalization: this.options.sentenceCase.subSentence,
        markup: /\x0E\/?([a-z]+)\x0F/ig,
        nocase: /\x0E(ncx?)\x0F.*?\x0E\/\1\x0F/ig,
        guess,
      })

      let cancel = (_match: string, stripped: string) => stripped
      switch (this.options.caseProtection) {
        case 'strict':
          cancel = (match: string, _stripped: string) => match
          break
        case 'as-needed':
          cancel = (match: string, stripped: string) => {
            const words = tokenize(stripped, /\x0E\/?([a-z]+)\x0F/ig)
            return words.find(w => w.shape.match(/^(?!.*X).*x.*$/)) ? match : this.wrap(stripped, 'ncx')
          }
          break
      }

      return value.replace(/\x0Enc\x0F(.*?)\x0E\/nc\x0F/ig, cancel)
    }

    return value
  }

  private field(entry: Entry, field: string, value: string, sentenceCase: boolean) {
    const mode: ParseMode = entry.mode[field] = this.mode(field)
    const caseProtection = {
      present: false,
      intuitive: 0, // a lot of people don't realise `some text \textit{in italics}` will protect 'in italics'
    }

    const ast: Root = LatexPegParser.parse(value)

    if (this.options.removeOuterBraces.includes(field) && ast.content.length === 1 && ast.content[0].type === 'group') {
      ast.content = ast.content[0].content
    }

    if (mode === 'verbatim') { // &^%@#&^%@# idiots wrapping verbatim fields
      entry.fields[field] = printRaw(ast)
      return
    }

    if (this.options.raw) {
      switch (mode) {
        case 'creatorlist':
          entry.fields[field] = (this.split(ast, /^and$/i, /(^& | & | &$)/)
            .map(cr => ({ name: printRaw(cr) }))
            .filter(cr => cr.name) as unknown as string) // pacify typescript
          return
        case 'literallist':
          entry.fields[field] = (this.split(ast, /^and$/i, /(^& | & | &$)/)
            .map(elt => printRaw(elt)) as unknown as string) // pacify typescript
          return
        default:
          entry.fields[field] = printRaw(ast)
          return
      }
    }

    if (mode === 'title') {
      let root = [...ast.content]
      while (root.length) {
        const node = root.shift()

        // only root groups offer case protecten -- but it may be as an macro arg, so mark here before gobbling
        if (this.protect(node)) node._renderInfo = { root: true }

        // environments are considered root when at root
        if (node.type === 'environment') root = [...root, ...node.content]
      }
    }

    // pass 0 -- register parse mode
    visit(ast, (node, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
      if (!node._renderInfo) node._renderInfo = {}

      node._renderInfo.mode = info.context.inMathMode ? 'math' : 'text'

      // if (info.context.inMathMode || info.context.hasMathModeAncestor) return

      if (mode === 'title' && node.type === 'inlinemath' && !info.parents.find(p => p._renderInfo.protectCase)) node._renderInfo.protectCase = true

      if (!info.context.inMathMode) {
        if (mode === 'title' && node._renderInfo.root && (node.type !== 'group' || node.content[0].type !== 'macro')) {
          node._renderInfo.protectCase = true
          if (node.type === 'group') {
            caseProtection.present = true
            caseProtection.intuitive += 1
          }
        }

        if (node.type === 'macro' && typeof node.escapeToken !== 'string') node.escapeToken = '\\'

        if (node.type === 'environment' && node.env === 'em') node._renderInfo.emph = true
      }
    })

    // pass 1 -- mark & normalize
    visit(ast, (nodes, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
      let node: Node
      const compacted: Node[] = []
      let inif = 0
      while (nodes.length) {
        if (node = this.ligature(nodes)) {
          compacted.push(node)
          continue
        }

        node = nodes.shift()

        if (node.type === 'macro' && node.content === 'ifdefined') {
          inif += 1
          continue
        }
        else if (node.type === 'macro' && node.content === 'else') {
          continue
        }
        else if (node.type === 'macro' && node.content === 'fi') {
          inif = Math.max(inif - 1, 0)
          continue
        }
        else if (inif) {
          continue
        }

        const nargs = node.type === 'macro'
          ? narguments[node.content] || narguments[`${info.context.inMathMode ? 'math' : 'text'}\t${node.content}`]
          : 0
        if (node.type === 'macro' && nargs) {
          node.args = Array(nargs).fill(undefined).map(_i => this.argument(nodes, <Macro>node)).filter(arg => arg)
          if (node.content.match(/^(url|href)$/) && node.args.length) {
            let url: Node[] = node.args[0].content
            if (url.length === 1 && url[0].type === 'group') url = url[0].content
            node.args[0] = this.wraparg({ type: 'string', content: printRaw(url), _renderInfo: { mode: url[0]._renderInfo.mode } }, node)
          }
          caseProtection.intuitive -= node.args.filter(arg => arg.content[0].type === 'group' && arg.content[0]._renderInfo.protectCase).length
        }
        else if (node.type === 'macro' && node.content.match(/^[a-z]+$/i) && nodes[0]?.type === 'whitespace') {
          nodes.shift()
        }

        compacted.push(node)
      }

      if (!info.context.inMathMode) {
        // feed-forward inline macros
        for (const [macro, markup] of Object.entries({ em: 'emph', it: 'emph', sl: 'emph', bf: 'bold', sc: 'smallCaps', tt: 'code' })) {
          if (info.parents.find(p => p._renderInfo[markup])) continue

          compacted.forEach((markup_node, i) => {
            if (markup_node.type === 'macro' && markup_node.content === macro) {
              compacted.slice(i + 1).forEach(n => n._renderInfo[markup] = true)
            }
          })
        }
      }

      nodes.push(...compacted)
    }, { test: Array.isArray, includeArrays: true })

    replaceNode(ast, (node, _info) => {
      if (node.type !== 'macro') return

      if (node.escapeToken && combining.tounicode[node.content]) {
        let arg: Node
        // no args, args of zero length, or first arg has no content
        if (!node.args || node.args.length === 0 || node.args[0].content.length === 0) {
          arg = { type: 'string', content: ' ', _renderInfo: {} }
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
              arg = { type: 'string', content: ' ', _renderInfo: {} }
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
            return { type: 'string', content: `${arg.content}${combining.tounicode[node.content]}`, _renderInfo: {} }
          default:
            return
        }
      }

      let latex = `${node.escapeToken}${node.content}`
      latex += (node.args || []).map(arg => printRaw(this.argtogroup(arg))).join('')
      if (latex in latex2unicodemap) return { type: 'string', content: latex2unicode(latex, node), _renderInfo: {} }
      // return null to delete
    })

    switch (mode) {
      case 'creatorlist':
        entry.fields[field] = (this.split(ast, /^and$/i, /(^& | & | &$)/)
          .map(cr => this.parseCreator(cr))
          .filter(cr => Object.keys(cr).length) as unknown as string) // pacify typescript
        break
      case 'literallist':
        entry.fields[field] = (this.split(ast, /^and$/i, /(^& | & | &$)/)
          .map(elt => this.stringify(elt, { mode: 'literal'}).trim()) as unknown as string) // pacify typescript
        break
      default:
        entry.fields[field] = this.stringField(
          field,
          this.stringify(ast, { mode }),
          mode,
          sentenceCase,
          this.options.sentenceCase.guess // && (!caseProtection.present || caseProtection.intuitive > 0)
        ) as unknown as string
        break
    }

    // recursively restores markup in string content. 'as string' is just here to pacify typescript
    entry.fields[field] = JSON.parse(JSON.stringify(entry.fields[field], (k, v) => (typeof v === 'string' ? this.restoreMarkup(v) : v) as string))
  }

  private reset(options: Options = {}) {
    this.options = merge(options, {
      caseProtection: 'as-needed',
      unabbreviations: true,
      applyCrossRef: options.applyCrossRef ?? true,
      fieldMode: {},
      sentenceCase: {
        langids : English,
        guess: true,
        preserveQuoted: true,
      },
    })

    if (this.options.caseProtection === true) this.options.caseProtection = 'as-needed'

    if (this.options.verbatimFields) this.options.verbatimFields = this.options.verbatimFields.map(f => typeof f === 'string' ? f.toLowerCase() : new RegExp(f.source, f.flags + (f.flags.includes('i') ? '' : 'i')))

    if (typeof this.options.sentenceCase.langids === 'boolean') this.options.sentenceCase.langids = this.options.sentenceCase.langids ? English : []
    this.options.sentenceCase.langids = this.options.sentenceCase.langids.map(langid => langid.toLowerCase())

    if (typeof this.options.unabbreviations === 'boolean') this.options.unabbreviations = this.options.unabbreviations ? unabbreviations : {}
    const unabbr: Record<string, string> = {}
    for (const abbr in this.options.unabbreviations) { // eslint-disable-line guard-for-in
      unabbr[abbr.toUpperCase()] = this.options.unabbreviations[abbr]
    }
    this.options.unabbreviations = unabbr

    this.fieldMode = Object.entries(FieldMode).reduce((acc: typeof FieldMode, [mode, test]: [string, (RegExp | string)[]]) => {
      const strings = test.filter(fieldname_or_regex => typeof fieldname_or_regex === 'string' && !this.options.fieldMode[fieldname_or_regex])
      const regexes = test.filter(fieldname_or_regex => typeof fieldname_or_regex !== 'string')
      acc[mode] = [...strings, ...regexes]
      return acc
    }, <typeof FieldMode>{})
    for (const [field, mode] of Object.entries(this.options.fieldMode)) {
      this.fieldMode[mode].unshift(field)
    }

    if (!this.options.removeOuterBraces) {
      this.options.removeOuterBraces = <string[]>[
        ...FieldAction.removeOuterBraces,
        ...this.fieldMode.title,
        ...this.fieldMode.verbatim,
      ].filter(field => typeof field === 'string')
    }

    this.fallback = options.unsupported === 'ignore' ? ((_node: Node, _tex: string): string => '') : options.unsupported

    this.bib = {
      errors: [],
      entries: [],
      comments: [],
      strings: {},
      preamble: [],
      jabref: null,
    }
  }

  private reparse(verbatim: bibtex.Entry) {
    let langid: string = (verbatim.fields.langid || verbatim.fields.hyphenation || '').toLowerCase()
    if (!langid && this.options.sentenceCase.language && verbatim.fields.language) langid = verbatim.fields.language.toLowerCase()
    const sentenceCase = (<string[]>this.options.sentenceCase.langids).includes(langid)

    const entry: Entry = this.current = {
      type: verbatim.type,
      key: verbatim.key,
      fields: {},
      mode: {},
      input: verbatim.input,
    }
    let keywords: string[] = [] // OMG #783
    try {
      for (let [field, value] of Object.entries(verbatim.fields)) {
        if (!value.trim()) continue

        /*
        if (this.options.raw && !this.options.removeOuterBraces.includes(field)) {
          entry.fields[field] = value.trim()
          entry.mode[field] = 'verbatim'
          continue
        }
        */

        if (field.match(/^keywords([+]duplicate-\d+)?$/)) field = 'keywords' // #873

        this.field(entry, field, value, sentenceCase)

        if (field === 'keywords') { // #873
          keywords = [ ...keywords, ...(entry.fields.keywords as unknown as string).split(/\s*[,;]\s*/) ].map((k: string) => k.trim()).filter(k => k)
          delete entry.fields.keywords
        }

        if (!this.options.raw && typeof entry.fields[field] === 'string') {
          entry.fields[field] = entry.fields[field].trim()
          if (field === 'month') entry.fields[field] = Month[entry.fields[field].toLowerCase()] || entry.fields[field]
        }
      }

      if (keywords.length) {
        entry.fields.keywords = [ ...(new Set(keywords)) ].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        entry.mode.keywords = 'verbatimlist'
      }

      this.bib.entries.push(entry)
    }
    catch (err) {
      this.bib.errors.push({ error: `${err.message}\n${entry.input}`, input: entry.input })
    }
  }

  private content(tex: string) {
    const entry: Entry = { key: '', type: '', fields: {}, mode: {}, input: tex }
    this.field(entry, 'tex', tex, false)
    return entry.fields.tex
  }

  private prep(base: bibtex.Library) {
    for (const preamble of base.preambles) {
      try {
        this.content(preamble)
      }
      catch (err) {
      }
    }
    for (const [k, v] of Object.entries(base.strings)) {
      this.bib.strings[k] = this.content(v)
    }
  }

  private finalize(base: bibtex.Library) {
    if (this.options.applyCrossRef) {
      const entries: Partial<Record<string, Entry>> = {}
      for (const entry of this.bib.entries) {
        if (entry.key) entries[entry.key.toUpperCase()] = entry
      }

      const order: string[] = []
      for (const entry of this.bib.entries) {
        if (!entry.key || typeof entry.fields.crossref !== 'string') continue

        const crossref = entry.fields.crossref.toUpperCase()
        if (!entries[crossref]) continue

        const key = entry.key.toUpperCase()
        if (!order.includes(crossref)) order.unshift(crossref)
        if (!order.includes(key)) order.push(key)
      }

      const add = (obj: Record<string, string[]>, kind: string, field: string) => {
        obj[kind] = [...(new Set([...obj[kind], field]))].sort()
      }

      for (const key of order) {
        const child = entries[key.toUpperCase()]
        const parent = entries[child.fields.crossref?.toUpperCase()]
        if (!parent) continue

        child.crossref = child.crossref || { donated: [], inherited: [] }
        parent.crossref = parent.crossref || { donated: [], inherited: [] }

        for (const mappings of [CrossRef[child.type], CrossRef['*']].filter(m => m)) {
          for (const mapping of [mappings[parent.type], mappings['*']].filter(m => m)) {
            for (const [childfield, parentfield] of Object.entries(<Record<string, string>> mapping)) {
              if (!child.fields[childfield] && parent.fields[parentfield]) {
                child.fields[childfield] = parent.fields[parentfield]
                add(child.crossref, 'inherited', childfield)
                add(parent.crossref, 'donated', parentfield)
              }
            }

            for (const field of <string[]>(allowed[child.type] || [])) {
              if (FieldAction.noCrossRef.includes(field)) continue

              if (!child.fields[field] && parent.fields[field]) {
                child.fields[field] = parent.fields[field]
                add(child.crossref, 'inherited', field)
                add(parent.crossref, 'donated', field)
              }
            }
          }
        }
      }

      for (const entry of this.bib.entries) {
        if (entry.crossref && !entry.crossref.donated.length && !entry.crossref.inherited.length) delete entry.crossref
      }
    }

    const { comments, jabref } = JabRef.parse(base.comments)
    this.bib.comments = comments
    this.bib.jabref = jabref

    this.bib.preamble = base.preambles
    this.bib.errors = [...base.errors, ...this.bib.errors]
  }

  public parse(input: string, options: Options = {}): Library {
    this.reset(options)

    const base = bibtex.parse(input, { strings: options.strings })

    this.prep(base)

    for (const entry of base.entries) {
      this.reparse(entry)
    }

    this.finalize(base)
    return this.bib
  }

  public async parseAsync(input: string, options: Options = {}): Promise<Library> {
    this.reset(options)

    const base = await bibtex.promises.parse(input, { strings: options.strings })

    this.prep(base)

    for await (const entry of asyncGenerator(base.entries)) {
      this.reparse(entry)
    }

    this.finalize(base)
    return this.bib
  }
}

export function parse(input: string, options: Options = {}): Library {
  const parser = new BibTeXParser
  return parser.parse(input, options)
}

export async function parseAsync(input: string, options: Options = {}): Promise<Library> {
  const parser = new BibTeXParser
  return await parser.parseAsync(input, options)
}
