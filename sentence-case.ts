/* eslint-disable @typescript-eslint/unbound-method */

import XRegExp from 'xregexp'
import nlp from 'compromise/one'
import { combining } from 'unicode2latex'


// eslint-disable-next-line no-magic-numbers
// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

type WordToken = {
  type: 'word'
  text: string
  shape: string
  start: number
  end: number
  sentenceStart?: boolean
  subSentenceStart?: boolean
}
type PunctuationToken = {
  type: 'punctuation'
  text: string
  shape: string
  start: number
  end: number
}
type WhitespaceToken = {
  type: 'whitespace'
  text: string
  shape: string
}
type Token = WordToken | PunctuationToken | WhitespaceToken

function gather(tokens: (WordToken | PunctuationToken)[]): WordToken {
  return {
    start: tokens[0].start,
    end: tokens[tokens.length - 1].end,
    text: tokens.map(c => c.text).join(''),
    type: 'word',
    shape: tokens.map(c => c.shape).join(''),
    sentenceStart: !!tokens.find(t => t.type === 'word' && t.sentenceStart) || false,
    subSentenceStart: !!tokens.find(t => t.type === 'word' && t.subSentenceStart) || false,
  }
}

const preposition = {
  simple: /^(a|about|above|across|after|against|along|among|an|and|around|as|at|before|behind|below|beneath|beside|between|but|by|down|during|for|from|in|inside|into|like|near|nor|of|off|on|onto|or|out|over|so|the|through|to|towards|under|underneath|until|up|upon|with|within|without|yet)$/i,
  complex: /^((according to)|(ahead of)|(apart from)|(as for)|(as of)|(as per)|(as regards)|(aside from)|(back to)|(because of)|(close to)|(due to)|(except for)|(far from)|(inside of)|(instead of)|(next to)|(outside of)|(owing to)|(prior to)|(pursuant to)|(regardless of)|(right of)|(subsequent to))$/i,
}

function titleCase(s: string): string {
  return s.replace(/^(.)(.+)/, (match, car, cdr) => `${car}${cdr.toLowerCase()}`)
}

const Lu = XRegExp('\\p{Lu}')
const Ll = XRegExp('\\p{Ll}')
const connectedWord = XRegExp('(^|-)\\p{Lu}\\p{Ll}*(?=-|$)', 'g')
const connectedInnerWord = XRegExp('-\\p{Lu}\\p{Ll}*(?=-|$)', 'g')
const strayCC = new RegExp(`^(${combining.regex})`)

