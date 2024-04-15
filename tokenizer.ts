import moo from 'moo'

// eslint-disable-next-line no-magic-numbers
// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

import * as rx from './re'

const L: string = rx.match(rx.categories.filter(cat => cat.name === 'L'))
const LNM: string = rx.match(rx.categories.filter(cat => cat.name.match(/^[LNM]/)), '\u00AD\u2060')
const W = `${LNM}*?${L}${LNM}*`
const B = `(?=(?:${rx.match(rx.categories.filter(cat => cat.name.match(/^[LNM]/)), '\u00AD\u2060').replace(/^./, '[^')}|$))`

const Word = new RegExp(`${W}${B}`)
const P = new RegExp(rx.match(rx.categories.filter(cat => cat.name.match(/^P/))))

const Lu: string = rx.match(rx.categories.filter(cat => cat.name === 'Lu'), '\u2060')
const Acronym = new RegExp(`(?:(?:(?:${Lu}[.]){2,}${B})|(?:(?:vs?[.])(?=[ \t\n\r\u00A0])))`)

const Contraction = new RegExp(`${W}['’]${W}${B}`)
const Whitespace = /[ \t\n\r\u00A0]+/
const Ordinal = new RegExp(`\\d+(?:st|nd|rd|th)${B}`)
const Email = new RegExp(`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)+${B}`)
const Handle = new RegExp(`@[A-Za-z0-9-]{2,}${B}`)
const Int = new RegExp(`[0-9]+${B}`)
const Domain = new RegExp(`${W}(?:[.]${W})+${B}`)
const Website = new RegExp(`https?://${W}(?:[.]${W})+(?:[^.!? \t\n\r\u00A0]+|[.!?]${LNM})+`)

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
  'word-ordinal':         Ordinal,
  email:                  Email,
  handle:                 Handle,
  website:                Website,
  domain:                 Domain,
  word:                   Word,
  number:                 Int, // eslint-disable-line id-blacklist
  'punctuation-end':      /[?.!](?=[ \t\n\r\u00A0]|$)/,
  'punctuation-colon':    /:(?=[ \t\n\r\u00A0])/,
  'punctuation-ellipsis': /[.][.][.]/,
  punctuation:            P,
  whitespace:             { match: /[ \t\n\r\u00A0]/, lineBreaks: true },
  other:                  { match: /[\s\S]/, lineBreaks: true },
})

const shaper: [RegExp, string][] = [
  [ new RegExp(rx.match(rx.categories.filter(cat => cat.name === 'Lu')), 'g'), 'X' ],
  [ new RegExp(rx.match(rx.categories.filter(cat => cat.name.match(/^L[^Cu]/))), 'g'), 'x' ],
  [ new RegExp(rx.match(rx.categories.filter(cat => cat.name[0] === 'N')), 'g'), 'd' ],
  [ /’/g, "'" ],
  [ /–/g, '-' ],
  [ /[\u2060\u00AD]/g, '' ],
]
function shape(s: string) {
  for (const [ re, repl ] of shaper) {
    s = s.replace(re, repl)
  }
  return s
}

export type Token = {
  type: string
  subtype: string
  text: string
  start: number
  end: number
  shape: string
  sentenceStart: boolean
  subSentenceStart: boolean
  hyphenated?: Token[]
}

function combine(tokens: Token[]) {
  const combined = { ...tokens[0] }
  for (const t of tokens.slice(1)) {
    combined.text += t.text
    combined.end = t.end
    combined.shape += t.shape
  }
  return combined
}

function hyphenate(t: Token) {
  if (t.type === 'word') return 'w'
  if (t.text === '-') return '-'
  return ' '
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
      shape: shape(<string>token.text),
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
        if (type.match(/word|number|handle|domain|website/)) {
          sentenceStart = false
          subSentenceStart = false
        }
        break
    }
  }

  const stack = tokens.splice(0)

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

    // hyphenated words
    const pat = stack.map(t => hyphenate(t)).join('')
    if (cpt = pat.match(/^w(-w)+(?= |$)/)) {
      const hyphenated = stack.splice(0, cpt[0].length)
      tokens.push({ ...combine(hyphenated), hyphenated })
      continue
    }

    tokens.push(stack.shift())
  }

  return markup ? tokens.map(token => ({ ...token, text: title.substring(token.start, token.end + 1) })) : tokens
}
