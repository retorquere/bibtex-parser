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

type Entry = {
  key: string,
  type: string
  fields: { [key: string]: string[] }
}

type FieldBuilder = {
  name: string
  creator: boolean
  text: string
  level: number
  exemptFromSentencecase: Array<{ start: number, end: number }>
}

type MarkupMapping = {
  sub?: { open: string, close: string }
  sup?: { open: string, close: string }
  bold?: { open: string, close: string }
  italics?: { open: string, close: string }
  smallCaps?: { open: string, close: string }
  caseProtect?: { open: string, close: string }
  caseProtectCreator?: { open: string, close: string }
  enquote?: { open: string, close: string }

  roman?: { open: string, close: string }
  fixedWidth?: { open: string, close: string }
}

export type Bibliography = {
  errors: ParseError[]
  entries: Entry[]
  comments: string[]
  strings: { [key: string]: string }
}

export type ParseError = {
  message: string
  source?: string
  line?: number
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
  sentenceCase: [
    'title',
    'series',
    'shorttitle',
    'booktitle',
    'type',
    'origtitle',
    'maintitle',
    'eventtitle',
  ],
}

class Parser {
  private errors: ParseError[]
  private strings: { [key: string]: any[] }
  private months: { [key: string]: any[] }
  private comments: string[]
  private entries: Entry[]
  private entry: Entry
  private field: FieldBuilder
  private errorHandler: (message: string) => void
  private markup: MarkupMapping
  private caseProtect: boolean
  private sentenceCase: boolean

