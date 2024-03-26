/* eslint-disable @typescript-eslint/unbound-method */

import XRegExp from 'xregexp'
import nlp from 'compromise/one'
import { combining } from 'unicode2latex'

type Token = {
  start: number
  end: number
  text: string
  type: string
  contraction?: boolean
  shape: string
  sentenceStart?: boolean
  subSentenceStart?: boolean
}

function gather(tokens: Token[], type?: string): Token {
  return {
    start: tokens[0].start,
    end: tokens[tokens.length - 1].end,
    text: tokens.map(c => c.text).join(''),
    type: type || tokens[0].type,
    contraction: !!tokens.find(t => t.contraction) || false,
    shape: tokens.map(c => c.shape).join(''),
    sentenceStart: !!tokens.find(t => t.sentenceStart) || false,
    subSentenceStart: !!tokens.find(t => t.subSentenceStart) || false,
  }
}

const preposition = {
  simple: /^(a|about|above|across|after|against|along|among|an|and|around|as|at|before|behind|below|beneath|beside|between|but|by|down|during|for|from|in|inside|into|like|near|nor|of|off|on|onto|or|out|over|so|the|through|to|towards|under|underneath|until|up|upon|with|within|without|yet)$/i,
  complex: /^((according to)|(ahead of)|(apart from)|(as for)|(as of)|(as per)|(as regards)|(aside from)|(back to)|(because of)|(close to)|(due to)|(except for)|(far from)|(inside of)|(instead of)|(next to)|(outside of)|(owing to)|(prior to)|(pursuant to)|(regardless of)|(right of)|(subsequent to))$/i,
}

function titleCase(s: string): string {
  return s.replace(/^(.)(.+)/, (match, car, cdr) => `${car}${cdr.toLowerCase()}`)
}

function wordSC(token: Token, succ: Token, allCaps: boolean, subSentence: boolean): string {
  if (token.type !== 'word') return token.text
  if (subSentence && token.subSentenceStart && token.text.match(/^a$/i)) return 'a'
  if ((subSentence && token.subSentenceStart) || token.sentenceStart) return allCaps ? titleCase(token.text) : token.text

  if (token.text.match(/^[B-Z]$/)) return token.text

  if (token.text.match(/^I'/)) return titleCase(token.text)

  if (succ && `${token.text} ${succ.text}`.match(preposition.complex)) {
    succ.text = succ.text.toLowerCase()
    return token.text.toLowerCase()
  }
  if (token.text.match(preposition.simple)) return token.text.toLowerCase()

  if (token.shape.match(/^X[xd]*(-X[xd]*)*$/)) return token.text.toLowerCase()

  if (token.text.includes('.')) return token.text
  if (token.shape.match(/x.*X/)) return token.text

  if (token.shape.match(/^[Xd]+$/)) return allCaps ? token.text.toLowerCase() : token.text

  return token.text.toLowerCase()
}

const markup = /<\/?(?:i|b|sup|sub|ncx?)>/g

function tokentype(token: Token): string {
  if (token.contraction) return 'c'
  if (token.type === 'word') return 'w'
  if (token.type === 'unk' && token.text.match(/^\u2060+$/)) return 'm'
  if (token.shape === '-') return '-'
  return ' '
}

const reshapeRE = new RegExp(`([a-z])(${combining.regex})`, 'ig')
function reshape(shape: string) {
  return shape.normalize('NFD').replace(reshapeRE, (match, char) => char.match(/^[a-z]$/i) ? 'x' : match)
}

const Lu = XRegExp('\\p{Lu}')
const Ll = XRegExp('\\p{Ll}')
function tokenize(title: string): Token[] {
for (const term of doc.json({offset:true})[1].terms) {
  let shape = term.text
  shape = XRegExp.replaceEach(term.text, [
    [Lu, 'X', 'all'],
    [Ll, 'x', 'all'],
    [/\d/g, 'd'],
  ])
  console.log({...term, shape: shape })
}

  const doc = nlp.readDoc(title.replace(markup, match => '\u2060'.repeat(match.length)))

  const tokens: Token[] = []
  for (const sentence of doc.json({offset:true})) {
    const words: Token[] = []
    let sentenceStart = true
    let subSentenceStart = false
    for (const term of sentence.terms) {
      if (
      const spaces = token.out(nlp.its.precedingSpaces)
      if (spaces) {
        words.push({ start: pos, end: pos + spaces.length - 1, text: spaces, type: 'whitespace', contraction: false, shape: spaces })
        pos += spaces.length
      }
      const text = token.out()

      const word ={
        start: pos,
        end: pos + text.length - 1,
        text,
        type: token.out(nlp.its.type),
        contraction: token.out(nlp.its.contractionFlag) as unknown as boolean,
        // https://github.com/winkjs/wink-nlp/issues/134
        shape: reshape(token.out(nlp.its.shape)),
        sentenceStart,
        subSentenceStart,
      }
      words.push(word)
      sentenceStart = false
      subSentenceStart = word.type === 'punctuation' && word.shape === ':'
      pos += text.length
    })
    subSentenceStart = true
    console.log(words)

    while (words.length) {
      const type = words.map(tokentype).join('')
      let m: RegExpMatchArray

      if (m = type.match(/^(m?cm?)+/)) {
        tokens.push(gather(words.splice(0, m[0].length)))
        continue
      }

      if (m = type.match(/^m?[wc]m?(-m?[wc]m?)+/)) {
        tokens.push(gather(words.splice(0, m[0].length)))
        continue
      }

      tokens.push(words.shift())
    }
  })

  return tokens
}

export type Options = {
  preserveQuoted?: boolean
  subSentenceCapitalization?: boolean
}

export function toSentenceCase(title: string, options: Options = {}): string {
  options = {
    preserveQuoted: true,
    subSentenceCapitalization: true,
    ...options,
  }

  title = title.normalize('NFC') // https://github.com/winkjs/wink-nlp/issues/134
  let sentenceCased = title
  const tokens = tokenize(title)

  const allCaps = title === title.toUpperCase()

  tokens.forEach((token, i) => {
    sentenceCased = sentenceCased.substring(0, token.start) + wordSC(token, tokens[i+1], allCaps, options.subSentenceCapitalization) + sentenceCased.substring(token.end + 1)
  })

  for (const match of title.matchAll(markup)) {
    sentenceCased = sentenceCased.substring(0, match.index) + match[0] + sentenceCased.substring(match.index + match[0].length)
  }

  sentenceCased = sentenceCased.replace(/<(ncx?>).*?<\/\1/g, (match: string, tag: string, offset: number) => title.substring(offset, offset + match.length))

  if (options.preserveQuoted) {
    for (const q of [/(“.*?)”/g, /(‘.*?)’/g, /(".*?)"/g]) {
      sentenceCased = sentenceCased.replace(q, (match: string, offset: number) => title.substring(offset, offset + match.length))
    }
  }

  return sentenceCased
}

export function isAllCaps(title: string): boolean {
  return title === title.toUpperCase()
}

export function guessSentenceCased(title: string): boolean {
  if (title === title.toUpperCase()) return false
  if (title === title.toLowerCase()) return false

  const words = tokenize(title).filter(token => token.type === 'word')
  if (!words.length) return true

  const titleCased = words.filter(word => word.shape.match(/^X.*x/))
  return (titleCased.length / words.length) < 0.5 // eslint-disable-line no-magic-numbers
}
