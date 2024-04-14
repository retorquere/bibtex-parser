import moo from 'moo'
import XRegExp from 'xregexp'
import { ReplacementDetail } from 'xregexp'

// eslint-disable-next-line no-magic-numbers
// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

type CharCategory =  {
  name: string
  alias: string
  isBmpLast: boolean
  bmp: string
}

const charCategories: CharCategory[] = require('xregexp/tools/output/categories')

function re(cats: CharCategory[], extra?: string, neg=false): string {
  return `[${neg ? '^' : ''}${cats.map(cat => cat.bmp).join('')}${extra || ''}]`
}
const L: string = re(charCategories.filter(cat => cat.name === 'L'))
const LNM: string = re(charCategories.filter(cat => cat.name.match(/^[LNM]/)), '\u00AD\u2060')
const W = `${LNM}*?${L}${LNM}*`
const B = `(?=(?:${re(charCategories.filter(cat => cat.name.match(/^[LNM]/)), '\u00AD\u2060').replace(/^./, '[^')}|$))`

const Word = new RegExp(`${W}${B}`)
const P = new RegExp(re(charCategories.filter(cat => cat.name.match(/^P/))))

const Lu: string = re(charCategories.filter(cat => cat.name === 'Lu'), '\u2060')
const Acronym = new RegExp(`(?:(?:(?:${Lu}[.]){2,}${B})|(?:(?:vs?[.])(?=[ \t\n\r\u00A0])))`)

const Contraction = new RegExp(`${W}['’]${W}${B}`)
const Compound = new RegExp(`${W}(?:-${W})+${B}`)
const Whitespace = /[ \t\n\r\u00A0]+/
const Ordinal = new RegExp(`\\d+(?:st|nd|rd|th)${B}`)
const Email = new RegExp(`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)+${B}`)
const Handle = new RegExp(`@[A-Za-z0-9-]{2,}${B}`)
const Int = new RegExp(`[0-9]+${B}`)

const ComplexPreposition = /^([^ \t\n\r\u00A0]+)([ \t\n\r\u00A0]+)([^ \t\n\r\u00A0]+)(?:([ \t\n\r\u00A0]+)([^ \t\n\r\u00A0]+))?$/

function ci(s: string) {
  return s
    .replace(/[a-z]/ig, match => `[${match.toUpperCase()}${match.toLowerCase()}]`)
    .replace(' ', Whitespace.source )
}
const prepositions: string = require('./prepositions.json').sort().reverse().map(ci).join('|')
const Preposition = new RegExp(`(?:${prepositions})${B}`)

const lexer = moo.compile({
  'word-preposition':     Preposition,
  'word-acronym':         Acronym,
  'word-contraction':     Contraction,
  'word-compound':        Compound,
  'word-ordinal':         Ordinal,
  email:                  Email,
  handle:                 Handle,
  word:                   Word,
  number:                 Int, // eslint-disable-line id-blacklist
  'punctuation-end':      /[?.!](?=[ \t\n\r\u00A0]|$)/,
  'punctuation-colon':    /:(?=[ \t\n\r\u00A0])/,
  'punctuation-ellipsis': /[.][.][.]/,
  punctuation:            P,
  whitespace:             { match: /[ \t\n\r\u00A0]/, lineBreaks: true },
  other:                  { match: /[\s\S]/, lineBreaks: true },
})

const shape: ReplacementDetail[] = [
  [ XRegExp('\\p{Lu}'), 'X', 'all' ],
  [ new RegExp(re(charCategories.filter(cat => cat.name.match(/^L[^Cu]/))), 'g'), 'x' ],
  [ XRegExp('\\p{N}'), 'd', 'all' ],
  [ /’/g, "'" ],
  [ /–/g, '-' ],
  [ /[\u2060\u00AD]/g, '' ],
]

export type Token = {
  type: string
  subtype: string
  text: string
  start: number
  end: number
  shape: string
  sentenceStart: boolean
  subSentenceStart: boolean
}

export function tokenize(title: string, markup?: RegExp): Token[] {
  if (markup) title = title.replace(markup, match => '\u2060'.repeat(match.length))

  lexer.reset(title)
  const tokens: Token[] = []
  let sentenceStart = true
  let subSentenceStart = false
  for (const token of lexer) {
    const [ type, subtype ] = (token.type.includes('-') ? token.type : `${token.type}-`).split('-')

    tokens.push({
      type, subtype,
      text: token.text,
      start: token.offset,
      end: token.offset + token.text.length - 1,
      shape: XRegExp.replaceEach(<string>token.text, shape),
      sentenceStart: type === 'word' && sentenceStart,
      subSentenceStart: type === 'word' && subSentenceStart,
    })

    switch (token.type) {
      case 'punctuation-end':
        sentenceStart = true
        break
      case 'punctuation-colon':
        subSentenceStart = true
        break
      default:
        if (type.match(/word|number/)) {
          sentenceStart = false
          subSentenceStart = false
        }
        break
    }
  }

  const stack = tokens.splice(0)

  const combine = (ts: Token[]) => {
    for (const t of ts.slice(1)) {
      ts[0].text += t.text
      ts[0].end = t.end
      ts[0].shape += t.shape
    }
    return ts[0]
  }

  let cpt: RegExpMatchArray
  let cps: RegExpMatchArray
  while (stack.length) {
    if (stack[0].subtype === 'preposition' && (cpt = stack[0].text.match(ComplexPreposition)) && (cps = stack[0].shape.match(ComplexPreposition))) {
      const complex = stack.shift()

      let start = complex.start
      let end
      for (const i of Array.from({length: 5}, (_, n) => n+1)) {
        if (!cpt[i]) break

        end = start + cps[i].length - 1
        tokens.push({
          ...complex,
          text: cpt[i],
          shape: cps[i],
          start,
          end,
          type: i % 2 ? complex.type : 'whitespace',
          subtype: i % 2 ? complex.type : '',
        })
        start = end + 1
      }
      continue
    }

    // domain names
    // eslint-disable-next-line no-magic-numbers
    if (stack.slice(0, 3).map(t => t.type).join('.') === 'word.punctuation.word' && stack[1].text === '.') {
      // eslint-disable-next-line no-magic-numbers
      tokens.push(combine(stack.splice(0, 3)))
      continue
    }

    tokens.push(stack.shift())
  }

  return tokens
}