  constructor(options: { caseProtect?: boolean, sentenceCase?: boolean, markup?: MarkupMapping, errorHandler?: (message: string) => void } = {}) {
    this.caseProtect = typeof options.caseProtect === 'undefined' ? true : options.caseProtect
    this.sentenceCase = typeof options.sentenceCase === 'undefined' ? true : options.sentenceCase

    this.markup = {
      enquote: { open: '"', close: '"' },
      sub: { open: '<sub>', close: '</sub>' },
      sup: { open: '<sup>', close: '</sup>' },
      bold: { open: '<b>', close: '</b>' },
      italics: { open: '<i>', close: '</i>' },
      smallCaps: { open: '<span style="font-variant:small-caps;">', close: '</span>' },
      caseProtectCreator: { open: '"', close: '"' },
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
    this.months = {
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
    }
  }

  public parse(input): Bibliography {
    for (const chunk of chunker(input)) {
      this.parseChunk(chunk)
    }
    return this.parsed()
  }

  public async parseAsync(input): Promise<Bibliography> {
    for (const chunk of await chunker(input, { async: true })) {
      this.parseChunk(chunk)
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
        exemptFromSentencecase: null,
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

  private parseChunk(chunk) {
    try {
      const ast = this.cleanup(bibtex.parse(chunk.text), !this.caseProtect)
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
      return this.error(this.show(node), undefined)
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
      if (child.kind === 'Text' && !child.value) return false

      // \frac can either be "\frac{n}{d}" or "\frac n d"
      if (child.kind === 'RegularCommand' && child.value === 'frac' && !child.arguments.length) {
        if ((node.value[i + 1] || {}).kind === 'Text' && node.value[i + 1].value.match(/^\s+[a-z0-9]+\s+[a-z0-9]+$/i)) {
          child.arguments = node.value[i + 1].value.trim().split(/\s+/).map(v => ({ kind: 'RequiredArgument', value: [ this.text(v) ] }))
          node.value[i + 1].value = ''
          return true
        }
      }

      if (child.kind === 'RegularCommand' && markup[child.value] && !child.arguments.length) {
        if (node.markup) {
          node.markup.caseProtect = false
          node.markup[markup[child.value]] = true
        }
        return false
      }

      return true
    })

    node.value = node.value.map(child => this.cleanup(child, nocased || (node.markup && (node.markup.caseProtect || node.markup.exemptFromSentencecase))))

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
    delete node.loc

    if (!this['clean_' + node.kind]) return this.error(this.show(node), this.text())
    return this['clean_' + node.kind](node, nocased)
  }

  protected clean_BracedComment(node, nocased) { return node }
  protected clean_LineComment(node, nocased) { return node }

  protected clean_File(node, nocased) {
    node.children = node.children.filter(child => child.kind !== 'NonEntryText').map(child => this.cleanup(child, nocased))
    return node
  }

  protected clean_StringExpression(node, nocased) { // should have been StringDeclaration
    this.strings[node.key.toUpperCase()] = node.value
    return node
  }

  protected clean_String(node, nocased) { // should have been StringReference
    const _string = this.strings[node.value.toUpperCase()] || this.months[node.value.toUpperCase()]

    if (!_string) this.errors.push({ message: `Unresolved @string reference ${JSON.stringify(node.value)}` })

    // if the string isn't found, add it as-is but exempt it from sentence casing
    return this.cleanup({
      kind: 'NestedLiteral',
      markup: {
        caseProtect: false,
        exemptFromSentenceCase: !_string,
      },
      value: _string ? JSON.parse(JSON.stringify(_string)) : [ this.text(node.value) ],
    }, nocased)
  }

  protected clean_Entry(node, nocased) {
    node.properties = node.properties.map(child => this.cleanup(child, nocased))
    return node
  }

  protected clean_Property(node, nocased) {
    // because this was abused so much, many processors ignore second-level too
    if (node.value.length === 1 && node.value[0].kind === 'NestedLiteral') {
      node.value[0].markup = {
        caseProtect: false,
        exemptFromSentenceCase: true,
      }
    }

    this.condense(node, !this.caseProtect)
    return node
  }

  protected clean_Text(node, nocased) { return node }
  protected clean_MathMode(node, nocased) { return node }

  protected clean_RegularCommand(node, nocased) {
    let arg, unicode

    switch (node.value) {
      case 'vphantom':
        return this.text()

      case 'frac':
        // not a spectactular solution but what ya gonna do.
        if (arg = this.argument(node, 2)) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: {
              caseProtect: false,
              exemptFromSentenceCase: true,
            },
            value: [ this.text(`${arg[0]}/${arg[1]}`) ],
          }, nocased)
        }
        break

      case 'href':
        if (arg = this.argument(node, 2)) {
          return this.text(arg[0])
        }
        break

      case 'path':
      case 'aftergroup':
      case 'ignorespaces':
      case 'noopsort':
        return this.text()

      case 'chsf':
        if (this.argument(node, 'none')) return this.text()
        if (arg = this.argument(node, 'array')) return this.text(arg)
        return node

      case 'bibstring':
        if (arg = this.argument(node, 'Text')) return this.text(arg)
        break

      case 'cite':
        if (arg = this.argument(node, 1)) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: {
              caseProtect: false,
              exemptFromSentenceCase: true,
            },
            value: [ this.text(arg[0]) ],
          }, nocased)
        }
        break

      case 'textsuperscript':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { sup: true },
          value: arg,
        }, nocased)
        break

      case 'textsubscript':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { sub: true },
          value: arg,
        }, nocased)
        break

      case 'textsc':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { smallCaps: true },
          value: arg,
        }, nocased)
        break

      case 'enquote':
      case 'mkbibquote':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { enquote: true },
          value: arg,
        }, nocased)
        break

      case 'textbf':
      case 'mkbibbold':
        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { bold: true },
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
          markup: { italics: true },
          value: arg,
        }, nocased)
        break

      case 'bibcyr':
        if (this.argument(node, 'none')) return this.text()

        if (!(arg = this.argument(node, 'array'))) return this.error(node.value + this.show(node), this.text())
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: {},
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
            markup: {},
            value: arg,
          }, nocased)
        }
        break

      case 'url':
        if (arg = this.argument(node, 'Text')) return this.text(arg)
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

    return this.error('Unhandled command::' + this.show(node), this.text())
    // console.log('Unhandled command::' + this.show(node))
    return node
  }

  protected clean_SubscriptCommand(node, nocased) {
    let value, singlechar
    if (typeof node.value === 'string' && (singlechar = latex2unicode[`_${node.value}`] || latex2unicode[`_{${node.value}}`])) {
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
      markup: { sub: true },
      value,
    }, nocased)
  }

  protected clean_SuperscriptCommand(node, nocased) {
    let value, singlechar
    if (typeof node.value === 'string' && (singlechar = latex2unicode[`^${node.value}`] || latex2unicode[`^{${node.value}}`])) {
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
      markup: { sup: true },
      value,
    }, nocased)
  }

  protected clean_NestedLiteral(node, nocased) {
    if (!node.markup) node.markup = { caseProtect: !nocased }

    // https://github.com/retorquere/zotero-better-bibtex/issues/541#issuecomment-240156274
    if (node.value.length && ['RegularCommand', 'DicraticalCommand'].includes(node.value[0].kind)) {
      node.markup.caseProtect = false

    } else if (node.value.length && node.value[0].kind === 'Text') {
      if (!node.value[0].value.split(/\s+/).find(word => !this.protectedWord(word))) {
        node.markup.caseProtect = false
        node.markup.exemptFromSentenceCase = true
      }
    }

    this.condense(node, nocased)
    return node
  }

  protected clean_DicraticalCommand(node, nocased) { // Should be DiacraticCommand
    const char = typeof node.character === 'string' ? node.character : `\\${node.character.value}`
    const unicode = latex2unicode[`\\${node.mark}{${char}}`]
      || latex2unicode[`\\${node.mark}${char}`]
      || latex2unicode[`{\\${node.mark} ${char}}`]
      || latex2unicode[`{\\${node.mark}${char}}`]
      || latex2unicode[`\\${node.mark} ${char}`]

    if (!unicode) return this.error(`Unhandled {\\${node.mark} ${char}}`, this.text())
    return this.text(unicode)
  }

  protected clean_SymbolCommand(node, nocased) {
    return this.text(latex2unicode[`\\${node.value}`] || node.value)
  }

  protected clean_PreambleExpression(node, nocased) { return node }

  private protectedWord(word) { return false }

  private convert(node) {
    if (Array.isArray(node)) return node.map(child => this.convert(child)).join('')

    if (!this['convert_' + node.kind]) return this.error(this.show(node), undefined)
    this['convert_' + node.kind](node)
  }

  protected convert_BracedComment(node) {
    this.comments.push(node.value)
  }
  protected convert_LineComment(node) {
    this.comments.push(node.value)
  }

  protected convert_Entry(node) {
    this.entry = {
      key: node.id,
      type: node.type,
      fields: {},
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
        exemptFromSentencecase: this.sentenceCase && fields.sentenceCase.includes(name) ? [] : null,
      }

      this.entry.fields[this.field.name] = this.entry.fields[this.field.name] || []
      this.convert(prop.value)
      this.field.text = this.field.text.trim()
      if (this.field.text) this.entry.fields[this.field.name].push(this.convertToSentenceCase(this.field.text, this.field.exemptFromSentencecase))
    }
  }

  private convertToSentenceCase(text, exemptions) {
    if (!exemptions) return text

    let sentenceCased = text.toLowerCase().replace(/(([\?!]\s*|^)([\'\"¡¿“‘„«\s]+)?[^\s])/g, x => x.toUpperCase())
    for (const { start, end } of exemptions) {
      sentenceCased = sentenceCased.substring(0, start) + text.substring(start, end) + sentenceCased.substring(end)
    }
    return sentenceCased
  }

  private splitField() {
    if (this.field.level > 0) return this.error(this.show(this.field), undefined)
    this.field.text = this.field.text.trim()
    if (this.field.text) this.entry.fields[this.field.name].push(this.convertToSentenceCase(this.field.text, this.field.exemptFromSentencecase))

    this.field.text = ''
    if (this.field.exemptFromSentencecase) this.field.exemptFromSentencecase = []
  }

  protected convert_Number(node) {
    this.field.text += `${node.value}`
  }

  protected convert_Text(node) {
    let text = [ node.value ]

    if (this.field.level === 0) {
      if (this.field.creator) {
        text = node.value.split(/\s+and\s+/)

      } else if (this.field.name === 'keywords') {
        text = node.value.split(/[;,]/)

      }
    }

    this.field.text += text[0]

    for (const t of text.slice(1)) {
      this.splitField()
      this.field.text += t
    }
  }

  protected convert_MathMode(node) { return }
  protected convert_PreambleExpression(node) { return }
  protected convert_StringExpression(node) { return }

  protected convert_NestedLiteral(node) {
    const prefix = []
    const postfix = []

    const start = this.field.text.length
    let exemptFromSentenceCase = false
    for (let [markup, apply] of Object.entries(node.markup).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!apply) continue

      exemptFromSentenceCase = exemptFromSentenceCase || markup === 'caseProtect' || markup === 'exemptFromSentenceCase'
      if (markup === 'exemptFromSentenceCase') continue

      if (markup === 'caseProtect' && this.field.creator) markup += 'Creator'
      if (!this.markup[markup]) return this.error(`markup: ${markup}`, undefined)
      prefix.push(this.markup[markup].open)
      postfix.unshift(this.markup[markup].close)
    }

    this.field.text += prefix.join('')
    this.field.level++
    this.convert(node.value)
    this.field.level--
    this.field.text += postfix.reverse().join('')
    if (exemptFromSentenceCase && this.field.exemptFromSentencecase) this.field.exemptFromSentencecase.push({ start, end: this.field.text.length })
  }
}

export function parse(input: string, options: { sentenceCase?: boolean, caseProtect?: boolean, markup?: MarkupMapping, async?: boolean, errorHandler?: any } = {}) {
  const parser = new Parser({
    caseProtect: options.caseProtect,
    sentenceCase: options.sentenceCase,
    markup: options.markup,
    errorHandler: options.errorHandler,
  })
  return options.async ? parser.parseAsync(input) : parser.parse(input)
}

export { parse as chunker } from './chunker'
export { parse as jabref } from './jabref'
