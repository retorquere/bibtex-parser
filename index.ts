import * as bibtex from './grammar'
// Set instead of {} because we need insertion order remembered
type RichNestedLiteral = bibtex.NestedLiteral & { markup: Record<string, boolean>, preserveCase?: boolean }

import { parse as chunker } from './chunker'
import { latex as latex2unicode } from 'unicode2latex'

class ParserError extends Error {
  public node: any

  constructor(message?: string, node?: any) {
    super(message) // 'Error' breaks prototype chain here
    Object.setPrototypeOf(this, new.target.prototype) // restore prototype chain
    this.name = this.constructor.name
    this.node = node
  }
}

class TeXError extends Error {
  public node: any
  public text: string

  constructor(message: string, node: any, text: string) {
    super(message) // 'Error' breaks prototype chain here
    Object.setPrototypeOf(this, new.target.prototype) // restore prototype chain
    this.name = this.constructor.name
    this.node = node
    this.text = text
  }
}

/*
function pad(s, n) {
  return `${s}${' '.repeat(n)}`.substr(0, n)
}

class Tracer {
  private input: string
  private level: number
  constructor(input) {
    this.input = input
    this.level = 0
  }

  trace(evt) {
    switch (evt.type) {
      case 'rule.enter':
        this.level++
        break

      case 'rule.fail':
      case 'rule.match':
        this.level--
        break

      default:
        throw new Error(JSON.stringify(evt))

    }

    console.log(pad(`${evt.location.start.offset}`, 6), pad(evt.type.split('.')[1], 5), pad(evt.rule, 10), '.'.repeat(this.level), JSON.stringify(this.input.substring(evt.location.start.offset, evt.location.end.offset)))
  }
}
*/

import charCategories = require('xregexp/tools/output/categories')
const charClass = {
  Lu: charCategories.filter(cat => ['Uppercase_Letter', 'Titlecase_Letter'].includes(cat.alias)).map(cat => cat.bmp).join(''),
  Ll: charCategories.find(cat => cat.alias === 'Lowercase_Letter').bmp,
  LnotLu: charCategories.filter(cat => ['Lowercase_Letter', 'Modifier_Letter', 'Other_Letter', 'Nonspacing_Mark', 'Spacing_Mark', 'Decimal_Number', 'Letter_Number'].includes(cat.alias)).map(cat => cat.bmp).join(''),
  P: charCategories.find(cat => cat.alias === 'Punctuation').bmp,
  L: charCategories.find(cat => cat.alias === 'Letter').bmp,
  N: charCategories.filter(cat => ['Decimal_Number', 'Letter_Number'].includes(cat.alias)).map(cat => cat.bmp).join(''),
  AlphaNum: charCategories.filter(cat => ['Letter', 'Decimal_Number', 'Letter_Number'].includes(cat.alias)).map(cat => cat.bmp).join(''),
  LC: charCategories.find(cat => cat.alias === 'Cased_Letter').bmp,
}

const preserveCase = {
  leadingCap: new RegExp(`^[${charClass.Lu}][${charClass.LnotLu}]+[${charClass.P}]?$`),
  allCaps: new RegExp(`^[${charClass.Lu}${charClass.N}]{2,}$`),
  allLower: new RegExp(`^[${charClass.Ll}${charClass.N}]{2,}$`),
  joined: new RegExp(`^[${charClass.Lu}][${charClass.LnotLu}]*([-+][${charClass.L}${charClass.N}]+)*[${charClass.P}]*$`),
  hasUppercase: new RegExp(`[${charClass.Lu}]`),
  isNumber: /^[0-9]+$/,
  hasAlpha: new RegExp(`[${charClass.L}]`),
  hasAlphaNum: new RegExp(`[${charClass.AlphaNum}]`),
  notAlphaNum: new RegExp(`[^${charClass.AlphaNum}]`, 'g'),
  sentenceStart: new RegExp(`(^|([;:?!.]\\s+))[${charClass.Lu}]`, 'g'),
  nonCased: new RegExp(`[^${charClass.LC}]`),
  hasCased: new RegExp(`[${charClass.LC}]`),
  quoted: /("[^"]+")|(“[^“]+“)/g,
}

const marker = {
  and: '\u0001',
  comma: '\u0002',
  space: '\u0003',
  literal: '\u0004',

  re: {
    and: /./,
    comma: /./,
    space: /./,
    literal: /./,

    literalName: /./,
  },
}
marker.re = {
  and: new RegExp(marker.and, 'g'),
  comma: new RegExp(marker.comma, 'g'),
  space: new RegExp(marker.space, 'g'),
  literal: new RegExp(marker.literal, 'g'),

  literalName: new RegExp(`^${marker.literal}[^${marker.literal}]*${marker.literal}$`),
}

export interface Name {
  /**
   * If the name is a literal (surrounded by braces) it will be in this property, and none of the other properties will be set
   */
  literal?: string

  /**
   * Family name
   */
  lastName?: string

  /**
   * available when parsing biblatex extended name format
   */
  useprefix?: boolean

  /**
   * given name. Will include middle names and initials.
   */
  firstName?: string

  /**
   * things like `Jr.`, `III`, etc
   */
  suffix?: string

