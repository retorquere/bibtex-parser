/* eslint-disable @typescript-eslint/no-unsafe-argument */
import XRegExp from 'xregexp'
import categories = require('xregexp/tools/output/categories')

const LN = new RegExp(`[${categories.filter(cat => ['L', 'N', 'No'].includes(cat.name)).map(cat => cat.bmp as string).join('')}]+`, 'g')

export type TextRange = { start: number, end: number, description?: string }

export function restore(text: string, orig: string, preserve: TextRange[]): string {
  for (const { start, end } of preserve) {
    text = text.substring(0, start) + orig.substring(start, end) + text.substring(end)
  }
  return text
}

const re = {
  acronym: XRegExp('(\\p{Lu}[.])+$'),
  innerCaps: XRegExp('.\\p{Lu}'),
  ident: XRegExp('^\\p{L}\\p{L}*[\\p{N}\\p{No}][\\p{L}\\p{N}\\p{No}]*$'),
  allCaps: XRegExp('^\\[p{Lu}\\p{N}\\p{No}]+$'),
  // private aint = XRegExp("^\\p{L}n't(?=$|[\\P{L}])") // isn't
  // private word = XRegExp('^\\p{L}+([-.]\\p{L}+)*') // also match gallium-nitride as one word
  // private and = XRegExp('^\\p{Lu}&\\p{Lu}(?=$|[\\P{L}])') // Q&A
}

function lowercase(word: string): string {
  if (word.length === 1) {
    return word === 'A' ? word.toLowerCase() : word
  }

  if (XRegExp.exec(word, re.innerCaps)) {
    return word
  }

  if (XRegExp.exec(word, re.ident) || XRegExp.exec(word, re.allCaps)) {
    return word
  }

  return word.toLowerCase()
}

export function toSentenceCase(text: string): string {
  const preserve: TextRange[] = []

  text.replace(/“.*?”/g, (match: string, i: number) => {
    preserve.push({ start: i, end: i + match.length, description: 'quoted'})
    return ''
  })
  text.replace(/‘.*?’/g, (match: string, i: number) => {
    preserve.push({ start: i, end: i + match.length, description: 'quoted'})
    return ''
  })
  text.replace(/(["]).*?\1/g, (match: string, _quote: string, i: number) => {
    preserve.push({ start: i, end: i + match.length, description: 'quoted'})
    return ''
  })

  text.replace(/([.?!][\s]+)[A-Z]/g, (match: string, period: string, i: number) => {
    if (!XRegExp.exec(text.substring(0, i + 1), re.acronym)) {
      preserve.push({ start: i + period.length, end: i + match.length, description: 'sub-sentence' })
    }
    return ''
  })

  text.replace(/^[A-Z]/g, (match: string, i: number) => {
    preserve.push({ start: i, end: i + match.length, description: 'sentence-start' })
    return ''
  })

  text.replace(/<span class="nocase">.*?<\/span>|<nc>.*?<\/nc>/gi, (match: string, i: number) => {
    preserve.push({ start: i, end: i + match.length, description: 'nocase' })
    return ''
  })


  let masked = text.replace(/[^<>]<[^>]+>/g, (match: string, i: number) => {
    preserve.push({ start: i + 1, end: i + match.length, description: 'markup' })
    // replace markup by the preceding char
    return match[0].repeat(match.length)
  })

  masked = masked.replace(/<[^>]+>[^<>]/g, (match: string, i: number) => {
    preserve.push({ start: i, end: i + match.length - 1, description: 'markup' })
    // replace markup by the following char
    return match[match.length - 1].repeat(match.length)
  })

  masked = masked
    .replace(/[;:]\s+A\s/g, match => match.toLowerCase())
    .replace(/[–—]\s*A\s/g, match => match.toLowerCase())
    .replace(LN, word => lowercase(word))
  return restore(masked, text, preserve)
}
