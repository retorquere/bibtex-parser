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
  properties: { [key: string]: string[] }
}

type PropertyBuilder = {
  name: string
  creator: boolean
  text: string
  level: number
  exemptFromSentencecase: { start: number, end: number }[]
}

const creatorFields = [
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
]

class Parser {
  nodes: any[]
  errors: any[]
  strings: { [key: string]: any[] }
  comments: string[]
  entries: Entry[]
  entry: Entry
  property: PropertyBuilder

  constructor(input) {
    const chunks = chunker(input)

    this.errors = []
    this.comments = []
    this.entries = []
    this.strings = {
      JAN: [ { kind: 'Text', value: '01' } ],
      FEB: [ { kind: 'Text', value: '02' } ],
      MAR: [ { kind: 'Text', value: '03' } ],
      APR: [ { kind: 'Text', value: '04' } ],
      MAY: [ { kind: 'Text', value: '05' } ],
      JUN: [ { kind: 'Text', value: '06' } ],
      JUL: [ { kind: 'Text', value: '07' } ],
      AUG: [ { kind: 'Text', value: '08' } ],
      SEP: [ { kind: 'Text', value: '09' } ],
      OCT: [ { kind: 'Text', value: '10' } ],
      NOV: [ { kind: 'Text', value: '11' } ],
      DEC: [ { kind: 'Text', value: '12' } ],
    }

    for (const chunk of chunks) {
      try {
        const ast = this.cleanup(bibtex.parse(chunk.text))
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
  }

  show(o) {
    return JSON.stringify(o)
  }

  condense(node) {
    if (!Array.isArray(node.value)) {
      if (node.value.kind === 'Number') return
      throw new Error(this.show(node))
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
          child.arguments = node.value[i + 1].value.trim().split(/\s+/).map(v => ({ kind: 'RequiredArgument', value: [ { kind: 'Text', value: v } ] }))
          node.value[i + 1].value = ''
          return true
        }
      }

      if (child.kind === 'RegularCommand' && markup[child.value] && !child.arguments.length) {
        if (node.markup) {
          node.markup.noCase = false
          node.markup[markup[child.value]] = true
        }
        return false
      }

      return true
    })

    node.value = node.value.map(child => this.cleanup(child))

