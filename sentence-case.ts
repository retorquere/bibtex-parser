/* eslint-disable @typescript-eslint/unbound-method */

import XRegExp from 'xregexp'
import { tokenize, Token } from './tokenizer'

// eslint-disable-next-line no-magic-numbers
// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

function titleCase(s: string): string {
  return s.replace(/^(.)(.+)/, (match, car, cdr) => `${car}${cdr.toLowerCase()}`)
}

const connectedWord = XRegExp('(^|-)\\p{Lu}\\p{Ll}*(?=-|$)', 'g')
const connectedInnerWord = XRegExp('-\\p{Lu}\\p{Ll}*(?=-|$)', 'g')

function wordSC(token: Token, allCaps: boolean, subSentence: boolean): string {
  if (token.type !== 'word') return token.text
  if (token.text.match(/^I'/)) return titleCase(token.text)
  if (subSentence && token.subSentenceStart && token.text.match(/^a$/i)) return 'a'

  if ((subSentence && token.subSentenceStart) || token.sentenceStart) {
    return allCaps ? titleCase(token.text) : XRegExp.replace(token.text, connectedInnerWord, match => match.toLowerCase())
  }

  if (!allCaps && token.shape.match(/^[Xxd]+(-[Xxd]+)+/)) return XRegExp.replace(token.text, connectedWord, match => match.toLowerCase())

  if (token.text.match(/^[B-Z]$/)) return token.text

  if (!allCaps && token.shape.match(/^[-X]+$/)) return token.text

  if (token.subtype === 'preposition') return token.text.toLowerCase()

  const shape = token.shape.replace(/[^Xxd]/g, '')
  if (!allCaps && shape.match(/^[Xd-]+$/)) return token.text
  if (shape.match(/^X[xd]*(-[Xxd]*)*$/)) return token.text.toLowerCase()
  if (shape.match(/^[Xd]+$/)) return allCaps ? token.text.toLowerCase() : token.text

  if (token.text.includes('.')) return token.text
  if (shape.match(/x.*X/)) return token.text

  return token.text.toLowerCase()
}

export type Options = {
  preserveQuoted?: boolean
  subSentenceCapitalization?: boolean
  markup?: RegExp
  nocase?: RegExp
  guess?: boolean
}

export function toSentenceCase(title: string, options: Options = {}): string {
  options = {
    preserveQuoted: true,
    subSentenceCapitalization: true,
    ...options,
  }

  if (options.guess && title !== title.toUpperCase() && title !== title.toLowerCase()) {
    let $title = title
    if (options.nocase) $title = $title.replace(options.nocase, match => match.match(/\s/) ? ' ' : '')
    if (options.markup) $title = $title.replace(options.markup, '')
    if (options.preserveQuoted) {
      for (const q of [/“.*?”/g, /‘.*?’/g, /".*?"/g]) {
        $title = $title.replace(q, '')
      }
    }

    const words = tokenize($title).filter(token => token.type === 'word' && !token.subtype.match(/preposition|acronym/))
    const scWords = words.filter(token => !token.shape.includes('X'))
    // console.log(words.map(word => word.text))
    if (scWords.length > 1) return title // eslint-disable-line no-magic-numbers
  }

  title = title.normalize('NFC') // https://github.com/winkjs/wink-nlp/issues/134
  const allCaps = title === title.toUpperCase()
  if (allCaps && !title.match(/\s/)) return title

  let sentenceCased = title

  const tokens = tokenize(title, options.markup)

  for (const token of tokens) {
    if (token.type !== 'whitespace') {
      sentenceCased = sentenceCased.substring(0, token.start) + wordSC(token, allCaps, options.subSentenceCapitalization) + sentenceCased.substring(token.end + 1)
    }
  }

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
