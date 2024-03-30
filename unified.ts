/* eslint-disable no-underscore-dangle */
import { Root, Macro, String as StringNode, Node, Argument, Group, Environment } from '@unified-latex/unified-latex-types'
import { replaceNode } from '@unified-latex/unified-latex-util-replace'
import { LatexPegParser } from '@unified-latex/unified-latex-util-pegjs'
import { visit } from '@unified-latex/unified-latex-util-visit'
import { printRaw } from '@unified-latex/unified-latex-util-print-raw'
import { latex2unicode as latex2unicodemap, combining } from 'unicode2latex'
import * as bibtex from './chunker'
import * as JabRef from './jabref'
export { toSentenceCase } from './sentence-case'
import { toSentenceCase, guessSentenceCased } from './sentence-case'
import XRegExp from 'xregexp'

import crossref from './crossref.json'
import allowed from './fields.json'
const unabbreviate = require('./unabbrev.json')

function latexMode(node: Node | Argument): 'math' | 'text' {
  return node._renderInfo.mode as 'math' | 'text'
}

function latex2unicode(tex: string, node: Node): string {
  const text: string | Record<string, string> = latex2unicodemap[tex]
  if (typeof text === 'string') return text
  return text && text[latexMode(node)]
}

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
     * Some bibtex files will have titles in sentence case, or all-uppercase. If this is on, and there is a field that would normally have sentence-casing applied in which more words are all-`X`case
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
  sentenceCased?: boolean
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
    'subtitle',
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
  richtext: [
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
    // 'publisher',
    // 'location',
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

  // math
  'math\t_': 1,
  'math\t^': 1,
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

const needsNC = XRegExp('(^|\\s)([^\\p{Lu}]+)(\\s|$)')

class BibTeXParser {
  private fallback: unsupportedHandler
  private current: Entry
  private options: Options
  private fieldMode: typeof FieldMode
  private newcommands: Record<string, Argument> = {}

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
      if (this.splitter(ast.content, <RegExp>splitter)) {
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

      // not in keyword mode
      if (!nameparts.find(p => p[0])) {
        let [lastName, suffix, firstName] = (nameparts.length === 2)
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
        return JSON.parse(JSON.stringify({
          lastName,
          firstName,
          prefix,
          suffix,
        })) as Creator
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
    else { // first-last mode
      const nameparts = this.split(ast, ' ').map(part => this.stringify(part, { mode: 'creator' })).filter(n => n)
      if (nameparts.length === 1) return { lastName: nameparts[0] }
      const prefix = nameparts.findIndex(n => n.match(/^[a-z]/))
      if (prefix > 0) return { firstName: nameparts.slice(0, prefix).join(' '), lastName: nameparts.slice(prefix).join(' ') }
      return { lastName: nameparts.pop(), firstName: nameparts.join(' ') }
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
    return { type: 'argument', content: [ node ], openMark: '', closeMark: '', _renderInfo: { mode: node._renderInfo.mode } }
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
      const arg = { ...nodes[0], content: char }
      if (!nodes[0].content) nodes.shift()
      return this.wraparg(arg)
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
        return `<${tag}>${text}</${tag}>`
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
        return this.registercommand(node)

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

      case 'enquote':
      case 'mkbibquote':
        return this.wrap(this.stringify(node.args?.[0], context), 'enquote')

      case '\\':
        return context.mode === 'richtext' ? '<b>' : ' '

      case 'par':
        return context.mode === 'richtext' ? '<p>' : ' '

      case 'item':
        return context.mode === 'richtext' ? '<li>' : ' '

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

  private environment(node: Environment, context: Context) {
    if (node.content.length && node.content[0].type === 'whitespace') node.content.shift()
    if (node.content.length && node.content[node.content.length - 1].type === 'whitespace') node.content.pop()

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
    if (node._renderInfo) {
      if (node._renderInfo.emph) content = `<i>${content}</i>`
      if (node._renderInfo.bold) content = `<b>${content}</b>`
      if (node._renderInfo.smallCaps) content = `<sc>${content}</sc>`
    }
    return content
  }

  private stringifyContent(node: Node | Argument, context: Context): string {
    if (!node) return ''

    switch (node.type) {
      case 'root':
      case 'argument':
        return node.content.map(n => this.stringify(n, context)).join('')

      case 'group':
      case 'inlinemath':
        return this.wrap(
          node.content.map(n => this.stringify(n, {...context, caseProtected: (context.caseProtected || <boolean>node._renderInfo.protectCase)})).join(''),
          node.type === 'group' ? 'nc' : 'ncx',
          (context.mode === 'title') && !context.caseProtected && !!node._renderInfo.protectCase
        )

      case 'string':
      case 'verbatim':
        return node.content

      case 'macro':
        return this.macro(node, context)

      case 'parbreak':
        return context.mode === 'richtext' ? '<p>' : ' '

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

  private mode(field: string): ParseMode {
    let mode: ParseMode = 'literal'
    for (const [selected, fields] of Object.entries(this.fieldMode)) {
      if (fields.find(match => typeof match === 'string' ? field === match : field.match(match))) mode = <ParseMode>selected
    }
    return mode
  }

  private noCase(s: string): string {
    let cancel = (_match: string, stripped: string) => stripped

    switch (this.options.caseProtection) {
      case 'strict':
        cancel = (match: string, _stripped: string) => match
        break
      case 'as-needed':
        cancel = (match: string, stripped: string) => needsNC.test(stripped) ? match : stripped
        break
    }

    return s.replace(/<\/?ncx>/g, '')
      .replace(/<nc>(.*?)<\/nc>/g, cancel)
      .replace(/<\/nc>(\s*)<nc>/g, '$1')
      .replace(/<nc>/g, '<span class="nocase">').replace(/<\/nc>/g, '</span>')
      .replace(/<sc>/g, '<span style="font-variant:small-caps;">').replace(/<\/sc>/g, '</span>')
  }

  private field(entry: Entry, field: string, value: string, sentenceCase: boolean) {
    const mode: ParseMode = this.mode(field)

    if (mode === 'verbatim') {
      entry.fields[field] = value
      return
    }

    const ast: Root = LatexPegParser.parse(value)

    if (this.options.removeOuterBraces.includes(field) && ast.content.length === 1 && ast.content[0].type === 'group') {
      ast.content = ast.content[0].content
    }

    let root = [...ast.content]
    while (root.length) {
      const node = root.shift()

      // only root groups offer case protecten -- but it may be as an macro arg, so mark here before gobbling
      if (this.protect(node)) node._renderInfo = { protectCase: true }

      // environments are considered root when at root
      if (node.type === 'environment') root = [...root, ...node.content]
    }

    // pass 0 -- register parse mode
    visit(ast, (node, info) => { // eslint-disable-line @typescript-eslint/no-unsafe-argument
      if (!node._renderInfo) node._renderInfo = {}

      node._renderInfo.mode = info.context.inMathMode ? 'math' : 'text'

      // if (info.context.inMathMode || info.context.hasMathModeAncestor) return
      if (!info.context.inMathMode) {
        if (node.type === 'macro' && typeof node.escapeToken !== 'string') node.escapeToken = '\\'

        if (node.type === 'macro' && node.content.match(/^(itshape|textit|emph|mkbibemph)$/)) node._renderInfo.emph = true
        if (node.type === 'environment' && node.env === 'em') node._renderInfo.emph = true

        if (node.type === 'macro' && node.content.match(/^(textbf|mkbibbold|bfseries)$/)) node._renderInfo.bold = true

        if (node.type === 'macro' && node.content.match(/^(textsc)$/)) node._renderInfo.smallCaps = true
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
          node.args = Array(nargs).fill(undefined).map(_i => this.argument(nodes)).filter(arg => arg)
          if (node.content.match(/^(url|href)$/) && node.args.length) {
            let url: Node[] = node.args[0].content
            if (url.length === 1 && url[0].type === 'group') url = url[0].content
            node.args[0] = this.wraparg({ type: 'string', content: printRaw(url), _renderInfo: { mode: url[0]._renderInfo.mode } })
          }
        }
        else if (node.type === 'macro' && node.content.match(/^[a-z]+$/) && nodes[0]?.type === 'whitespace') {
          nodes.shift()
        }

        compacted.push(node)
      }

      if (!info.context.inMathMode) {
        for (const [macro, markup] of Object.entries({ em: 'emph', it: 'emph', bf: 'bold' })) {
          if (info.parents.find(p => p._renderInfo[markup])) continue

          compacted.forEach((markup_node, i) => {
            if (markup_node.type === 'macro' && markup_node.content === macro) {
              compacted.slice(i + 1).forEach(n => n._renderInfo[markup]= true)
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
      if (latex in latex2unicodemap) return { type: 'string', content: latex2unicode(latex, node) }
      // return null to delete
    })

    let sentenceCased = ''
    switch (mode) {
      case 'creator':
        entry.fields[field] = this.split(ast, /^and$/i).map(cr => this.parseCreator(cr))
        break
      case 'commalist':
        entry.fields[field] = this.split(ast, /^[;,]$/).map(elt => this.noCase(this.stringify(elt, { mode: 'literal'})).trim())
        break
      case 'literallist':
        entry.fields[field] = this.split(ast, /^and$/i).map(elt => this.noCase(this.stringify(elt, { mode: 'literal'})).trim())
        break
      default:
        entry.fields[field] = this.stringify(ast, { mode })
        if (mode === 'title' && sentenceCase && !(this.options.sentenceCase.guess && guessSentenceCased(<string>entry.fields[field]))) {
          sentenceCased = this.noCase(toSentenceCase(<string>entry.fields[field], {
            preserveQuoted: this.options.sentenceCase.preserveQuoted,
            subSentenceCapitalization: this.options.sentenceCase.subSentence,
          }))
        }
        entry.fields[field] = this.noCase(<string>entry.fields[field])
        if (sentenceCased && sentenceCased !== entry.fields[field]) {
          entry.fields[field] = sentenceCased
          entry.sentenceCased = true
        }
        if (FieldAction.unabbrev.includes(field)) entry.fields[field] = unabbreviate[<string>entry.fields[field]] || entry.fields[field]
        if (typeof entry.fields[field] === 'string') {
          if (field !== 'crossref' && (<string>entry.fields[field]).trim().match(/^-?\d+$/)) {
            entry.fields[field] = parseInt(<string>entry.fields[field])
          }
          else {
            entry.fields[field] = (<string>entry.fields[field]).replace(/<\/(i|b|nc|sup|sub)>(\s*)<\1>/g, '$2')
          }
        }
        break
    }
  }

  private empty(options: Options = {}): Bibliography {
    const sentenceCase: Options['sentenceCase'] = {
      langids : English,
      guess: true,
      preserveQuoted: true,
      ...(options.sentenceCase || {}),
    }

    this.options = {
      caseProtection: 'as-needed',
      applyCrossRef: options.applyCrossRef ?? true,
      fieldMode: {},

      ...options,

      sentenceCase,
    }
    if (this.options.caseProtection === true) this.options.caseProtection = 'as-needed'

    if (typeof this.options.sentenceCase.langids === 'boolean') this.options.sentenceCase.langids = this.options.sentenceCase.langids ? English : []
    this.options.sentenceCase.langids = this.options.sentenceCase.langids.map(langid => langid.toLowerCase())

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
    const langid = (entry.fields.langid || entry.fields.hyphenation || '').toLowerCase()
    const sentenceCase = (<string[]> this.options.sentenceCase.langids).includes(langid)

    this.current = entry
    try {
      for (const [field, value] of Object.entries(entry.fields)) {
        this.field(entry, field, value, sentenceCase)
        if (typeof entry.fields[field] === 'string') entry.fields[field] = entry.fields[field].trim()
      }
      bib.entries.push(<Entry>entry)
    }
    catch (err) {
      bib.errors.push({ error: `${err.message}\n${entry.input}`, input: entry.input })
    }
  }

  private content(tex: string) {
    const entry: Entry = { key: '', type: '', fields: {} }
    this.field(entry, 'tex', tex, false)
    return <string>entry.fields.tex
  }

  private prep(bib: Bibliography, base: bibtex.Bibliography) {
    for (const preamble of base.preambles) {
      this.content(preamble)
    }
    for (const [k, v] of Object.entries(base.strings)) {
      bib.strings[k] = this.content(v)
    }
  }

  private finalize(bib: Bibliography, base: bibtex.Bibliography) {
    if (this.options.applyCrossRef) {
      const entries: Partial<Record<string, Entry>> = bib.entries.reduce((acc: Partial<Record<string, Entry>>, entry: Entry) => entry.key ? { ...acc, [entry.key]: entry } : acc, {})

      const order: string[] = []
      for (const entry of bib.entries) {
        if (entry.key && typeof entry.fields.crossref === 'string' && entries[entry.fields.crossref]) {
          if (!order.includes(entry.fields.crossref)) order.unshift(entry.fields.crossref)
          if (!order.includes(entry.key)) order.push(entry.key)
        }
      }

      for (const key of order) {
        const child = entries[key]
        const parent = entries[<string>child.fields.crossref]

        for (const mappings of [crossref[child.type], crossref['*']].filter(m => m)) {
          for (const mapping of [mappings[parent.type], mappings['*']].filter(m => m)) {
            for (const [childfield, parentfield] of Object.entries(<Record<string, string>> mapping)) {
              if (!child.fields[childfield] && parent.fields[parentfield]) child.fields[childfield] = parent.fields[parentfield]
            }

            for (const field of <string[]>(allowed[child.type] || [])) {
              if (!child.fields[field] && parent.fields[field]) child.fields[field] = parent.fields[field]
            }
          }
        }
      }
    }

    const { comments, jabref } = JabRef.parse(base.comments)
    bib.comments = comments
    bib.jabref = jabref
    bib.comments = base.comments

    bib.preamble = base.preambles
    bib.errors = [...base.errors, ...bib.errors]
  }

  public parse(input: string, options: Options = {}): Bibliography {
    const bib: Bibliography = this.empty(options)

    const base = bibtex.parse(input)

    this.prep(bib, base)

    for (const entry of base.entries) {
      this.reparse(bib, entry)
    }

    this.finalize(bib, base)
    return bib
  }

  public async parseAsync(input: string, options: Options = {}): Promise<Bibliography> {
    const bib: Bibliography = this.empty(options)

    const base = await bibtex.promises.parse(input)

    this.prep(bib, base)

    for await (const entry of asyncGenerator(base.entries)) {
      this.reparse(bib, entry)
    }

    this.finalize(bib, base)
    return bib
  }
}

export function parse(input: string, options: Options = {}): Bibliography {
  const parser = new BibTeXParser
  return parser.parse(input, options)
}

export async function parseAsync(input: string, options: Options = {}): Promise<Bibliography> {
  const parser = new BibTeXParser
  return await parser.parseAsync(input, options)
}