    node.value = node.value.reduce((acc, child) => {
      if (node.markup && child.unnest) node.markup.noCase = false

      const last = acc.length - 1
      if (acc.length === 0 || child.kind !== 'Text' || acc[last].kind !== 'Text') {
        acc.push(child)
      } else {
        acc[last].value += child.value
      }
      return acc
    }, [])
  }

  argument(node, type) {
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

  cleanup(node) {
    delete node.loc

    if (!this['clean_' + node.kind]) throw new Error(this.show(node))
    return this['clean_' + node.kind](node)
  }

  clean_BracedComment(node) { return node }
  clean_LineComment(node) { return node }

  clean_File(node) {
    node.children = node.children.filter(child => child.kind !== 'NonEntryText').map(child => this.cleanup(child))
    return node
  }

  clean_StringExpression(node) { // should have been StringDeclaration
    this.strings[node.key.toUpperCase()] = node.value
    return node
  }

  clean_String(node) { // should have been StringReference
    const string = this.strings[node.value.toUpperCase()]

    // if the string isn't found, add it as-is but exempt it from sentence casing
    return this.cleanup({
      kind: 'NestedLiteral',
      markup: {
        caseProtect: false,
        exemptFromSentenceCase: !string
      },
      value: string || [ { kind: 'Text', value: node.value } ]
    })
  }

  clean_Entry(node) {
    node.properties = node.properties.map(child => this.cleanup(child))
    return node
  }

  clean_Property(node) {
    // because this was abused so much, many processors ignore second-level too
    if (node.value.length === 1 && node.value[0].kind === 'NestedLiteral') {
      node.value[0].markup = {
        caseProtect: false,
        exemptFromSentenceCase: true,
      }
    }

    this.condense(node)
    return node
  }

  clean_Text(node) { return node }
  clean_MathMode(node) { return node }

  clean_RegularCommand(node) {
    let arg, unicode

    switch (node.value) {
      case 'vphantom':
        return { kind: 'Text', value: '' }

      case 'frac':
        // not a spectactular solution but what ya gonna do.
        if (arg = this.argument(node, 2)) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: {
              caseProtect: false,
              exemptFromSentenceCase: true,
            },
            value: [ { kind: 'Text', value: `${arg[0]}/${arg[1]}` } ]
          })
        }
        break

      case 'href':
        if (arg = this.argument(node, 2)) {
          return { kind: 'Text', value: arg[0] }
        }
        break

      case 'path':
      case 'aftergroup':
      case 'ignorespaces':
      case 'noopsort':
        return { kind: 'Text', value: '' }

      case 'chsf':
        if (this.argument(node, 'none')) return { kind: 'Text', value: '' }
        if (arg = this.argument(node, 'array')) return { kind: 'Text', value: arg }
        return node

      case 'bibstring':
        if (arg = this.argument(node, 'Text')) return { kind: 'Text', value: arg }
        break

      case 'cite':
        if (arg = this.argument(node, 1)) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: {
              caseProtect: false,
              exemptFromSentenceCase: true,
            },
            value: [ { kind: 'Text', value: arg[0] } ]
          })
        }
        break

      case 'textsuperscript':
        if (!(arg = this.argument(node, 'array'))) throw new Error(node.value + this.show(node))
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { sup: true },
          value: arg,
        })
        break

      case 'textsubscript':
        if (!(arg = this.argument(node, 'array'))) throw new Error(node.value + this.show(node))
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { sub: true },
          value: arg,
        })
        break

      case 'textsc':
        if (!(arg = this.argument(node, 'array'))) throw new Error(node.value + this.show(node))
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { smallCaps: true },
          value: arg,
        })
        break

      case 'enquote':
      case 'mkbibquote':
        if (!(arg = this.argument(node, 'array'))) throw new Error(node.value + this.show(node))
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { enquote: true },
          value: arg,
        })
        break

      case 'textbf':
      case 'mkbibbold':
        if (!(arg = this.argument(node, 'array'))) throw new Error(node.value + this.show(node))
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { bold: true },
          value: arg,
        })
        break

      case 'mkbibitalic':
      case 'mkbibemph':
      case 'textit':
      case 'emph':
        if (!(arg = this.argument(node, 'array'))) throw new Error(node.value + this.show(node))
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: { italics: true },
          value: arg,
        })
        break

      case 'bibcyr':
        if (this.argument(node, 'none')) return { kind: 'Text', value: '' }

        if (!(arg = this.argument(node, 'array'))) throw new Error(node.value + this.show(node))
        return this.cleanup({
          kind: 'NestedLiteral',
          markup: {},
          value: arg,
        })
        break

      case 'mathrm':
      case 'textrm':
      case 'ocirc':
      case 'mbox':
        if (arg = this.argument(node, 'Text')) {
          unicode = latex2unicode[`\\${node.value}{${arg}}`]
          return { kind: 'Text', value: unicode || arg }
        } else if (!node.arguments.length) {
          return { kind: 'Text', value: '' }
        } else if (arg = this.argument(node, 'array')) {
          return this.cleanup({
            kind: 'NestedLiteral',
            markup: {},
            value: arg,
          })
        }
        break

      case 'url':
        if (arg = this.argument(node, 'Text')) return { kind: 'Text', value: arg }
        break

      default:
        unicode = latex2unicode[`\\${node.value}`] || latex2unicode[`\\${node.value}{}`]
        if (unicode && this.argument(node, 'none')) {
          return { kind: 'Text', value: unicode }
        }

        if (arg = this.argument(node, 'Text')) {
          if (unicode = latex2unicode[`\\${node.value}{${arg}}`]) {
            return { kind: 'Text', value: unicode }
          }
        }
    }

    throw new Error('Unhandled command::' + this.show(node))
    // console.log('Unhandled command::' + this.show(node))
    return node
  }

  clean_NestedLiteral(node) {
    if (!node.markup) node.markup = { caseProtect: true }

    // https://github.com/retorquere/zotero-better-bibtex/issues/541#issuecomment-240156274
    if (node.value.length && ['RegularCommand', 'DicraticalCommand'].includes(node.value[0].kind)) {
      node.markup.caseProtect = false

    } else if (node.value.length && node.value[0].kind === 'Text') {
      if (!node.value[0].value.split(/\s+/).find(word => !this.protectedWord(word))) {
        node.markup.caseProtect = false
        node.markup.exemptFromSentenceCase = true
      }
    }

    this.condense(node)
    return node
  }

  clean_DicraticalCommand(node) { // Should be DiacraticCommand
    const char = typeof node.character === 'string' ? node.character : `\\${node.character.value}`
    const unicode = latex2unicode[`\\${node.mark}{${char}}`]
      || latex2unicode[`\\${node.mark}${char}`]
      || latex2unicode[`{\\${node.mark} ${char}}`]
      || latex2unicode[`{\\${node.mark}${char}}`]
      || latex2unicode[`\\${node.mark} ${char}`]

    if (!unicode) throw new Error(`Unhandled {\\${node.mark} ${char}}`)
    return { kind: 'Text', value: unicode }
  }

  clean_SymbolCommand(node) {
    return { kind: 'Text', value: node.value }
  }

  clean_PreambleExpression(node) { return node }

  protectedWord(word) { return false }

  convert(node) {
    if (Array.isArray(node)) return node.map(child => this.convert(child)).join('')

    if (!this['convert_' + node.kind]) throw new Error(this.show(node))
    this['convert_' + node.kind](node)
  }

  convert_BracedComment(node) {
    this.comments.push(node.value)
  }
  convert_LineComment(node) {
    this.comments.push(node.value)
  }

  convert_Entry(node) {
    this.entry = {
      key: node.id,
      type: node.type,
      properties: {}
    }
    this.entries.push(this.entry)

    for (const prop of node.properties) {
      if (prop.kind !== 'Property') throw new Error(`Expected Property, got ${prop.kind}`)

      this.property = {
        name: prop.key.toLowerCase(),
        creator: creatorFields.includes(prop.key.toLowerCase()),
        text: '',
        level: 0,
        exemptFromSentencecase: []
      }

      this.entry.properties[this.property.name] = this.entry.properties[this.property.name] || []
      this.convert(prop.value)
      this.property.text = this.property.text.trim()
      if (this.property.text) this.entry.properties[this.property.name].push(this.property.text)
    }
  }

  stackProperty() {
    if (this.property.level > 0) throw new Error(this.show(this.property))
    this.property.text = this.property.text.trim()
    if (this.property.text) this.entry.properties[this.property.name].push(this.property.text)

    this.property.text = ''
    this.property.exemptFromSentencecase = []
  }

  convert_Number(node) {
    this.property.text += `${node.value}`
  }

  convert_Text(node) {
    let text = [ node.value ]

    if (this.property.level === 0) {
      if (this.property.creator) {
        text = node.value.split(/\s+and\s+/)

      } else if (this.property.name === 'keywords') {
        text = node.value.split(/[;,]/)

      }
    }

    this.property.text += text[0]

    for (const t of text.slice(1)) {
      this.stackProperty()
      this.property.text += t
    }
  }

  convert_MathMode(node) { return }
  convert_PreambleExpression(node) { return }
  convert_StringExpression(node) { return }

  convert_NestedLiteral(node) {
    const prefix = []
    const postfix = []

    const start = this.property.text.length
    let exemptFromSentenceCase = false
    for (const [markup, apply] of Object.entries(node.markup).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!apply) continue
      switch (markup) {
        case 'roman':
        case 'fixedWidth':
          // ignore
          break

        case 'enquote':
          // TODO:
          break

        case 'sub':
          prefix.push('<sub>')
          postfix.push('</sub>')
          break

        case 'sup':
          prefix.push('<sup>')
          postfix.push('</sup>')
          break

        case 'bold':
          prefix.push('<i>')
          postfix.push('</i>')
          break

        case 'italics':
          prefix.push('<i>')
          postfix.push('</i>')
          break

        case 'smallCaps':
          prefix.push('<span style="font-variant:small-caps;">')
          postfix.push('</span>')
          break

        case 'caseProtect':
          if (this.property.creator) {
            prefix.push('"')
            postfix.push('"')
          } else {
            prefix.push('<span class="nocase">')
            postfix.push('</span>')
          }
          exemptFromSentenceCase = true
          break

        case 'exemptFromSentenceCase':
          exemptFromSentenceCase = true
          break

        default:
          throw new Error(`markup: ${markup}`)

      }
    }

    this.property.text += prefix.join('')
    this.property.level++
    this.convert(node.value)
    this.property.level--
    this.property.text += postfix.reverse().join('')
    if (exemptFromSentenceCase) this.property.exemptFromSentencecase.push({ start, end: this.property.text.length })
  }
}

export function parse(input) {
  const parsed = new Parser(input)
  return {
    errors: parsed.errors,
    entries: parsed.entries,
    comments: parsed.comments
  }
}

export { parse as chunker } from './chunker'
