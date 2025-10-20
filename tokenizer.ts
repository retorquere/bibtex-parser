import moo from 'moo'

import prepositions from './prepositions.js'

// const show = (obj: any): string => JSON.stringify(obj, null, 2).replace(/[\u007F-\uFFFF]/g, chr => `\\u${(`0000${chr.charCodeAt(0).toString(16)}`).substr(-4)}`)

const RE = new class {
  public Acronym: RegExp
  public Word: RegExp
  public Contraction: RegExp
  public Whitespace = /[ \t\n\r\u00A0]+/u
  public Ordinal: RegExp
  public Email: RegExp
  public Handle: RegExp
  public IntOrVersion: RegExp
  public Domain: RegExp
  public Website: RegExp
  public Preposition: RegExp
  public ComplexPreposition = /^([^ \t\n\r\u00A0]+)([ \t\n\r\u00A0]+)([^ \t\n\r\u00A0]+)(?:([ \t\n\r\u00A0]+)([^ \t\n\r\u00A0]+))?$/u
  public P = /\p{P}/u

  constructor() {
    const B = '(?=(?:[^\\p{L}\\p{N}\\p{M}\\u00AD\\u2060]|$))'
    const LNM = '[\\p{L}\\p{N}\\p{M}\u00AD\u2060]'
    const W = `${LNM}*?\\p{L}${LNM}*`

    this.Acronym = new RegExp(`(?:(?:(?:[\\p{Lu}\\p{Lt}][.]){2,}${B})|(?:(?:vs?[.])(?=[ \t\n\r\u00A0])))`, 'u')
    this.Word = new RegExp(`${W}${B}`, 'u')

    this.Contraction = new RegExp(`${W}['’]${W}${B}`, 'u')
    this.Ordinal = new RegExp(`\\d+(?:st|nd|rd|th)${B}`, 'u')
    this.Email = new RegExp(`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)+${B}`, 'u')
    this.Handle = new RegExp(`@[A-Za-z0-9-]{2,}${B}`, 'u')
    this.IntOrVersion = new RegExp(`v?\\d+(?:\\.\\d+)*${B}`, 'u')
    this.Domain = new RegExp(`${W}(?:[.]${W})+${B}`, 'u')
    this.Website = new RegExp(`https?://${W}(?:[.]${W})+(?:[^.!? \t\n\r\u00A0]+|[.!?]${LNM})+`, 'u')

    const ci = (s: string): string =>
      s
        .replace(/[a-z]/ig, match => `[${match.toUpperCase()}${match.toLowerCase()}]`)
        .replace(' ', this.Whitespace.source)

    this.Preposition = new RegExp(`(?:${prepositions.sort().reverse().map(ci).join('|')})${B}`, 'u')
  }
}()

const lexer = moo.compile({
  'word-preposition': RE.Preposition,
  'word-acronym': RE.Acronym,
  'word-contraction': RE.Contraction,
  'word-ordinal': RE.Ordinal,
  email: RE.Email,
  handle: RE.Handle,
  website: RE.Website,
  domain: RE.Domain,
  word: RE.Word,
  number: RE.IntOrVersion, // eslint-disable-line id-blacklist
  'punctuation-end': /[?.!](?=[ \t\n\r\u00A0]|$)/u,
  'punctuation-colon': /:(?=[ \t\n\r\u00A0])/u,
  'punctuation-ellipsis': /[.][.][.]/u,
  punctuation: RE.P,
  whitespace: { match: /[ \t\n\r\u00A0]/u, lineBreaks: true },
  other: { match: /[\s\S]/u, lineBreaks: true },
})

const Shape = new class {
  private shapes: Record<string, string> = {}
  private re: Record<string, RegExp> = {
    X: /[\p{Lu}\p{Lt}]/u,
    x: /[\p{Ll}\p{Lm}\p{Lo}]/u,
    d: /\p{N}/u,
  }

  private match(c: string): string {
    if (c.match(this.re.d)) return 'd'
    if (c.toLowerCase() === c.toUpperCase()) return c
    if (c.match(this.re.X)) return 'X'
    if (c.match(this.re.x)) return 'x'
    if (c === '’') return "'"
    if (c === '–') return '-'
    if (c === '\u2060' || c === '\u00AD') return ''
    return c
  }

  private fetch(c: string): string {
    if (typeof this.shapes[c] === 'undefined') this.shapes[c] = this.match(c)
    return this.shapes[c]
  }

  shape(t: string) {
    if (!this.shapes[t]) this.shapes[t] = Array.from(t).map(c => this.fetch(c)).join('')
    return this.shapes[t]
  }
}()

export type Token = {
  type: 'word' | 'domain' | 'whitespace'
  subtype: '' | 'preposition' | 'acronym' | 'whitespace' | 'word' | 'domain'
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
  if (t.text === '-' || t.text === '–') return '-'
  return ' '
}

export function tokenize(title: string, markup?: RegExp): Token[] {
  if (markup) title = title.replace(markup, match => '\u2060'.repeat(match.length))

  lexer.reset(title)
  const tokens: Token[] = []
  let sentenceStart = true
  let subSentenceStart = false
  for (const token of lexer) {
    const [type, subtype] = (token.type.includes('-') ? token.type : `${token.type}-`).split('-')

    tokens.push({
      type,
      subtype,
      text: token.text,
      start: token.offset,
      end: token.offset + token.text.length - 1,
      shape: Shape.shape(<string> token.text),
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
    if (stack[0].subtype === 'preposition' && (cpt = stack[0].text.match(RE.ComplexPreposition)) && (cps = stack[0].shape.match(RE.ComplexPreposition))) {
      const complex = stack.shift()

      let start = complex.start
      let end
      for (const i of Array.from({ length: 5 }, (_, n) => n + 1)) {
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
