/* eslint-disable @typescript-eslint/unbound-method */

import { tokenize, Token, connectedInnerWord } from './tokenizer'
import { merge } from './merge'

// eslint-disable-next-line no-magic-numbers
// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

function titleCase(s: string): string {
  return s.replace(/^(.)(.+)/, (match, car, cdr) => `${car}${cdr.toLowerCase()}`)
}

function wordSC(token: Token, allCaps: boolean, subSentence: boolean, hyphenated: boolean): string {
  if (token.type === 'domain') return token.text.toLowerCase()
  if (token.type !== 'word') return token.text
  if (token.text.match(/^I'/)) return titleCase(token.text)
  if (subSentence && token.subSentenceStart && token.text.match(/^a$/i)) return 'a'

  if ((subSentence && token.subSentenceStart) || token.sentenceStart) {
    return allCaps ? titleCase(token.text) : token.text.replace(connectedInnerWord, match => match.toLowerCase())
  }

  if (token.subtype === 'preposition') return token.text.toLowerCase()
  if (token.subtype === 'acronym') return token.text

  // if (!allCaps && token.shape.match(/^[Xxd]+(-[Xxd]+)+/)) return XRegExp.replace(token.text, connectedWord, match => match.toLowerCase())

  if (token.text.match(/^[B-Z]$/)) return hyphenated ? token.text.toLowerCase() : token.text

  if (!allCaps && token.shape.match(/^[-X]+$/)) return token.text

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
  options = merge(options, {
    preserveQuoted: true,
    subSentenceCapitalization: true,
    guess: false,
  })

  const allCaps = title === title.toUpperCase()
  const allLower = title === title.toLowerCase()
  if (options.guess && !allCaps && !allLower) {
    let $title = title
    if (options.nocase) $title = $title.replace(options.nocase, match => match.match(/\s/) ? ' ' : '')
    if (options.markup) $title = $title.replace(options.markup, '')
    if (options.preserveQuoted) {
      for (const q of [/“.*?”/g, /‘.*?’/g, /".*?"/g]) {
        $title = $title.replace(q, '')
      }
    }

    const guess = {
      words: tokenize($title),
      sc: 0,
      other: 0,
    }

    guess.words.forEach((token, i) => {
      if (token.type === 'word' && token.text.length > 1 && !token.subtype.match(/preposition|acronym|ordinal/) && (i === 0 || guess.words[i-1].type === 'whitespace')) {
        guess[token.shape.match(/^[^X]*x[^X]*$/) ? 'sc' : 'other'] += 1
      }
    })
    if (guess.sc && guess.sc >= guess.other) return title
  }

  title = title.normalize('NFC') // https://github.com/winkjs/wink-nlp/issues/134
  if (allCaps && !title.match(/\s/)) return title

  const tokens = tokenize(title, options.markup)

  let sentenceCased = ''
  for (const token of tokens) {
    if (token.hyphenated && token.shape[0] === 'x') {
      sentenceCased += token.text
    }
    else if (token.hyphenated) {
      for (const t of token.hyphenated) {
        sentenceCased += wordSC(t, allCaps, options.subSentenceCapitalization, true)
      }
    }
    else {
      sentenceCased += wordSC(token, allCaps, options.subSentenceCapitalization, false)
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
