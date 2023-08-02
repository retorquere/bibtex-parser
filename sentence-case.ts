/* eslint-disable @typescript-eslint/no-unsafe-argument */
import XRegExp from 'xregexp'

export type TextRange = { start: number, end: number, description?: string }

export function restore(text: string, orig: string, preserve: TextRange[]): string {
  for (const { start, end } of preserve) {
    text = text.substring(0, start) + orig.substring(start, end) + text.substring(end)
  }
  return text
}

class SentenceCaser {
  private input: string
  private result: string
  private sentenceStart: boolean
  private acronym = XRegExp('^(\\p{Lu}[.])+(?=$|[\\P{L}])')
  private quoted = XRegExp('^"[^"]+"(?=$|[\\P{L}])')
  private innerCaps = XRegExp('\\p{Ll}\\p{Lu}')
  private allCaps = XRegExp('^\\p{Lu}+$')
  private aint = XRegExp("^\\p{L}n't(?=$|[\\P{L}])") // isn't
  private word = XRegExp('^\\p{L}+(-\\p{L}+)*') // also match gallium-nitride as one word
  private and = XRegExp('^\\p{Lu}&\\p{Lu}(?=$|[\\P{L}])') // Q&A

  public convert(text: string, ignoreHTML=false): string {
    this.input = text
    this.result = ''
    this.sentenceStart = true
    const preserve: TextRange[] = []

    if (ignoreHTML) {
      let replace = true
      while (replace) {
        replace = false
        // always keep the leading char, but skip markup
        this.input = this.input.replace(/[^<>]<[^>]+>/, (match: string, i: number) => {
          preserve.push({ start: i + 1, end: i + match.length })
          replace = true
          return match[0].repeat(match.length)
        })
      }
      replace = true
      while (replace) {
        replace = false
        // always keep the leading char, but skip markup
        this.input = this.input.replace(/<[^>]+>[^<>]/, (match: string, i: number) => {
          preserve.push({ start: i, end: i + match.length - 1})
          replace = true
          return match[match.length - 1].repeat(match.length)
        })
      }
    }

    this.input = this.input.replace(/[;:]\s+A\s/g, match => match.toLowerCase())
    this.input = this.input.replace(/[–—]\s*A\s/g, match => match.toLowerCase())
    let m
    while (this.input) {
      if (m = XRegExp.exec(this.input, this.quoted)) { // "Hello There"
        this.add(m[0], undefined, true)
      }
      else if (m = XRegExp.exec(this.input, this.acronym)) { // U.S.
        this.add(m[0], undefined, true)
      }
      else if (m = XRegExp.exec(this.input, this.aint)) { // isn't
        this.add(m[0], undefined, false)
      }
      else if (m = XRegExp.exec(this.input, this.word)) {
        this.add(m[0], '-', false)
      }
      else if (m = XRegExp.exec(this.input, this.and)) {
        this.add(m[0], undefined, true)
      }
      else {
        this.add(this.input[0], undefined, false)
      }
    }

    return restore(this.result, text, preserve)
  }

  private add(word: string, splitter: string, keep: boolean) {
    if (splitter) {
      word = word.split(splitter).map((part, i) => {
        if ((keep || this.sentenceStart) && i === 0) return part
        if (XRegExp.exec(part, this.innerCaps)) return part
        if (XRegExp.exec(part, this.allCaps)) return part
        return part.toLowerCase()
      }).join(splitter)
    }
    else {
      if (!keep) word = word.toLowerCase()
    }

    this.result += word
    this.input = this.input.substr(word.length)
    if (!word.match(/^\s+$/)) {
      this.sentenceStart = !!word.match(/^[.?!]$/) || (word.length === 2 && word[1] === '.') // Vitamin A. Vitamin B.
    }
  }
}
const sentenceCaser = new SentenceCaser

export function toSentenceCase(text: string, ignoreHTML = false): string {
  return sentenceCaser.convert(text, ignoreHTML)
}
