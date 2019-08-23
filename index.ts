import bibtex = require('./astrocite-bibtex')
import { parse as chunker } from './chunker'
import latex2unicode = require('./latex2unicode')

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

const marker = {
  and: '\u0001',
  comma: '\u0002',
  space: '\u0003',
  literal: '\u0004',
}
const markerRE = {
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
  creator: boolean
  text: string
  level: number
  words: {
    lowercase: number
    other: number
  }
  exemptFromSentenceCase: Array<{ start: number, end: number }>
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
   * BibTeX files are expected to store title-type fields in Sentence Case, where other reference managers (such as Zotero) expect them to be stored as Sentence case. When this option is on,
   * the parser will attempt to sentence-case title-type fields as they are being parsed. This uses heuristics and does not employ any kind of natural language processing, so you should always inspect the results.
   */
  sentenceCase?: boolean

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
  errorHandler?: (message: string) => void

  /**
   * Some fields such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands. You can change the default list here if you want,
   * for example to help parse Mendeley `file` fields, which against spec are not in verbatim mode.
   */
  verbatimFields?: string[]
}

class Parser {
  private errors: ParseError[]
  private strings: { [key: string]: any[] }
  private unresolvedStrings: { [key: string]: boolean }
  private default_strings: { [key: string]: any[] }
  private comments: string[]
  private entries: Entry[]
  private entry: Entry
  private field: FieldBuilder
  private errorHandler: (message: string) => void
  private markup: MarkupMapping
  private caseProtect: boolean
  private sentenceCase: boolean

  constructor(options: ParserOptions = {}) {
    this.unresolvedStrings = {}
    this.caseProtect = typeof options.caseProtect === 'undefined' ? true : options.caseProtect
    this.sentenceCase = typeof options.sentenceCase === 'undefined' ? true : options.sentenceCase

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

    // tslint:disable-next-line only-arrow-functions
    this.errorHandler = (options.errorHandler || function(msg) { throw new Error(msg) })

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
    for (const [key, value] of Object.entries(this.strings)) {
      this.field = {
        name: '@string',
        creator: false,
        text: '',
        level: 0,
        words: {
          lowercase: 0,
          other: 0,
        },
        exemptFromSentenceCase: null,
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
    try {
      const ast = this.cleanup(bibtex.parse(chunk.text, { verbatimProperties: options.verbatimFields }), !this.caseProtect)
      if (ast.kind !== 'File') throw new Error(this.show(ast))

      for (const node of ast.children) {
        this.convert(node)
      }

    } catch (err) {
      if (!err.location) throw err
      this.errors.push({
        message: err.message,
        line: err.location.start.line + chunk.offset.line,
        column: err.location.start.column,
      })
    }
  }

  private show(o) {
    return JSON.stringify(o)
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
      return this.error(`cannot condense a ${node.value.kind}: ${this.show(node)}`, undefined)
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
    node.value = node.value.filter((child, i) => {
      // if (child.kind === 'Text' && !child.value) return false

      const next = node.value[i + 1] || {}

      // \frac can either be "\frac{n}{d}" or "\frac n d" -- shudder
      if (child.kind === 'RegularCommand' && child.value === 'frac' && !child.arguments.length) {
        if (next.kind === 'Text' && next.value.match(/^\s+[a-z0-9]+\s+[a-z0-9]+$/i)) {
          child.arguments = next.value.trim().split(/\s+/).map(v => ({ kind: 'RequiredArgument', value: [ this.text(v) ] }))
          next.value = ''
          return true
        }

      // spaces after a bare command are consumed
      } else if (child.kind === 'RegularCommand' && !child.arguments.length && next.kind === 'Text' && next.value.match(/^\s+/)) {
        // despite Mozilla's claim that trimStart === trimLeft, and that trimStart should be preferred, trimStart does not seem to exist in FF chrome code.
        next.value = next.value.trimLeft()
      }

      if (child.kind === 'RegularCommand' && markup[child.value] && !child.arguments.length) {
        if (node.markup) {
          node.markup.delete('caseProtect')
          node.markup.add(markup[child.value])
          if (markup[child.value] === 'smallCaps') node.exemptFromSentenceCase = true
        }
        return false
      }

      return true
    })

    node.value = node.value.map(child => this.cleanup(child, nocased || (node.markup && (node.markup.has('caseProtect') || node.exemptFromSentenceCase))))

    node.value = node.value.reduce((acc, child) => {
      const last = acc.length - 1
      if (acc.length === 0 || child.kind !== 'Text' || acc[last].kind !== 'Text') {
        acc.push(child)
      } else {
        acc[last].value += child.value
      }
      return acc
    }, [])
  }

  private argument(node, type) {
    if (type === 'none') {
      if (!node.arguments.length) return true
      if (node.arguments.find(arg => arg.kind !== 'RequiredArgument' || arg.value.length)) return false
      return true
    }

    if (typeof type === 'number') {
      if (node.arguments.length !== type || node.arguments.find(arg => arg.value.length !== 1 || arg.value[0].kind !== 'Text')) return false
      return node.arguments.map(arg => arg.value[0].value)
    }

    if (!node.arguments || node.arguments.length !== 1 || node.arguments.find(arg => arg.kind !== 'RequiredArgument')) return false

    switch (type) {
      case 'array':
        return node.arguments[0].value

      case 'Text':
      case 'RegularCommand':
        return node.arguments[0].value.length === 1 && node.arguments[0].value[0].kind === type ? node.arguments[0].value[0].value : false
    }
    return false
  }

  private cleanup(node, nocased) {
    if (Array.isArray(node)) return node.map(child => this.cleanup(child, nocased))

    delete node.loc

    if (!this['clean_' + node.kind]) return this.error(`no cleanup method for '${node.kind}' (${this.show(node)})`, this.text())
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
      exemptFromSentenceCase: !_string,
      value: this.cleanup(_string ? JSON.parse(JSON.stringify(_string)) : [ this.text(node.value) ], nocased),
    }
  }

  protected clean_Entry(node: bibtex.Entry, nocased) {
    node.properties = node.properties.map(child => this.cleanup(child, nocased))
    return node
  }

  protected clean_Property(node: bibtex.Property, nocased) {
    // because this was abused so much, many processors ignore second-level too
    if (fields.title.concat(fields.unnest).includes(node.key.toLowerCase()) && node.value.length === 1 && node.value[0].kind === 'NestedLiteral') {
      (node.value[0] as bibtex.RichNestedLiteral).markup = new Set;
      (node.value[0] as bibtex.RichNestedLiteral).exemptFromSentenceCase = true
    }

    this.condense(node, !this.caseProtect)
    return node
  }

  protected clean_Text(node: bibtex.TextValue, nocased) { return node }

  protected clean_MathMode(node: bibtex.MathMode, nocased) { return node }

  protected clean_RegularCommand(node: bibtex.RegularCommand, nocased) {
    let arg, unicode

    switch (node.value) {
      case 'vphantom':
        return this.text()

      case 'frac':
        // not a spectactular solution but what ya gonna do.
        if (arg = this.argument(node, 2)) {
          return this.cleanup({
            kind: 'NestedLiteral',
            exemptFromSentenceCase: true,
            markup: new Set,
            value: [ this.text(`${arg[0]}/${arg[1]}`) ],
          }, nocased)
        }
        break

      case 'path':
      case 'aftergroup':
      case 'ignorespaces':
      case 'noopsort':
        return this.text()

      case 'chsf':
        if (this.argument(node, 'none')) return this.text()
        if (arg = this.argument(node, 'array')) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: new Set,
            value: arg,
          }, nocased)
        }
        return node

