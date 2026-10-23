import { merge } from './merge.js'
import type { Token } from './tokenizer.js'
import { tokenize } from './tokenizer.js'

const connectedInnerWord = /-\p{Lu}\p{Ll}*(?=-|$)/ug

// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

function titleCase(s: string): string {
  return s.replace(/^(.)(.+)/, (match, car, cdr) => `${car}${cdr.toLowerCase()}`)
}

function wordSC(token: Token, allCaps: boolean, subSentence: boolean): string {
  // domains are case-insensitive
  if (token.type === 'domain') return token.text.toLowerCase()

  // punctuation needs no handling, and websites can have case-sensitive stuff in the URL
  if (token.type !== 'word') return token.text

  // I'll, I'm
  if (token.text.match(/^I'/)) return titleCase(token.text)

  // starting 'a'
  if (subSentence && token.subSentenceStart && token.text.match(/^a$/i)) return 'a'

  // (sub)sentence start
  if ((subSentence && token.subSentenceStart) || token.sentenceStart) {
    return allCaps ? titleCase(token.text) : token.text.replace(connectedInnerWord, match => match.toLowerCase())
  }

  // prepositions should already have been lowercased, but OK
  if (token.subtype === 'preposition') return token.text.toLowerCase()

  // keep acronyms
  if (token.subtype === 'acronym') return token.text

  // if (!allCaps && token.shape.match(/^[Xxd]+(-[Xxd]+)+/)) return XRegExp.replace(token.text, connectedWord, match => match.toLowerCase())

  // Only the pronoun I stays uppercase as a noninitial single capital.
  if (token.text.match(/^[A-HJ-Z]$/)) return token.text.toLowerCase()

  // ?? if (!allCaps && token.shape.match(/^[-X]+$/)) return token.text

  const shape = token.shape.replace(/[^-Xxd]/g, '')
  // ?? if (!allCaps && shape.match(/^[Xd-]+$/)) return token.text

  // hyphenated ?? if (shape.match(/^X[xd]*(-[Xxd]*)*$/)) return token.text.toLowerCase()

  // all-caps and numbers
  if (shape.match(/^[Xd]+$/)) return allCaps ? token.text.toLowerCase() : token.text

  // domain ?? if (token.text.includes('.')) return token.text
  if (shape.match(/x.*X/)) return token.text

  return token.text.toLowerCase()
}

type InlineMarkup = { sourceStart: number; position: number; text: string }
type CasingEdit = { start: number; end: number; replacement: string; boundaries: number[] }

function globalRegex(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
}

function stripMarkup(source: string, pattern?: RegExp) {
  const markup: InlineMarkup[] = []
  if (pattern) {
    let removed = 0
    for (const match of source.matchAll(globalRegex(pattern))) {
      if (!match[0].length) continue
      markup.push({ sourceStart: match.index!, position: match.index! - removed, text: match[0] })
      removed += match[0].length
    }
  }
  const text = pattern ? source.replace(globalRegex(pattern), '') : source
  const visibleOffset = (sourceOffset: number): number => {
    let removed = 0
    for (const tag of markup) {
      if (sourceOffset <= tag.sourceStart) break
      removed += Math.min(tag.text.length, sourceOffset - tag.sourceStart)
    }
    return sourceOffset - removed
  }
  return { text, markup, visibleOffset }
}

function matchingRanges(source: string, pattern: RegExp | undefined, visibleOffset: (offset: number) => number): [number, number][] {
  if (!pattern) return []
  return Array.from(source.matchAll(globalRegex(pattern)), match => [
    visibleOffset(match.index!),
    visibleOffset(match.index! + match[0].length),
  ])
}

function replacementBoundaries(source: string, replacement: string): number[] {
  const boundaries = Array<number>(source.length + 1).fill(0)
  let sourceOffset = 0
  let outputOffset = 0
  while (sourceOffset < source.length) {
    const sourceChar = String.fromCodePoint(source.codePointAt(sourceOffset)!)
    const sourceEnd = sourceOffset + sourceChar.length
    const lower = sourceChar.toLowerCase()
    let outputLength: number
    if (replacement.startsWith(sourceChar, outputOffset)) outputLength = sourceChar.length
    else if (replacement.startsWith(lower, outputOffset)) outputLength = lower.length
    else if (outputOffset < replacement.length) outputLength = String.fromCodePoint(replacement.codePointAt(outputOffset)!).length
    else outputLength = 0
    for (let offset = sourceOffset + 1; offset < sourceEnd; offset++) boundaries[offset] = outputOffset
    sourceOffset = sourceEnd
    outputOffset += outputLength
    boundaries[sourceOffset] = outputOffset
  }
  return boundaries
}

function applyEdits(source: string, edits: CasingEdit[]): string {
  let result = ''
  let cursor = 0
  for (const edit of edits) {
    result += source.slice(cursor, edit.start) + edit.replacement
    cursor = edit.end
  }
  return result + source.slice(cursor)
}

function outputBoundary(position: number, edits: CasingEdit[]): number {
  let delta = 0
  for (const edit of edits) {
    if (position < edit.start) break
    if (position <= edit.end) return edit.start + delta + edit.boundaries[position - edit.start]
    delta += edit.replacement.length - (edit.end - edit.start)
  }
  return position + delta
}

function restoreMarkup(text: string, markup: InlineMarkup[], edits: CasingEdit[]): string {
  const insertions = markup
    .map(tag => ({ position: outputBoundary(tag.position, edits), sourceStart: tag.sourceStart, text: tag.text }))
    .sort((left, right) => left.position - right.position || left.sourceStart - right.sourceStart)
  let result = ''
  let cursor = 0
  for (const insertion of insertions) {
    result += text.slice(cursor, insertion.position) + insertion.text
    cursor = insertion.position
  }
  return result + text.slice(cursor)
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

  const view = stripMarkup(title, options.markup)
  const allCaps = view.text === view.text.toUpperCase()
  const allLower = view.text === view.text.toLowerCase()
  if (options.guess && !allCaps && !allLower) {
    let $title = title
    if (options.nocase) $title = $title.replace(options.nocase, match => match.match(/\s/) ? ' ' : '')
    $title = stripMarkup($title, options.markup).text

    const guess = {
      words: tokenize($title),
      sc: 0,
      other: 0,
    }

    guess.words.forEach((token, i) => {
      if (token.type === 'word' && token.text.length > 1 && !token.subtype.match(/preposition|acronym|ordinal/) && (i === 0 || guess.words[i - 1].type === 'whitespace')) {
        guess[token.shape.match(/^[^X]*x[^X]*$/) ? 'sc' : 'other'] += 1
      }
    })
    if (guess.sc && guess.sc >= guess.other) return title
  }

  if (allCaps && !view.text.match(/\s/)) return title

  const tokens = tokenize(view.text)
  const preserved = matchingRanges(title, options.nocase, view.visibleOffset)
  if (options.preserveQuoted) {
    for (const quote of [/“.*?”/g, /‘.*?’/g, /".*?"/g]) {
      preserved.push(...matchingRanges(title, quote, view.visibleOffset))
    }
  }
  const edits: CasingEdit[] = []
  const addEdit = (token: Token) => {
    if (token.type !== 'word' && token.type !== 'domain') return
    const start = token.start
    const end = token.end + 1
    if (preserved.some(([protectedStart, protectedEnd]) => protectedStart < end && protectedEnd > start)) return
    const replacement = wordSC(token, allCaps, options.subSentenceCapitalization!)
    if (replacement !== token.text) {
      edits.push({ start, end, replacement, boundaries: replacementBoundaries(token.text, replacement) })
    }
  }
  for (const token of tokens) {
    if (token.hyphenated) {
      if (token.shape[0] !== 'x') {
        for (const part of token.hyphenated) addEdit(part)
      }
    } else {
      addEdit(token)
    }
  }

  return restoreMarkup(applyEdits(view.text, edits), view.markup, edits)
}