  /**
   * things like `von`, `van der`, etc
   */
  prefix?: string
}

export interface Entry {
  /**
   * citation key
   */
  key: string,

  /**
   * entry type
   */
  type: string

  /**
   * entry fields. The keys are always in lowercase
   */
  fields: { [key: string]: string[] }

  /**
   * authors, editors, by creator type. Name order within the creator-type is retained.
   */
  creators: { [type: string]: Name[] }
}

type FieldBuilder = {
  name: string
  text: string
  level: number
  words: {
    cased: number
    other: number
  }
  preserveRanges: Array<{ start: number, end: number }>
}

/**
 * Markup mapping. As the bibtex file is parsed, markup will be transformed according to this table
 */
export interface MarkupMapping {
  sub?: { open: string, close: string }
  sup?: { open: string, close: string }
  bold?: { open: string, close: string }
  italics?: { open: string, close: string }
  smallCaps?: { open: string, close: string }
  caseProtect?: { open: string, close: string }
  enquote?: { open: string, close: string }

  roman?: { open: string, close: string }
  fixedWidth?: { open: string, close: string }
}

export interface Bibliography {
  /**
   * errors found while parsing
   */
  errors: ParseError[]

  /**
   * entries in the order in which they are found, omitting those which could not be parsed.
   */
  entries: Entry[]

  /**
   * `@comment`s found in the bibtex file. See also [[jabref.parse]]
   */
  comments: string[]

  /**
   * `@string`s found in the bibtex file.
   */
  strings: { [key: string]: string }
}

export interface ParseError {
  /**
   * error message
   */
  message: string

  /**
   * text block that was parsed where the error was found
   */
  source?: string

  /**
   * Error line number within the bibtex file
   */
  line?: number

  /**
   * Error column number within the bibtex file
   */
  column?: number
}