      case 'bibstring':
        if (arg = this.argument(node, 'Text')) return this.text(arg)
        break

      case 'cite':
        if (arg = this.argument(node, 1)) {
          return this.cleanup({
            kind: 'NestedLiteral',
            exemptFromSentenceCase: true,
            markup: new Set,
            value: [ this.text(arg[0]) ],
          }, nocased)
        }
        break

      case 'textsuperscript':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: new Set(['sup']),
          value: arg,
        }, nocased)
        break

      case 'textsubscript':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: new Set(['sub']),
          value: arg,
        }, nocased)
        break

      case 'textsc':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          exemptFromSentenceCase: true,
          markup: new Set(['smallCaps']),
          value: arg,
        }, nocased)
        break

      case 'enquote':
      case 'mkbibquote':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: new Set(['enquote']),
          value: arg,
        }, nocased)
        break

      case 'textbf':
      case 'mkbibbold':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: new Set(['bold']),
          value: arg,
        }, nocased)
        break

      case 'mkbibitalic':
      case 'mkbibemph':
      case 'textit':
      case 'emph':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: new Set(['italics']),
          value: arg,
        }, nocased)
        break

      case 'bibcyr':
        if (this.argument(node, 'none')) return this.text()

        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: new Set,
          value: arg,
        }, nocased)
        break

      case 'mathrm':
      case 'textrm':
      case 'ocirc':
      case 'mbox':
        if (arg = this.argument(node, 'Text')) {
          unicode = latex2unicode[`\\${node.value}{${arg}}`]
          return this.text(unicode || arg)
        } else if (!node.arguments.length) {
          return this.text()
        } else if (arg = this.argument(node, 'array')) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: new Set,
            value: arg,
          }, nocased)
        }
        break

      case 'href':
        if (arg = this.argument(node, 2)) {
          return this.text(arg[0])
        }
        break

      case 'url':
        if (arg = this.argument(node, 'Text')) return this.text(arg)
        if (arg = this.argument(node, 'array')) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: new Set,
            value: arg,
          }, nocased)
        }
        break

      default:
        unicode = latex2unicode[`\\${node.value}`] || latex2unicode[`\\${node.value}{}`]
        if (unicode && this.argument(node, 'none')) {
          return this.text(unicode)
        }

        if (arg = this.argument(node, 'Text')) {
          if (unicode = latex2unicode[`\\${node.value}{${arg}}`]) {
            return this.text(unicode)
          }
        }
    }

    return this.error('Unhandled command: ' + this.show(node), this.text())
    return node
  }

  private _clean_ScriptCommand(node, nocased, mode) {
    let value, singlechar
    const cmd = mode === 'sup' ? '^' : '_'
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
    return this.cleanup({
      kind: 'NestedLiteral',
      markup: new Set([mode]),
      value,
    }, nocased)
  }
  protected clean_SubscriptCommand(node: bibtex.SubscriptCommand, nocased) {
    return this._clean_ScriptCommand(node, nocased, 'sub')
  }

  protected clean_SuperscriptCommand(node: bibtex.SuperscriptCommand, nocased) {
    return this._clean_ScriptCommand(node, nocased, 'sup')
  }

  protected clean_NestedLiteral(node: bibtex.RichNestedLiteral, nocased) {
    if (!node.markup) node.markup = nocased ? new Set() : new Set(['caseProtect'])

    // https://github.com/retorquere/zotero-better-bibtex/issues/541#issuecomment-240156274
    if (node.value.length && ['RegularCommand', 'DicraticalCommand'].includes(node.value[0].kind)) {
      node.markup.delete('caseProtect')

    } else if (node.value.length && node.value[0].kind === 'Text') {
      if (!(node.value[0] as bibtex.TextValue).value.split(/\s+/).find(word => !this.implicitlyNoCased(word))) {
        node.markup.delete('caseProtect')
        node.exemptFromSentenceCase = true
      }
    }

    this.condense(node, nocased)

    return node
  }

  protected clean_DicraticalCommand(node: bibtex.DicraticalCommand, nocased) { // Should be DiacraticCommand
    const char = node.dotless ? `\\${node.character}` : node.character
    const unicode = latex2unicode[`\\${node.mark}{${char}}`]
      || latex2unicode[`\\${node.mark}${char}`]
      || latex2unicode[`{\\${node.mark} ${char}}`]
      || latex2unicode[`{\\${node.mark}${char}}`]
      || latex2unicode[`\\${node.mark} ${char}`]

    if (!unicode) return this.error(`Unhandled {\\${node.mark} ${char}}`, this.text())
    return this.text(unicode)
  }

  protected clean_SymbolCommand(node: bibtex.SymbolCommand, nocased) {
    return this.text(latex2unicode[`\\${node.value}`] || node.value)
  }

  protected clean_PreambleExpression(node: bibtex.PreambleExpression, nocased) { return node }

  private implicitlyNoCased(word) {
    // word = word.replace(new RegExp(`"[${this.markup.enquote.open}${this.markup.enquote.close}:()]`, 'g'), '')
    word = word.replace(/[:()]/g, '')
    if (word.match(/^[A-Z][^A-Z]+$/)) return false
    if (word.length > 1 && word.match(/^[A-Z][a-z]*(-[A-Za-z]+)*$/)) return false
    if (word.match(/[A-Z]/)) return true
    if (word.match(/^[0-9]+$/)) return true
    return false
  }

  private convert(node) {
    if (Array.isArray(node)) return node.map(child => this.convert(child)).join('')

    if (!this['convert_' + node.kind]) return this.error(`no converter for ${node.kind}: ${this.show(node)}`, undefined)

    const start = this.field ? this.field.text.length : null

    this['convert_' + node.kind](node)

    const exemptFromSentenceCase = (
      typeof start === 'number'
      && this.field.exemptFromSentenceCase
      && (
        node.exemptFromSentenceCase
        ||
        (node.markup && node.markup.has('caseProtect'))
      )
    )
    if (exemptFromSentenceCase) this.field.exemptFromSentenceCase.push({ start, end: this.field.text.length })
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
        const [ attr, value ] = this.splitOnce(part.replace(markerRE.space, ''), '=').map(v => v.trim())
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
        if (markerRE.literalName.test(parts[0])) {
          parsed = { literal: parts[0] }

        } else if (m = parts[0].replace(markerRE.space, ' ').match(prefix)) { // split on prefix
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

    for (let [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') continue

      // why do people have '{Lastname}, Firstname'?
      if (markerRE.literalName.test(v)) v = v.replace(markerRE.literal, '"').slice(1, -1)
      parsed[k] = v.replace(markerRE.space, ' ').replace(markerRE.comma, ', ').replace(markerRE.literal, '"').trim()
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

    for (const prop of node.properties) {
      if (prop.kind !== 'Property') return this.error(`Expected Property, got ${prop.kind}`, undefined)

      const name = prop.key.toLowerCase()
      this.field = {
        name,
        creator: fields.creator.includes(prop.key.toLowerCase()),
        text: '',
        level: 0,
        words: {
          lowercase: 0,
          other: 0,
        },
        exemptFromSentenceCase: this.sentenceCase && fields.title.includes(name) ? [] : null,
      }

      this.entry.fields[this.field.name] = this.entry.fields[this.field.name] || []
      this.convert(prop.value)
      this.field.text = this.field.text.trim()
      if (!this.field.text) continue

      // "groups" is a jabref 3.8+ monstrosity
      if (this.field.name.match(/^(keywords?|groups)$/)) {
        for (let text of this.field.text.split(marker.comma)) {
          text = text.trim()
          if (text) this.entry.fields[this.field.name].push(text)
        }

      } else if (this.field.creator) {
        if (!this.entry.creators[this.field.name]) this.entry.creators[this.field.name] = []

        // {M. Halle, J. Bresnan, and G. Miller}
        if (this.field.text.includes(`${marker.comma}${marker.and}`)) { //
          this.field.text = this.field.text.replace(new RegExp(`${marker.comma}${marker.and}`, 'g'), marker.and).replace(new RegExp(marker.comma), marker.and)
        }

        for (const creator of this.field.text.split(marker.and)) {
          this.entry.fields[this.field.name].push(creator.replace(markerRE.comma, ', ').replace(markerRE.space, ' ').replace(markerRE.literal, '"'))
          this.entry.creators[this.field.name].push(this.parseName(creator))
        }

      } else {
        if (this.field.words.lowercase > this.field.words.other) this.field.exemptFromSentenceCase = null
        this.entry.fields[this.field.name].push(this.convertToSentenceCase(this.field.text, this.field.exemptFromSentenceCase))

      }
    }

    this.field = null
  }

  private convertToSentenceCase(text, exemptions) {
    if (!exemptions) return text

    let sentenceCased = text.toLowerCase().replace(/(([\?!]\s*|^)([\'\"¡¿“‘„«\s]+)?[^\s])/g, x => x.toUpperCase())
    for (const { start, end } of exemptions) {
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
    for (const word of node.value.split(/\b/)) {
      if (word.match(/^[a-z0-9]+$/)) {
        this.field.words.lowercase++
      } else if (word.match(/[a-z]/i)) {
        this.field.words.other++
      }
    }

    if (this.field.level === 0 && this.field.creator) {
      this.field.text += node.value.replace(/\s+and\s+/ig, marker.and).replace(/\s*,\s*/g, marker.comma).replace(/\s+/g, marker.space)
      return
    }

    if (this.field.level === 0 && this.field.name.match(/^(keywords?|groups)$/)) {
      this.field.text += node.value.replace(/\s*[;,]\s*/g, marker.comma)
      return
    }

    if (this.field.exemptFromSentenceCase) {
      for (const word of node.value.split(/(\s+)/)) {
        if (this.implicitlyNoCased(word)) this.field.exemptFromSentenceCase.push({ start: this.field.text.length, end: this.field.text.length + word.length })
        this.field.text += word
      }
      return
    }

    this.field.text += node.value
  }

  protected convert_MathMode(node: bibtex.MathMode) { return }
  protected convert_PreambleExpression(node: bibtex.PreambleExpression) { return }
  protected convert_StringExpression(node: bibtex.StringExpression) { return }

  protected convert_String(node: bibtex.StringValue) {
    this.convert(node.value)
  }

  protected convert_NestedLiteral(node: bibtex.RichNestedLiteral) {
    const prefix = []
    const postfix = []

    // relies on Set remembering insertion order
    for (const markup of (Array.from(node.markup) as string[])) {
      if (markup === 'caseProtect' && this.field.creator) {
        prefix.push(marker.literal)
        postfix.unshift(marker.literal)
        continue
      }

      if (!this.markup[markup]) return this.error(`markup: ${markup}`, undefined)
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

export { parse as chunker } from './chunker'
export { parse as jabref } from './jabref'
