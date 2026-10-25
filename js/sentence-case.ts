import { merge } from './merge.js'
import type { Token } from './tokenizer.js'
import { tokenize } from './tokenizer.js'

const connectedInnerWord = /-\p{Lu}\p{Ll}*(?=-|$)/ug

// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

/** Keep the first character and lowercase the remainder, matching the tokenizer's all-caps rule. */
function titleCase(s: string): string {
  return s.replace(/^(.)(.+)/, (match, car, cdr) => `${car}${cdr.toLowerCase()}`)
}

/** Apply the established sentence-case priority order to one complete visible-text token. */
function wordSC(token: Token, allCaps: boolean, subSentence: boolean, hyphenatedPart = false): string {
  // Domain labels are case-insensitive even when their source spelling is mixed case.
  if (token.type === 'domain') return token.text.toLowerCase()

  // Leave punctuation and URLs untouched; URL paths may be case-sensitive.
  if (token.type !== 'word') return token.text

  // I'll, I'm
  if (token.text.match(/^I'/)) return titleCase(token.text)

  // A at a colon-started sub-sentence is an article, not a proper-name initial.
  if (subSentence && token.subSentenceStart && token.text.match(/^a$/i)) return 'a'

  // Sentence starts retain their spelling, except all-caps input is normalized to title case.
  if ((subSentence && token.subSentenceStart) || token.sentenceStart) {
    return allCaps ? titleCase(token.text) : token.text.replace(connectedInnerWord, match => match.toLowerCase())
  }

  // Normalize prepositions defensively, even if their tokenizer classification was already lowercase.
  if (token.subtype === 'preposition') return token.text.toLowerCase()

  // Acronym recognition takes priority over the ordinary single-capital rule.
  if (token.subtype === 'acronym') return token.text

  // Hyphenated title-case parts are not standalone initials, but all-caps parts remain acronyms.
  if (hyphenatedPart && token.shape.match(/^Xx*$/)) return token.text.toLowerCase()

  // Lowercase the standalone article A, but preserve other one-letter capitals as initials.
  if (token.shape === 'X' && Array.from(token.text).length === 1) return token.text === 'A' ? 'a' : token.text

  // if (!allCaps && token.shape.match(/^[Xxd]+(-[Xxd]+)+/)) return XRegExp.replace(token.text, connectedWord, match => match.toLowerCase())

  // ?? if (!allCaps && token.shape.match(/^[-X]+$/)) return token.text

  const shape = token.shape.replace(/[^-Xxd]/g, '')
  // ?? if (!allCaps && shape.match(/^[Xd-]+$/)) return token.text

  // hyphenated ?? if (shape.match(/^X[xd]*(-[Xxd]*)*$/)) return token.text.toLowerCase()

  // Preserve all-caps tokens in mixed-case titles; lowercase them only in an all-caps title.
  if (shape.match(/^[Xd]+$/)) return allCaps ? token.text.toLowerCase() : token.text

  // Keep internal capitalization such as camel case; only ordinary lower/title shapes fall through.
  if (shape.match(/x.*X/)) return token.text

  return token.text.toLowerCase()
}

/** A removed markup match, with its original UTF-16 offset and visible-text insertion position. */
type InlineMarkup = { sourceStart: number; position: number; text: string }

/** A token replacement plus a map from every original UTF-16 boundary to its output boundary. */
type CasingEdit = { start: number; end: number; replacement: string; boundaries: number[] }

/** Return an independent global matcher so callers' flags and lastIndex are not changed. */
function globalRegex(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
}

/** Remove matching markup while recording both restoration points and source-to-visible offsets. */
function stripMarkup(source: string, pattern?: RegExp) {
  const markup: InlineMarkup[] = []
  if (pattern) {
    let removed = 0
    for (const match of source.matchAll(globalRegex(pattern))) {
      // Empty matches cannot represent markup and could otherwise produce repeated insertion points.
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
      // A range boundary inside a tag maps to the same zero-width visible position as the tag.
      removed += Math.min(tag.text.length, sourceOffset - tag.sourceStart)
    }
    return sourceOffset - removed
  }
  return { text, markup, visibleOffset }
}

/** Map source ranges, such as nocase or quoted spans, into the markup-free text coordinates. */
function matchingRanges(source: string, pattern: RegExp | undefined, visibleOffset: (offset: number) => number): [number, number][] {
  if (!pattern) return []
  return Array.from(source.matchAll(globalRegex(pattern)), match => [
    visibleOffset(match.index!),
    visibleOffset(match.index! + match[0].length),
  ])
}

/** Map each original UTF-16 boundary through a token replacement, including expanding case maps. */
function replacementBoundaries(source: string, replacement: string): number[] {
  const boundaries = Array<number>(source.length + 1).fill(0)
  let sourceOffset = 0
  let outputOffset = 0
  while (sourceOffset < source.length) {
    const sourceChar = String.fromCodePoint(source.codePointAt(sourceOffset)!)
    const sourceEnd = sourceOffset + sourceChar.length
    const lower = sourceChar.toLowerCase()
    let outputLength: number
    // Prefer exact alignment, then the character's lowercase expansion (for example, İ -> i + dot).
    if (replacement.startsWith(sourceChar, outputOffset)) outputLength = sourceChar.length
    else if (replacement.startsWith(lower, outputOffset)) outputLength = lower.length
    // Unusual transformations still need a monotone boundary map for later markup insertions.
    else if (outputOffset < replacement.length) outputLength = String.fromCodePoint(replacement.codePointAt(outputOffset)!).length
    else outputLength = 0
    // Never place a saved position between the UTF-16 halves of one surrogate pair.
    for (let offset = sourceOffset + 1; offset < sourceEnd; offset++) boundaries[offset] = outputOffset
    sourceOffset = sourceEnd
    outputOffset += outputLength
    boundaries[sourceOffset] = outputOffset
  }
  return boundaries
}

/** Apply sorted, nonoverlapping token edits to the markup-free source. */
function applyEdits(source: string, edits: CasingEdit[]): string {
  let result = ''
  let cursor = 0
  for (const edit of edits) {
    result += source.slice(cursor, edit.start) + edit.replacement
    cursor = edit.end
  }
  return result + source.slice(cursor)
}

/** Translate a visible-text boundary through all preceding edits and any edit containing it. */
function outputBoundary(position: number, edits: CasingEdit[]): number {
  let delta = 0
  for (const edit of edits) {
    if (position < edit.start) break
    if (position <= edit.end) return edit.start + delta + edit.boundaries[position - edit.start]
    delta += edit.replacement.length - (edit.end - edit.start)
  }
  return position + delta
}

/** Restore protected source spans over cased text using the token edits' boundary map. */
function restorePreservedRanges(source: string, cased: string, ranges: [number, number][], edits: CasingEdit[]): string {
  const merged: [number, number][] = []
  for (const [start, end] of [...ranges].sort((left, right) => left[0] - right[0] || left[1] - right[1])) {
    const previous = merged[merged.length - 1]
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else merged.push([start, end])
  }

  let result = cased
  for (const [start, end] of merged.reverse()) {
    const outputStart = outputBoundary(start, edits)
    const outputEnd = outputBoundary(end, edits)
    result = result.slice(0, outputStart) + source.slice(start, end) + result.slice(outputEnd)
  }
  return result
}

/** Reinsert tags at mapped output boundaries, retaining source order for tags sharing a boundary. */
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

/** Sentence-case visible words while preserving markup, protected spans, and source casing options. */
export function toSentenceCase(title: string, options: Options = {}): string {
  options = merge(options, {
    preserveQuoted: true,
    subSentenceCapitalization: true,
    guess: false,
  })

  // Case classification must see the same whole word regardless of where inline markup falls.
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
    // Guessing preserves the complete original, including markup and any author's casing choices.
    if (guess.sc && guess.sc >= guess.other) return title
  }

  // Keep a one-token all-caps identifier intact; whitespace is measured after removing markup.
  if (allCaps && !view.text.match(/\s/)) return title

  const tokens = tokenize(view.text)
  const preserved = matchingRanges(title, options.nocase, view.visibleOffset)
  if (options.preserveQuoted) {
    for (const quote of [/“.*?”/g, /‘.*?’/g, /".*?"/g]) {
      preserved.push(...matchingRanges(title, quote, view.visibleOffset))
    }
  }
  const edits: CasingEdit[] = []
  const addEdit = (token: Token, hyphenatedPart = false) => {
    // Only lexical tokens are cased; punctuation, markup-free spacing, and URLs remain untouched.
    if (token.type !== 'word' && token.type !== 'domain') return
    const start = token.start
    const end = token.end + 1
    const replacement = wordSC(token, allCaps, options.subSentenceCapitalization!, hyphenatedPart)
    if (replacement !== token.text) {
      edits.push({ start, end, replacement, boundaries: replacementBoundaries(token.text, replacement) })
    }
  }
  for (const token of tokens) {
    if (token.hyphenated) {
      // A lowercase-leading hyphenated word is already sentence-cased; retain the entire form.
      if (token.shape[0] !== 'x') {
        for (const part of token.hyphenated) addEdit(part, true)
      }
    }
    else {
      addEdit(token)
    }
  }

  // Apply casing before reinserting tags so tags never split tokenizer input or casing decisions.
  const cased = applyEdits(view.text, edits)
  const restored = restorePreservedRanges(view.text, cased, preserved, edits)
  return restoreMarkup(restored, view.markup, edits)
}