function wordSC(token: Token, succ: Token, allCaps: boolean, subSentence: boolean): string {
  if (token.type !== 'word') return token.text
  if (token.text.match(/^I'/)) return titleCase(token.text)
  if (subSentence && token.subSentenceStart && token.text.match(/^a$/i)) return 'a'

  if ((subSentence && token.subSentenceStart) || token.sentenceStart) {
    return allCaps ? titleCase(token.text) : XRegExp.replace(token.text, connectedInnerWord, match => match.toLowerCase())
  }

  if (!allCaps && token.shape.match(/^[Xxd]+(-[Xxd]+)+/)) return XRegExp.replace(token.text, connectedWord, match => match.toLowerCase())

  if (token.text.match(/^[B-Z]$/)) return token.text

  if (!allCaps && token.shape.match(/^[-X]+$/)) return token.text

  if (succ && `${token.text} ${succ.text}`.match(preposition.complex)) {
    succ.text = succ.text.toLowerCase()
    return token.text.toLowerCase()
  }
  if (token.text.match(preposition.simple)) return token.text.toLowerCase()

  const shape = token.shape.replace(/[^Xxd]/g, '')
  if (!allCaps && shape.match(/^[Xd-]+$/)) return token.text
  if (shape.match(/^X[xd]*(-[Xxd]*)*$/)) return token.text.toLowerCase()
  if (shape.match(/^[Xd]+$/)) return allCaps ? token.text.toLowerCase() : token.text

  if (token.text.includes('.')) return token.text
  if (shape.match(/x.*X/)) return token.text

  return token.text.toLowerCase()
}

function tokentype(token: Token): string {
  if (token.type === 'word' && token.text.match(/^\u2060+$/)) return 'm'
  if (token.type === 'word') return 'w'
  if (token.shape === '-') return '-'
  return ' '
}

function prepost(s: string, offset: number): Token[] {
  const tokens: Token[] = []
  for (const text of s.match(/(\s+|\S+)/g)) {
    if (text.match(/\s/)) {
      tokens.push({ type: 'whitespace', text, shape: text })
    }
    else if (text) {
      tokens.push({ type: 'punctuation', text, shape: text, start: offset, end: offset + text.length - 1 })
    }
    offset += text.length
  }
  return tokens
}

export function tokenize(title: string, markup?: RegExp): Token[] {

  if (markup) title = title.replace(markup, match => '\u2060'.repeat(match.length))
  const doc = nlp(title)

  const tokens: Token[] = []
  for (const sentence of doc.json({offset:true})) {
    const words: Token[] = []
    let sentenceStart = true
    let subSentenceStart = false
    for (const term of sentence.terms) {
      const m = term.post.match(strayCC)
      if (m) {
        term.text += m[0]
        term.post = term.post.substring(m[0].length)
        term.offset.length += m[0].length
      }

      if (term.pre) words.push(...prepost(<string>term.pre, term.offset.start - term.pre.length))

      words.push({
        start: term.offset.start,
        end: term.offset.start + term.offset.length - 1,
        text: term.text,
        type: 'word',
        shape: XRegExp.replaceEach(<string>term.text, [ [Lu, 'X', 'all'], [Ll, 'x', 'all'], [/\d/g, 'd'] ]),
        sentenceStart,
        subSentenceStart,
      })
      sentenceStart = false
      subSentenceStart = term.post.includes(':')

      if (term.post) words.push(...prepost(<string>term.post, <number>term.offset.start + <number>term.offset.length))
    }
    subSentenceStart = true

    while (words.length) {
      if (words[0].type === 'word' && words[0].text.includes('/')) {
        const multiple = <WordToken>words.shift()
        let start = multiple.start
        words.unshift(
          ...(multiple.text.match(/([/]|[^/]+)/g).map((w: string) => {
            const started = start
            start += w.length

            const ss = w === '/' ? [false, false] : [multiple.sentenceStart, multiple.subSentenceStart ]
            if (w !== '/') multiple.sentenceStart = multiple.subSentenceStart = false

            return {
              start: started,
              end: start - 1,
              text: w,
              type: w === '/' ? 'punctuation' : 'word',
              shape: XRegExp.replaceEach(w, [ [Lu, 'X', 'all'], [Ll, 'x', 'all'], [/\d/g, 'd'] ]),
              sentenceStart: ss[0],
              subSentenceStart: ss[1],
            }
          }) as Token[])
        )
        continue
      }

      const type = words.map(tokentype).join('')
      let m: RegExpMatchArray

      if (m = type.match(/^m?[wc]m?(-m?[wc]m?)+/)) {
        tokens.push(gather(<WordToken[]>words.splice(0, m[0].length)))
        continue
      }

      const word = words.shift()
      if (word.type !== 'whitespace') tokens.push(word)
    }
  }

  return tokens
}

export type Options = {
  preserveQuoted?: boolean
  subSentenceCapitalization?: boolean
  markup?: RegExp
  nocase?: RegExp
}

export function toSentenceCase(title: string, options: Options = {}): string {
  options = {
    preserveQuoted: true,
    subSentenceCapitalization: true,
    ...options,
  }

  title = title.normalize('NFC') // https://github.com/winkjs/wink-nlp/issues/134
  const allCaps = title === title.toUpperCase()
  if (allCaps && !title.match(/\s/)) return title

  let sentenceCased = title

  const tokens = tokenize(title, options.markup)

  tokens.forEach((token, i) => {
    if (token.type !== 'whitespace') {
      sentenceCased = sentenceCased.substring(0, token.start) + wordSC(token, tokens[i+1], allCaps, options.subSentenceCapitalization) + sentenceCased.substring(token.end + 1)
    }
  })

  if (options.markup) {
    for (const match of title.matchAll(options.markup)) {
      sentenceCased = sentenceCased.substring(0, match.index) + match[0] + sentenceCased.substring(match.index + match[0].length)
    }
  }

  if (options.nocase) {
    sentenceCased = sentenceCased
      .replace(options.nocase, (match: string, tag: string, offset: number) => title.substring(offset, offset + match.length))
  }

  if (options.preserveQuoted) {
    for (const q of [/“.*?”/g, /‘.*?’/g, /".*?"/g]) {
      sentenceCased = sentenceCased.replace(q, (match: string, offset: number) => title.substring(offset, offset + match.length))
    }
  }

  return sentenceCased
}

export function guessSentenceCased(title: string, markup = /<\/?(?:i|b|sup|sub|ncx?)>/g): boolean {
  const noMarkup = title.replace(markup, '')
  if (noMarkup === noMarkup.toUpperCase()) return false
  if (noMarkup === noMarkup.toLowerCase()) return false

  const words = tokenize(title, markup).filter(token => token.type === 'word' && token.shape.match(/x/i))
  if (!words.length) return true

  const titleCased = words.filter(word => word.shape.match(/^X+$|^X.*x|[^Xx]+-X/))
  return (titleCased.length / words.length) < 0.5 // eslint-disable-line no-magic-numbers
}
