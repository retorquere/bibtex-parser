const fs = require('fs')
const path = require('path')
const bibtex = require('./grammar')
const bibtexChunker = require('./chunker')
const latex2unicode = require('./latex2unicode')
import jsesc = require('jsesc')

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

class Parser {
  nodes: any[]
  errors: any[]

  constructor(input) {
    const chunks = bibtexChunker.parse(input)

    this.errors = []
    this.nodes = []

    for (const chunk of chunks) {
      try {
        const ast = this.cleanup(bibtex.parse(chunk.text))
        if (ast.kind !== 'File') throw new Error(this.show(ast))
        this.nodes = this.nodes.concat(ast.children)

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
    return jsesc(o, { compact: false, indent: '  ' })
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
    let unicode, arg

    delete node.loc
    switch (node.kind) {
      case 'BracedComment':
      case 'LineComment':
        break

      case 'File':
        node.children = node.children.filter(child => child.kind !== 'NonEntryText').map(child => this.cleanup(child))
        break

      case 'StringExpression':
      case 'StringDeclaration':
        node.kind == 'StringDeclaration'
        // needs to stay alive across chunks => move to object
        break

      case 'String':
      case 'StringReference':
        node.kind == 'StringReference'
        // resolve or change into a case-protected NestedLiteral
        break

      case 'Entry':
        // console.log(node.type, node.id)
        node.properties = node.properties.map(child => this.cleanup(child))
        break

      case 'Property':
        this.condense(node)
        break

      case 'Text':
        // console.log(node.value)
        break

      case 'MathMode':
         return node

      case 'RegularCommand':
        switch (node.value) {
          case 'vphantom':
            return { kind: 'Text', value: '' }

          case 'frac':
            if (arg = this.argument(node, 2)) {
              return node
            }
            break

          case 'href':
            if (arg = this.argument(node, 2)) {
              // if (arg[0] === arg[1]) return { kind: 'Text', value: arg[0] }
              return node
            }
            break

          case 'path':
          case 'aftergroup':
          case 'ignorespaces':
          case 'noopsort':
          case 'chsf':
            if (this.argument(node, 'none')) return { kind: 'Text', value: '' }
            return node

          case 'bibstring':
            if (arg = this.argument(node, 'Text')) return { kind: 'Text', value: arg }
            break

          case 'cite':
            return node

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
        break

      case 'NestedLiteral':
        if (!node.markup) node.markup = { caseProtect: true }
        this.condense(node)
        break

      // Should be DiacraticCommand
      case 'DicraticalCommand':
        const char = typeof node.character === 'string' ? node.character : `\\${node.character.value}`
        unicode = latex2unicode[`\\${node.mark}{${char}}`]
          || latex2unicode[`\\${node.mark}${char}`]
          || latex2unicode[`{\\${node.mark} ${char}}`]
          || latex2unicode[`{\\${node.mark}${char}}`]
          || latex2unicode[`\\${node.mark} ${char}`]

        if (!unicode) throw new Error(`Unhandled {\\${node.mark} ${char}}`)
        return { kind: 'Text', value: unicode }
        break

      case 'SymbolCommand':
        return { kind: 'Text', value: node.value }
        break

      case 'PreambleExpression':
        break

      default:
        throw new Error(this.show(node))
        break
    }

    return node
  }
}

function parse(file) {
  console.log(file)
  const input = fs.readFileSync(file, 'utf-8')
  const parsed = new Parser(input)
  fs.writeFileSync('dump/' + path.basename(file, path.extname(file)) + '.json', JSON.stringify({nodes: parsed.nodes, errors: parsed.errors}, null, 2))
}

parse('sample2.bib')

for (const mode of ['import', 'export']) {
  const root = `../better-bibtex/test/fixtures/${mode}`

  for (const f of fs.readdirSync(root).sort()) {
    // if (f === 'Async import, large library #720.bib') continue

    if (f.replace(/(la)?tex$/, '').endsWith('.bib')) {
      parse(`${root}/${f}`)
    }
  }
}
