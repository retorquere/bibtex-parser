import moo from 'moo'
import XRegExp from 'xregexp'
import { ReplacementDetail } from 'xregexp'

// eslint-disable-next-line no-magic-numbers
const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

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
const LNM: string = re(charCategories.filter(cat => cat.name.match(/^[LNM]/)), '\u2060')
const Word = new RegExp(`${LNM}+`)
const P = new RegExp(re(charCategories.filter(cat => cat.name.match(/^P/))))

const Lu: string = re(charCategories.filter(cat => cat.name === 'Lu'), '\u2060')
const Acronym = new RegExp(`(?:(?:${Lu}[.]){2,}|v[.])(?=${LNM.replace(/^./, '[^')}|$)`)
const Contraction = new RegExp(`${LNM}+'${LNM}+`)
const Compound = new RegExp(`${LNM}+(?:-${LNM}+)+`)
const Whitespace = /[ \t\n\r\u00A0]+/

const prepositions: string = `
  a
  about
  above
  across
  after
  against
  along
  among
  an
  and
  around
  as
  at
  before
  behind
  below
  beneath
  beside
  between
  but
  by
  down
  during
  for
  from
  in
  inside
  into
  like
  near
  nor
  of
  off
  on
  onto
  or
  out
  over
  so
  the
  through
  to
  towards
  under
  underneath
  until
  up
  upon
  with
  within
  without
  yet
  according to
  ahead of
  apart from
  as for
  as of
  as per
  as regards
  aside from
  back to
  because of
  close to
  due to
  except for
  far from
  inside of
  instead of
  next to
  outside of
  owing to
  prior to
  pursuant to
  regardless of
  right of
  subsequent to
`.trim()
  .split(/[\r\n]+/)
  .map(token => token.trim().replace(/[a-z]/ig, match => `[${match.toUpperCase()}${match.toLowerCase()}]`).replace(' ', Whitespace.source ))
  .join('|')
const Preposition = new RegExp(`(?:${prepositions})(?=${LNM.replace(/^./, '[^')}|$)`)

const lexer = moo.compile({
  'word-preposition':   Preposition,
  'word-acronym':       Acronym,
  'word-contraction':   Contraction,
  'word-compound':      Compound,
  word:                 Word,
  'punctuation-end':    /[?.!]/,
  'punctuation-colon':  /:/,
  punctuation:          P,
  whitespace:           { match: /[ \t\n\r\u00A0]/, lineBreaks: true },
  other:                { match: /[\s\S]/, lineBreaks: true },
})

const shape: ReplacementDetail[] = [
  [ XRegExp('\\p{Lu}'), 'X', 'all' ],
  [ new RegExp(re(charCategories.filter(cat => cat.name.match(/^L[^Cu]/))), 'g'), 'x' ],
  [ XRegExp('\\p{N}'), 'd', 'all' ],
  [ /\u2060/g, '' ],
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
  console.log(show(title))

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

    switch (type) {
      case 'word':
        sentenceStart = false
        subSentenceStart = false
        break
      case 'punctuation':
        switch (subtype) {
          case 'end':
            sentenceStart = true
            break
          case 'colon':
            subSentenceStart = true
            break
        }
        break
    }
  }

  /*
  const combine = (ts: Token[]) => {
    for (const t of ts.slice(1)) {
      ts[0].text += t.text
      ts[0].end = t.end
      ts[0].shape += t.shape
    }
    return ts[0]
  }

  const compact: Token[] = []
  while (tokens.length) {
    // eslint-disable-next-line no-magic-numbers
    if (tokens.slice(0, 3).map(t => t.type).join('.') === 'word.punctuation.word' && tokens[1].text === '.') {
      // eslint-disable-next-line no-magic-numbers
      compact.push(combine(tokens.splice(0, 3)))
      continue
    }

    compact.push(tokens.shift())
  }
  */

  return tokens
}