const fields = {
  creator: [
    'author',
    'bookauthor',
    'collaborators',
    'commentator',
    'director',
    'editor',
    'editora',
    'editorb',
    'editors',
    'holder',
    'scriptwriter',
    'translator',
    'translators',
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
  unnest: [
    'publisher',
    'location',
  ],
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
   * translate braced parts of text into a case-protected counterpart; uses the [[MarkupMapping]] table in `markup`.
   */
  caseProtect?: boolean

  /**
   * The parser can change TeX markup (\textsc, \emph, etc) to a text equivalent. The defaults are HTML-oriented, but you can pass in your own configuration here
   */
  markup?: MarkupMapping

  /**
   * return a promise for a [[Bibliography]] when set to true
   */
  async?: boolean

  /**
   * By default, when an unexpected parsing error is found (such as a TeX command which I did not anticipate), the parser will throw an error. You can pass a function to handle the error instead,
   * where you can log it, display it, or even still throw an error
   */
  errorHandler?: false | ((message: string) => void)

  /**
   * Some fields such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands. You can change the default list here if you want,
   * for example to help parse Mendeley `file` fields, which against spec are not in verbatim mode.
   */
  verbatimFields?: string[]
}

const english = [
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

class Parser {
  private errors: ParseError[]
  private strings: { [key: string]: any[] }
  private unresolvedStrings: { [key: string]: boolean }
  private default_strings: { [key: string]: any[] }
  private comments: string[]
  private entries: Entry[]
  private entry: Entry
  private fieldType: 'title' | 'creator' | 'other'
  private field: FieldBuilder
  private errorHandler: (message: string) => void
  private markup: MarkupMapping
  private caseProtect: boolean
  private sentenceCase: string[]
  private chunk: string

  constructor(options: ParserOptions = {}) {
    this.unresolvedStrings = {}
    this.caseProtect = typeof options.caseProtect === 'undefined' ? true : options.caseProtect
    if (typeof options.sentenceCase === 'boolean') {
      this.sentenceCase = options.sentenceCase ? english : []
    } else {
      this.sentenceCase = options.sentenceCase || english
    }

    this.markup = {
      enquote: { open: '\u201c', close: '\u201d' },
      sub: { open: '<sub>', close: '</sub>' },
      sup: { open: '<sup>', close: '</sup>' },
      bold: { open: '<b>', close: '</b>' },
      italics: { open: '<i>', close: '</i>' },
      smallCaps: { open: '<span style="font-variant:small-caps;">', close: '</span>' },
      caseProtect: { open: '<span class="nocase">', close: '</span>' },
      roman: { open: '', close: '' },
      fixedWidth: { open: '', close: '' },
    }
    for (const [markup, open_close ] of Object.entries(options.markup || {})) {
      if (open_close) this.markup[markup] = open_close
    }

    if (options.errorHandler === false) {
      // tslint:disable-next-line only-arrow-functions no-empty
      this.errorHandler = function(err) {}
    } else if (options.errorHandler === undefined) {
      // tslint:disable-next-line only-arrow-functions
      this.errorHandler = function(err) { throw err }
    } else {
      this.errorHandler = options.errorHandler
    }

    this.errors = []
    this.comments = []
    this.entries = []
    this.strings = { }
    this.default_strings = {
      JAN: [ this.text('01') ],
      FEB: [ this.text('02') ],
      MAR: [ this.text('03') ],
      APR: [ this.text('04') ],
      MAY: [ this.text('05') ],
      JUN: [ this.text('06') ],
      JUL: [ this.text('07') ],
      AUG: [ this.text('08') ],
      SEP: [ this.text('09') ],
      OCT: [ this.text('10') ],
      NOV: [ this.text('11') ],
      DEC: [ this.text('12') ],
      ACMCS: [ this.text('ACM Computing Surveys') ],
      ACTA: [ this.text('Acta Informatica') ],
      CACM: [ this.text('Communications of the ACM') ],
      IBMJRD: [ this.text('IBM Journal of Research and Development') ],
      IBMSJ: [ this.text('IBM Systems Journal') ],
      IEEESE: [ this.text('IEEE Transactions on Software Engineering') ],
      IEEETC: [ this.text('IEEE Transactions on Computers') ],
      IEEETCAD: [ this.text('IEEE Transactions on Computer-Aided Design of Integrated Circuits') ],
      IPL: [ this.text('Information Processing Letters') ],
      JACM: [ this.text('Journal of the ACM') ],
      JCSS: [ this.text('Journal of Computer and System Sciences') ],
      SCP: [ this.text('Science of Computer Programming') ],
      SICOMP: [ this.text('SIAM Journal on Computing') ],
      TOCS: [ this.text('ACM Transactions on Computer Systems') ],
      TODS: [ this.text('ACM Transactions on Database Systems') ],
      TOG: [ this.text('ACM Transactions on Graphics') ],
      TOMS: [ this.text('ACM Transactions on Mathematical Software') ],
      TOOIS: [ this.text('ACM Transactions on Office Information Systems') ],
      TOPLAS: [ this.text('ACM Transactions on Programming Languages and Systems') ],
      TCS: [ this.text('Theoretical Computer Science') ],
    }
  }

  public ast(input, options: { clean?: boolean, verbatimFields?: string[] } = {}) {
    if (typeof options.clean === 'undefined') options.clean = true

    const _ast = []
    for (const chunk of chunker(input)) {
      let chunk_ast = bibtex.parse(chunk.text, { verbatimProperties: options.verbatimFields })
      if (options.clean) chunk_ast = this.cleanup(chunk_ast, !this.caseProtect)
      _ast.push(chunk_ast)
    }
    return _ast
  }

  public parse(input, options: { verbatimFields?: string[] } = {}): Bibliography {
    for (const chunk of chunker(input)) {
      this.parseChunk(chunk, options)
    }
    return this.parsed()
  }

  public async parseAsync(input, options: { verbatimFields?: string[] } = {}): Promise<Bibliography> {
    for (const chunk of await chunker(input, { async: true })) {
      this.parseChunk(chunk, options)
    }
    return this.parsed()
  }

  private parsed(): Bibliography {
    this.field = null
    const strings = {}
    this.fieldType = 'other'
    for (const [key, value] of Object.entries(this.strings)) {
      this.field = {
        name: '@string',
        text: '',
        level: 0,
        words: {
          cased: 0,
          other: 0,
        },
        preserveRanges: null,
      }
      this.convert(value)
      strings[key] = this.field.text
    }
    return {
      errors: this.errors,
      entries: this.entries,
      comments: this.comments,
      strings,
    }
  }

  private parseChunk(chunk, options: { verbatimFields?: string[] }) {
    this.chunk = chunk.text

    try {
      const _ast = this.cleanup(bibtex.parse(chunk.text, { verbatimProperties: options.verbatimFields }), !this.caseProtect)
      if (_ast.kind !== 'File') throw new Error(this.show(_ast))

      for (const node of _ast.children) {
        this.convert(node)
      }

      return _ast

    } catch (err) {
      if (!err.location) throw err
      this.errors.push({
        message: err.message,
        line: err.location.start.line + chunk.offset.line,
        column: err.location.start.column,
      })

      return null
    }
  }

  private show(o) {
    // tslint:disable-next-line prefer-template
    let text = JSON.stringify(o)
    if (this.chunk) text += '\n' + this.chunk.trim()
    return text
  }

  private text(value = '') {
    return { kind: 'Text', value }
  }

  private error(err, returnvalue) {
    this.errorHandler(err)
    return returnvalue
  }

  private condense(node, nocased) {
    if (!Array.isArray(node.value)) {
      if (node.value.kind === 'Number') return
      return this.error(new ParserError(`cannot condense a ${node.value.kind}: ${this.show(node)}`, node), undefined)
    }

    const markup = {
      sl: 'italics',
      em: 'italics',
      it: 'italics',
      itshape: 'italics',

      bf: 'bold',
      bfseries: 'bold',

      sc: 'smallCaps',
      scshape: 'smallCaps',

      tt: 'fixedWidth',
      rm: 'roman',
      sf: 'sansSerif',
      verb: 'verbatim',
    }

    if (this.fieldType === 'title') {
      node.value = node.value.filter((child, i) => {
        // handles cases like {\sl ...}, but apply it to the whole block even if they appear in the middle
        if (child.kind === 'RegularCommand' && markup[child.value] && !child.arguments.required.length) {
          if (node.markup) {
            delete node.markup.caseProtect
            node.markup[markup[child.value]] = true
            if (markup[child.value] === 'smallCaps') node.preserveCase = true
          }
          return false
        }

        return true
      })
    }

    // apply cleaning to resulting children
    node.value = node.value.map(child => this.cleanup(child, nocased || node.markup?.caseProtect || node.preserveCase))

    // condense text nodes to make whole words for sentence casing
    node.value = node.value.reduce((acc, child) => {
      const last = acc.length - 1
      if (acc.length === 0 || child.kind !== 'Text' || acc[last].kind !== 'Text') {
        acc.push(child)
      } else {
        acc[last].value += child.value
        acc[last].text += child.text
      }
      return acc
    }, [])
  }

  private argument(node, kind) {
    if (!node.arguments || !node.arguments.required.length) return (kind === 'none')

    // expect 'n' text arguments
    if (typeof kind === 'number') {
      if (node.arguments.required.length !== kind) return false
      let valid = true
      const args = node.arguments.required
        .map(arg => {
          if (arg.kind === 'Text') return arg.value
          if (arg.kind === 'NestedLiteral' && arg.value.length === 1 && arg.value[0].kind === 'Text') return arg.value[0].value
          valid = false
          return null
        })
      return valid ? args : false
    }

    // return first argument if it's the only one
    if (node.arguments.required.length !== 1) return false

    // loose checking for text
    if (kind === 'text') {
      const first = node.arguments.required[0]
      if (first.kind === 'NestedLiteral' && first.value.length === 1) {
        if (first.value[0].kind === 'Text') return first.value[0].value
      }
      // fall back to strict kind check
      kind = 'Text'
    }

    // return first argument if it's the only one and is of the specified kind
    if (node.arguments.required.length !== 1 || node.arguments.required[0].kind !== kind) return false
    switch (kind) {
      case 'Text':
        return node.arguments.required[0].value

      case 'RegularCommand':
      case 'NestedLiteral':
        return node.arguments.required[0]
    }

    return false
  }

  private cleanup(node, nocased) {
    if (Array.isArray(node)) return node.map(child => this.cleanup(child, nocased))

    delete node.loc

    if (!this['clean_' + node.kind]) return this.error(new ParserError(`no cleanup method for '${node.kind}' (${this.show(node)})`, node), this.text())
    return this['clean_' + node.kind](node, nocased)
  }

  protected clean_BracedComment(node: bibtex.BracedComment, nocased) { return node }
  protected clean_LineComment(node: bibtex.LineComment, nocased) { return node }

  protected clean_File(node: bibtex.AST, nocased) {
    node.children = node.children.filter(child => child.kind !== 'NonEntryText').map(child => this.cleanup(child, nocased))
    return node
  }

  protected clean_StringExpression(node: bibtex.StringExpression, nocased) { // should have been StringDeclaration
    this.condense(node, nocased)
    this.strings[node.key.toUpperCase()] = node.value
    return node
  }

  protected clean_String(node: bibtex.StringValue, nocased) { // should have been StringReference
    const reference = node.value.toUpperCase()
    const _string = this.strings[reference] || this.default_strings[reference]

    if (!_string) {
      if (!this.unresolvedStrings[reference]) this.errors.push({ message: `Unresolved @string reference ${JSON.stringify(node.value)}` })
      this.unresolvedStrings[reference] = true
    }

    // if the string isn't found, add it as-is but exempt it from sentence casing
    return {
      kind: 'String',
      preserveCase: !_string,
      value: this.cleanup(_string ? JSON.parse(JSON.stringify(_string)) : [ this.text(node.value) ], nocased),
    }
  }

  protected clean_Entry(node: bibtex.Entry, nocased) {
    node.properties = node.properties.map(child => this.cleanup(child, nocased))
    return node
  }

  protected setFieldType(field) {
    if (fields.title.includes(field)) {
      this.fieldType = 'title'
    } else if (fields.creator.includes(field)) {
      this.fieldType = 'creator'
    } else {
      this.fieldType = 'other'
    }
  }

  protected clean_Property(node: bibtex.Property, nocased) {
    // normalize field names to lowercase
    node.key = node.key.toLowerCase()
    this.setFieldType(node.key)

    // because this was abused so much, many processors ignore second-level too
    if (fields.title.concat(fields.unnest).includes(node.key) && node.value.length === 1 && node.value[0].kind === 'NestedLiteral') {
      (node.value[0] as RichNestedLiteral).markup = {};
      (node.value[0] as RichNestedLiteral).preserveCase = true
    }

    this.condense(node, [ 'url', 'doi', 'file', 'files', 'eprint', 'verba', 'verbb', 'verbc' ].includes(node.key) || !this.caseProtect)

    return node
  }

  protected clean_Text(node: bibtex.TextValue, nocased) { return node }

  private _clean_ScriptCommand(node, nocased) {
    let m, value, singlechar
    // recognize combined forms like \^\circ
    if (singlechar = latex2unicode[node.source]) return this.text(singlechar)
    if ((m = node.source.match(/^([\^_])([^{}]+)$/)) && ((singlechar = latex2unicode[`${m[1]}${m[2]}`]) || (singlechar = latex2unicode[`${m[1]}{${m[2]}}`]))) return this.text(singlechar)
    if ((m = node.source.match(/^([\^_])\{([^{}]+)\}$/)) && ((singlechar = latex2unicode[`${m[1]}${m[2]}`]) || (singlechar = latex2unicode[`${m[1]}{${m[2]}}`]))) return this.text(singlechar)

    const cmd = node.kind === 'SuperscriptCommand' ? '^' : '_'

    if (typeof node.value === 'string' && (singlechar = latex2unicode[`${cmd}${node.value}`] || latex2unicode[`${cmd}{${node.value}}`])) {
      return this.text(singlechar)
    }

    if (typeof node.value === 'string') {
      value = [ this.text(node.value) ]
    } else if (!Array.isArray(node.value)) {
      value = [ node.value ]
    } else {
      value = node.value
    }

    const mode = node.kind === 'SuperscriptCommand' ? 'sup' : 'sub'
    return this.cleanup({
      kind: 'NestedLiteral',
      markup: { [mode]: true },
      value,
    }, nocased)
  }
  protected clean_SubscriptCommand(node: bibtex.SubscriptCommand, nocased) {
    return this._clean_ScriptCommand(node, nocased)
  }

  protected clean_SuperscriptCommand(node: bibtex.SuperscriptCommand, nocased) {
    return this._clean_ScriptCommand(node, nocased)
  }

  protected clean_InlineMath(node: RichNestedLiteral, nocased) {
    return this.clean_NestedLiteral(node, nocased)
  }
  protected clean_DisplayMath(node: RichNestedLiteral, nocased) {
    return this.clean_NestedLiteral(node, nocased)
  }

  protected clean_NestedLiteral(node: RichNestedLiteral, nocased) {
    if (!node.markup) node.markup = nocased ? {} : { caseProtect: true }

    if (this.fieldType === 'title') {
      // https://github.com/retorquere/zotero-better-bibtex/issues/541#issuecomment-240156274
      if (node.value.length && ['RegularCommand', 'DiacriticCommand'].includes(node.value[0].kind)) {
        delete node.markup.caseProtect

      } else if (node.value.length && node.value[0].kind === 'Text') {
        const value = (node.value[0] as bibtex.TextValue).value.trim()
        const preserve = value.match(preserveCase.hasCased) && value.match(preserveCase.hasUppercase)
        if (!preserve) {
          delete node.markup.caseProtect
          node.preserveCase = true
        }
      }
    }

    this.condense(node, nocased)

    if (this.fieldType === 'title') {
      if (!node.markup.caseProtect && node.value.length && node.value[0].kind === 'RegularCommand') {
        for (const arg of node.value[0].arguments.required) {
          if (arg.kind === 'NestedLiteral') delete (arg as RichNestedLiteral).markup.caseProtect
        }
      }
    }

    return node
  }

  protected clean_DiacriticCommand(node: bibtex.DiacriticCommand, nocased) { // Should be DiacraticCommand
    const char = node.dotless ? `\\${node.character}` : node.character
    const unicode = latex2unicode[`\\${node.mark}{${char}}`]
      || latex2unicode[`\\${node.mark}${char}`]
      || latex2unicode[`{\\${node.mark} ${char}}`]
      || latex2unicode[`{\\${node.mark}${char}}`]
      || latex2unicode[`\\${node.mark} ${char}`]

    if (!unicode) return this.error(new TeXError(`Unhandled \\${node.mark}${char}`, node, this.chunk), this.text())
    return this.text(unicode)
  }

  protected clean_SymbolCommand(node: bibtex.SymbolCommand, nocased) {
    return this.text(latex2unicode[`\\${node.value}`] || node.value)
  }

  protected clean_PreambleExpression(node: bibtex.PreambleExpression, nocased) { return node }

  protected clean_RegularCommand(node: bibtex.RegularCommand, nocased) {
    let arg, unicode

    if (unicode = latex2unicode[node.source]) return this.text(unicode)

    switch (node.value) {
      case 'frac':
        if (arg = this.argument(node, 2)) {
          // not a spectactular solution but what ya gonna do.
          return this.cleanup({
            kind: 'NestedLiteral',
            preserveCase: true,
            markup: {},
            value: [ this.text(arg[0]), this.text('/'), this.text(arg[1]) ],
          }, nocased)
        }
        break

      // ignore
      case 'vspace':
      case 'vphantom':
      case 'path':
      case 'aftergroup':
      case 'ignorespaces':
      case 'relax':
      case 'noopsort':
        return this.text()

      case 'ElsevierGlyph':
        if (arg = this.argument(node, 'Text')) {
          if (unicode = latex2unicode[`\\${node.value}{${arg}}`]) return this.text(unicode)
          return this.text(String.fromCharCode(parseInt(arg, 16)))
        }
        break

      case 'chsf':
        if (this.argument(node, 'none')) return this.text()
        // a bit cheaty to assume chsf to be nocased, but it's just more likely to be what people want
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup(arg, true)
        break

      case 'bibstring':
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup(arg, true)
        break

      case 'cite':
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup(arg, true)
        break

      case 'textsuperscript':
        if ((arg = this.argument(node, 'Text')) && (unicode = latex2unicode[`^{${arg}}`])) return this.text(unicode)
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: { sup: true } }, nocased)
        break

      case 'textsubscript':
        if ((arg = this.argument(node, 'Text')) && (unicode = latex2unicode[`_{${arg}}`])) return this.text(unicode)
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: { sub: true } }, nocased)
        break

      case 'textsc':
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: { smallCaps: true } }, nocased)
        break

      case 'enquote':
      case 'mkbibquote':
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: { enquote: true } }, nocased)
        break

      case 'textbf':
      case 'mkbibbold':
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: { bold: true } }, nocased)
        break

      case 'mkbibitalic':
      case 'mkbibemph':
      case 'textit':
      case 'emph':
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: { italics: true } }, nocased)
        break

      case 'bibcyr':
        if (this.argument(node, 'none')) return this.text()
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: {} }, nocased)
        break

      case 'hspace':
      case 'mathrm':
      case 'textrm':
      case 'ocirc':
      case 'mbox':
        if (arg = this.argument(node, 'text')) {
          unicode = latex2unicode[`\\${node.value}{${arg}}`]
          return this.text(unicode || (node.value === 'hspace' ? ' ' : arg))
        } else if (!node.arguments.required.length) {
          return this.text()
        } else if (arg = this.argument(node, 'NestedLiteral')) {
          return this.cleanup({...arg, markup: {} }, nocased)
        }
        break

      // just take the URL? Not the label?
      case 'href':
        if (arg = this.argument(node, 2)) return this.text(arg[0])
        break

      case 'url':
        if (arg = this.argument(node, 'Text')) return this.text(arg)
        if (arg = this.argument(node, 'NestedLiteral')) return this.cleanup({...arg, markup: {} }, nocased)
        break

      default:
        unicode = latex2unicode[`\\${node.value}`] || latex2unicode[`\\${node.value}{}`]
        if (unicode && this.argument(node, 'none')) return this.text(unicode)
        if ((arg = this.argument(node, 'Text')) && (unicode = latex2unicode[`\\${node.value}{${arg}}`])) return this.text(unicode)
        break
    }

    return this.error(new TeXError('Unhandled command: ' + this.show(node), node, this.chunk), this.text())
  }

  private preserveCase(word) {
    // word = word.replace(new RegExp(`"[${this.markup.enquote.open}${this.markup.enquote.close}:()]`, 'g'), '')

    if (!word.match(preserveCase.hasAlphaNum)) return true

    if (word === 'I') return true

    word = word.replace(/[\/’'”:()]/g, '')
    if (word.length === 1) return false
    if (word.replace(preserveCase.nonCased) === '') return false
    // word = word.replace(preserveCase.notAlphaNum, '')

    // simple cap at start of field
    if (word.match(preserveCase.leadingCap) && this.field?.text?.length === 0) return false

    if (word.match(preserveCase.allCaps)) return true
    if (word.length > 1 && word.match(preserveCase.joined)) return false
    if (word.match(preserveCase.hasUppercase)) return true
    if (word.match(preserveCase.isNumber)) return true
    return false
  }

  private convert(node) {
    if (Array.isArray(node)) return node.map(child => this.convert(child)).join('')

    if (!this['convert_' + node.kind]) return this.error(new ParserError(`no converter for ${node.kind}: ${this.show(node)}`, node), undefined)

    const start = this.field ? this.field.text.length : null

    this['convert_' + node.kind](node)

    const preserve = (
      typeof start === 'number'
      && this.field.preserveRanges
      && (node.preserveCase || (node.markup?.caseProtect))
    )
    if (preserve) this.field.preserveRanges.push({ start, end: this.field.text.length })
  }

  protected convert_BracedComment(node: bibtex.BracedComment) {
    this.comments.push(node.value)
  }
  protected convert_LineComment(node: bibtex.LineComment) {
    this.comments.push(node.value)
  }

  private splitOnce(s, sep, fromEnd = false) {
    const split = fromEnd ? s.lastIndexOf(sep) : s.indexOf(sep)
    return (split < 0) ? [s, ''] : [ s.substr(0, split), s.substr(split + 1) ]
  }
  private parseName(name) {
    let parsed: Name = null

    const parts = name.split(marker.comma)

    if (parts.length && !parts.find(p => !p.match(/^[a-z]+=/i))) { // extended name format
      parsed = {}

      for (const part of parts) {
        const [ attr, value ] = this.splitOnce(part.replace(marker.re.space, ''), '=').map(v => v.trim())
        switch (attr.toLowerCase()) {
          case 'family':
            parsed.lastName = value
            break

          case 'given':
            parsed.firstName = value
            break

          case 'prefix':
            parsed.prefix = value
            break

          case 'suffix':
            parsed.suffix = value
            break

          case 'useprefix':
            parsed.useprefix = value.toLowerCase() === 'true'
            break

        }
      }
    }

    const prefix = /(.+?)\s+(vere|von|van den|van der|van|de|del|della|der|di|da|pietro|vanden|du|st.|st|la|lo|ter|bin|ibn|te|ten|op|ben|al)\s+(.+)/
    let m
    switch (parsed ? -1 : parts.length) {
      case -1:
        // already parsed
        break

      case 0: // should never happen
        throw new Error(name)

      case 1: // name without commas
        // literal
        if (marker.re.literalName.test(parts[0])) {
          parsed = { literal: parts[0] }

        } else if (m = parts[0].replace(marker.re.space, ' ').match(prefix)) { // split on prefix
          parsed = {
            firstName: m[1],
            prefix: m[2],
            lastName: m[3], // tslint:disable-line no-magic-numbers
          }

        } else {
          // top-level "firstname lastname"
          const [ firstName, lastName ] = this.splitOnce(parts[0], marker.space, true)
          if (lastName) {
            parsed = { firstName, lastName }
          } else {
            parsed = { lastName: firstName }
          }
        }
        break

      case 2: // lastname, firstname
        parsed = {
          lastName: parts[0],
          firstName: parts[1],
        }
        break

      default: // lastname, suffix, firstname
        parsed = {
          lastName: parts[0],
          suffix: parts[1],
          firstName: parts.slice(2).join(marker.comma),
        }
    }

    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') continue
      parsed[k] = v.replace(marker.re.space, ' ').replace(marker.re.comma, ', ').replace(marker.re.literal, '').trim()
    }

    return parsed
  }

  protected convert_Entry(node: bibtex.Entry) {
    this.entry = {
      key: node.id,
      type: node.type,
      fields: {},
      creators: {},
    }
    this.entries.push(this.entry)

    // order these first for language-dependent sentence casing
    const order = ['langid', 'hyphenation', 'language']
    node.properties.sort((a, b) => {
      const ia = order.indexOf(a.key)
      const ib = order.indexOf(b.key)
      if (ia === -1 && ib === -1) return a.key.localeCompare(b.key) // doesn't matter really
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

    let sentenceCase = !!this.sentenceCase.length // if sentenceCase is empty, no sentence casing
    for (const prop of node.properties) {
      if (prop.kind !== 'Property') return this.error(new ParserError(`Expected Property, got ${prop.kind}`, node), undefined)
      this.setFieldType(prop.key)

      this.field = {
        name: prop.key,
        text: '',
        level: 0,
        words: {
          cased: 0,
          other: 0,
        },
        preserveRanges: (sentenceCase && fields.title.includes(prop.key)) ? [] : null,
      }

      this.entry.fields[this.field.name] = this.entry.fields[this.field.name] || []
      this.convert(prop.value)
      this.field.text = this.field.text.trim()
      if (!this.field.text) continue

      // disable sentenceCasing if not an english
      switch (this.field.name) {
        case 'langid':
        case 'hyphenation':
          sentenceCase = sentenceCase && this.sentenceCase.includes(this.field.text.toLowerCase())
          break

        case 'language':
          sentenceCase = sentenceCase && !!(this.field.text.toLowerCase().trim().split(/\s*,\s*/).find(lang => this.sentenceCase.includes(lang)))
          break
      }

      // "groups" is a jabref 3.8+ monstrosity
      if (this.field.name.match(/^(keywords?|groups)$/)) {
        for (let text of this.field.text.split(marker.comma)) {
          text = text.trim()
          if (text) this.entry.fields[this.field.name].push(text)
        }

      } else if (this.fieldType === 'creator') {
        if (!this.entry.creators[this.field.name]) this.entry.creators[this.field.name] = []

        // {M. Halle, J. Bresnan, and G. Miller}
        if (this.field.text.includes(`${marker.comma}${marker.and}`)) { //
          this.field.text = this.field.text.replace(new RegExp(`${marker.comma}${marker.and}`, 'g'), marker.and).replace(new RegExp(marker.comma), marker.and)
        }

        for (const creator of this.field.text.split(marker.and)) {
          this.entry.fields[this.field.name].push(creator.replace(marker.re.comma, ', ').replace(marker.re.space, ' ').replace(marker.re.literal, '"'))
          this.entry.creators[this.field.name].push(this.parseName(creator))
        }

      } else {
        if (this.field.preserveRanges) {
          let match
          preserveCase.sentenceStart.lastIndex = 0
          while ((match = preserveCase.sentenceStart.exec(this.field.text))) {
            this.field.preserveRanges.push({ start: match.index, end: match.index + match[0].length })
          }
          preserveCase.quoted.lastIndex = 0
          while ((match = preserveCase.quoted.exec(this.field.text))) {
            this.field.preserveRanges.push({ start: match.index, end: match.index + match[0].length })
          }
        }

        if (this.field.words.cased > this.field.words.other) this.field.preserveRanges = null
        this.entry.fields[this.field.name].push(this.convertToSentenceCase(this.field.text, this.field.preserveRanges))

      }

    }

    this.field = null
  }

  private convertToSentenceCase(text, preserve) {
    if (!preserve) return text

    preserve.push({start: 0, end: 1}) // always keep the leading char

    let sentenceCased = text.toLowerCase().replace(/(([\?!]\s*|^)([\'\"¡¿“‘„«\s]+)?[^\s])/g, x => x.toUpperCase())
    for (const { start, end } of preserve) {
      sentenceCased = sentenceCased.substring(0, start) + text.substring(start, end) + sentenceCased.substring(end)
    }
    return sentenceCased
  }

  protected convert_Number(node: bibtex.NumberValue) {
    this.field.text += `${node.value}`
  }

  protected convert_Text(node: bibtex.TextValue) {
    node.value = node.value.replace(/``/g, this.markup.enquote.open).replace(/''/g, this.markup.enquote.close)

    // heuristic to detect pre-sentencecased text
    const cased = {
      upper: 0,
      lower: 0,
    }
    for (const word of node.value.split(/\b/)) {
      if (word.match(preserveCase.allLower)) {
        cased.lower++
      } else if (word.match(preserveCase.allCaps)) {
        cased.upper++
      } else if (word.match(preserveCase.hasAlpha)) {
        this.field.words.other++
      }
    }
    this.field.words.cased = (cased.lower > cased.upper) ? cased.lower : cased.upper
    this.field.words.other += (cased.lower > cased.upper) ? cased.upper : cased.lower

    if (this.field.level === 0 && this.fieldType === 'creator') {
      this.field.text += node.value.replace(/\s+and\s+/ig, marker.and).replace(/\s*,\s*/g, marker.comma).replace(/\s+/g, marker.space)
      return
    }

    if (this.field.level === 0 && this.field.name.match(/^(keywords?|groups)$/)) {
      this.field.text += node.value.replace(/\s*[;,]\s*/g, marker.comma)
      return
    }

    if (this.field.preserveRanges) {
      const words = node.value.split(/(\s+)/)
      for (const word of words) {
        if (this.preserveCase(word)) this.field.preserveRanges.push({ start: this.field.text.length, end: this.field.text.length + word.length })
        this.field.text += word
      }
    } else {
      this.field.text += node.value
    }

  }

  protected convert_PreambleExpression(node: bibtex.PreambleExpression) { return }
  protected convert_StringExpression(node: bibtex.StringExpression) { return }

  protected convert_String(node: bibtex.StringValue) {
    this.convert(node.value)
  }

  protected convert_DisplayMath(node: RichNestedLiteral) {
    this.field.text += '\n\n'
    this.convert_NestedLiteral(node)
    this.field.text += '\n\n'
  }
  protected convert_InlineMath(node: RichNestedLiteral) {
    this.convert_NestedLiteral(node)
  }
  protected convert_NestedLiteral(node: RichNestedLiteral) {
    const prefix = []
    const postfix = []

    if (this.fieldType === 'other') delete node.markup.caseProtect
    if (this.fieldType === 'creator' && node.markup.caseProtect) {
      prefix.push(marker.literal)
      postfix.unshift(marker.literal)
      delete node.markup.caseProtect
    }

    // relies on objects remembering insertion order
    for (const markup of Object.keys(node.markup)) {
      if (!this.markup[markup]) return this.error(new ParserError(`markup: ${markup}`, node), undefined)
      prefix.push(this.markup[markup].open)
      postfix.unshift(this.markup[markup].close)
    }

    const end = {
      withoutPrefix: this.field.text.length,
      withPrefix: 0,
    }
    this.field.text += prefix.join('')
    end.withPrefix = this.field.text.length

    this.field.level++
    this.convert(node.value)
    this.field.level--

    if (this.field.text.length === end.withPrefix) { // nothing was added, so remove prefix
      this.field.text = this.field.text.substring(0, end.withoutPrefix)
    } else {
      this.field.text += postfix.reverse().join('')
    }

    this.field.text = this.field.text.replace(/<(sup|sub)>([^<>]+)<\/\1>$/i, (m, mode, chars) => {
      const cmd = mode === 'sup' ? '^' : '_'
      let script = ''
      for (const char of chars) {
        const unicode = latex2unicode[`${cmd}${char}`] || latex2unicode[`${cmd}{${char}}`]
        script += unicode ? unicode : `<${mode}>${char}</${mode}>`
      }
      script = script.replace(new RegExp(`</${mode}><${mode}>`, 'g'), '')
      return script.length < m.length ? script : m
    })
  }
}

/**
 * parse bibtex. This will try to convert TeX commands into unicode equivalents, and apply `@string` expansion
 */
export function parse(input: string, options: ParserOptions = {}): Bibliography | Promise<Bibliography> {
  const parser = new Parser({
    caseProtect: options.caseProtect,
    sentenceCase: options.sentenceCase,
    markup: options.markup,
    errorHandler: options.errorHandler,
  })
  return options.async ? parser.parseAsync(input, { verbatimFields: options.verbatimFields }) : parser.parse(input, { verbatimFields: options.verbatimFields })
}

export function ast(input: string, options: ParserOptions & { clean?: boolean } = {}) {
  const parser = new Parser({
    caseProtect: options.caseProtect,
    sentenceCase: options.sentenceCase,
    markup: options.markup,
    errorHandler: options.errorHandler,
  })
  return parser.ast(input, { clean: options.clean, verbatimFields: options.verbatimFields })
}

export { parse as chunker } from './chunker'
export { parse as jabref } from './jabref'
