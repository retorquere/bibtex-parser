/* eslint-disable @typescript-eslint/no-unsafe-argument */
// Original work by Henrik Muehe (c) 2010
//
// CommonJS port by Mikola Lysenko 2013
//
// error recovery and unicode handling by Emiliano Heyns (c) 2017-2024

import * as rx from './re'

class ParsingError extends Error {
  public source: string

  constructor(message, parser) {
    message += ` at ${parser.location()}`
    if (parser.parsing) message += ` in ${JSON.stringify(parser.parsing)}`
    super(message)
    this.name = 'ParsingError'
  }
}

const letter = new RegExp(rx.match(rx.categories.filter(cat => cat.name.match(/^L[utlmo]$/))))

export type Entry = {
  input: string
  type: string
  key: string
  fields: Record<string, string>
}

export interface ParseError {
  error: string
  input?: string
}

export interface ParserOptions {
  /**
   * stop parsing after `max_entries` entries have been found. Useful for quick detection if a text file is in fact a bibtex file
   */
  max_entries?: number

  /**
    * preload these strings
    */
  strings?: string | Record<string, string>
}

export class Library {
  public parsing: string

  public entries: Entry[] = []
  public strings: Record<string, string> = {}
  public comments: string[] = []
  public errors: ParseError[] = []
  public preambles: string[] = []

  private default_strings: Record<string, string> = {
    JAN: '01',
    JANUARY: '01',
    FEB: '02',
    FEBRUARY: '02',
    MAR: '03',
    MARCH: '03',
    APR: '04',
    APRIL: '04',
    MAY: '05',
    JUN: '06',
    JUNE: '06',
    JUL: '07',
    JULY: '07',
    AUG: '08',
    AUGUST: '08',
    SEP: '09',
    SEPTEMBER: '09',
    OCT: '10',
    OCTOBER: '10',
    NOV: '11',
    NOVEMBER: '11',
    DEC: '12',
    DECEMBER: '12',
    ACMCS: 'ACM Computing Surveys',
    ACTA: 'Acta Informatica',
    CACM: 'Communications of the ACM',
    IBMJRD: 'IBM Journal of Research and Development',
    IBMSJ: 'IBM Systems Journal',
    IEEESE: 'IEEE Transactions on Software Engineering',
    IEEETC: 'IEEE Transactions on Computers',
    IEEETCAD: 'IEEE Transactions on Computer-Aided Design of Integrated Circuits',
    IPL: 'Information Processing Letters',
    JACM: 'Journal of the ACM',
    JCSS: 'Journal of Computer and System Sciences',
    SCP: 'Science of Computer Programming',
    SICOMP: 'SIAM Journal on Computing',
    TOCS: 'ACM Transactions on Computer Systems',
    TODS: 'ACM Transactions on Database Systems',
    TOG: 'ACM Transactions on Graphics',
    TOMS: 'ACM Transactions on Mathematical Software',
    TOOIS: 'ACM Transactions on Office Information Systems',
    TOPLAS: 'ACM Transactions on Programming Languages and Systems',
    TCS: 'Theoretical Computer Science',
  }

  private pos = 0
  private linebreaks: number[] = []
  private input: string

  private max_entries: number

  constructor(input: string, options: ParserOptions = {}) {
    this.max_entries = options.max_entries || 0
    this.input = input
    this.parsing = null

    if (typeof options.strings === 'string') {
      this.input = options.strings + '\n' + input // eslint-disable-line prefer-template
    }
    else if (options.strings) {
      for (const [k, v] of Object.entries(options.strings)) {
        this.default_strings[k.toUpperCase()] = v
      }
    }

    let pos = input.indexOf('\n')
    while (pos !== -1) {
      this.linebreaks.push(pos)
      pos = input.indexOf('\n', pos + 1)
    }
  }

  public parse(): void {
    this.bibtex()
    this.entries.reverse()
  }

  public async parseAsync(): Promise<void> {
    await this.bibtexAsync()
    this.entries.reverse()
  }

  private isWhitespace(s, horizontalOnly = false) {
    return (s === ' ' || s === '\t' || (!horizontalOnly && (s === '\r' || s === '\n')))
  }

  private match(s, sws=true) {
    this.skipWhitespace()
    if (this.input.substr(this.pos, s.length) !== s) {
      throw new ParsingError(`Token mismatch, expected ${JSON.stringify(s)}, found ${JSON.stringify(this.input.substr(this.pos, 20))}...`, this) // eslint-disable-line no-magic-numbers
    }

    this.pos += s.length
    if (sws) this.skipWhitespace()
  }

  private tryMatch(s, consume=false) {
    this.skipWhitespace()
    const match = (this.input.substr(this.pos, s.length) === s)
    if (match && consume) this.pos += s.length
    return match
    // this.skipWhitespace()
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && this.input[this.pos].match(/[ \t\r\n%]/)) {
      // test for '%' is shady
      if (this.input[this.pos] === '%') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') this.pos++
      }
      else {
        this.pos++
      }
    }
  }

  /*
  private fix_path() {
    // workaround for https://github.com/siefkenj/unified-latex/issues/94
    const path = '\\path|'
    const verb = path.replace('path', 'verb')
    if (this.input.substring(this.pos).startsWith(path)) {
      // eslint-disable-next-line prefer-template, no-magic-numbers
      this.input = this.input.substring(0, this.pos) + verb + this.input.substring(this.pos + path.length)
    }
  }
  */

  private value_braces() {
    let bracecount = 0
    this.match('{', false)
    const start = this.pos
    let math = false

    while (true) { // eslint-disable-line no-constant-condition
      // this.fix_path()

      switch (this.input[this.pos]) {
        case '\\':
          this.pos += 1
          break

        case '{':
          bracecount++
          break

        case '}':
          if (bracecount === 0) {
            if (math) throw new ParsingError('Unclosed math section', this)
            this.pos++
            return this.input.substring(start, this.pos - 1)
          }
          bracecount--
          break

        case '$':
          math = !math
          break
      }

      this.pos++

      if (this.pos >= this.input.length) {
        throw new ParsingError(`Unterminated brace-value ${JSON.stringify(this.input.substr(start, 20))}`, this) // eslint-disable-line no-magic-numbers
      }
    }
  }

  private value_quotes() {
    this.match('"', false)
    const start = this.pos
    let bracecount = 0
    while (true) { // eslint-disable-line no-constant-condition
      // this.fix_path()

      switch (this.input[this.pos]) {
        case '\\':
          this.pos += 1
          break

        case '{':
          bracecount++
          break

        case '}':
          bracecount--
          break

        case '"':
          if (bracecount <= 0) {
            this.pos++
            return this.input.substring(start, this.pos - 1)
          }
      }

      this.pos++

      if (this.pos >= this.input.length) {
        throw new ParsingError(`Unterminated quote-value ${JSON.stringify(this.input.substr(start, 20))}`, this) // eslint-disable-line no-magic-numbers
      }
    }
  }

  private single_value() {
    if (this.tryMatch('{')) {
      return this.value_braces()
    }
    else if (this.tryMatch('"')) {
      return this.value_quotes()
    }
    else {
      const bare = this.key()
      if (bare.match(/^\d+$/)) return bare

      const u_bare = bare.toUpperCase()
      const resolved = this.strings[u_bare] || this.default_strings[u_bare]
      if (typeof resolved === 'undefined') {
        this.error({
          error: `Unresolved @string reference ${JSON.stringify(bare)}`,
          input: '',
        })
      }
      return resolved || `{{${bare}}}`
    }
  }

  location(): string {
    const lines = this.input.substring(0, this.pos).split('\n')
    return `line ${lines.length}, column ${lines[lines.length - 1].length + 1}`
  }

  error(err: ParseError): void {
    if (this.errors.find(e => e.error === err.error)) return
    this.errors.push(err)
  }

  private value() {
    const values = []
    values.push(this.single_value())
    while (this.tryMatch('#')) {
      this.match('#')
      values.push(this.single_value())
    }
    return values.join('')
  }

  private key(allow=''): string {
    const start = this.pos
    while (true) { // eslint-disable-line no-constant-condition
      if (this.pos === this.input.length) {
        throw new ParsingError('Runaway key', this)
      }

      if (this.input[this.pos].match(/[+'a-zA-Z0-9&;_:\\./-]/) || this.input[this.pos].match(letter) || allow.includes(this.input[this.pos])) {
        this.pos++
      }
      else {
        return this.input.substring(start, this.pos)
      }
    }
  }

  private key_equals_value(key?: string) {
    key = key || this.key()
    if (!key) return // no key found, stray comma

    if (!this.tryMatch('=')) {
      throw new ParsingError(`${key} = value expected, equals sign missing: ${JSON.stringify(this.input.substr(this.pos, 20))}...`, this) // eslint-disable-line no-magic-numbers
    }

    this.match('=')
    const val = this.value()

    if (this.parsing === 'string') {
      this.strings[key.toUpperCase()] = val
    }
    else {
      const bare = key.toLowerCase()
      let postfix = 0
      while (typeof this.entries[0].fields[key = (postfix ? `${bare}+duplicate-${postfix}` : bare)] === 'string') {
        postfix++
      }
      this.entries[0].fields[key] = val
    }
  }

  private entry(d: string, guard: string) {
    if (this.tryMatch(guard)) return // empty entry

    let key: string
    // mendeley end endnote can output entries without key... sure...
    if (this.tryMatch(',')) {
      // mendeley absurdity which outputs keyless entries, but at least have the decency to put a comma there
      key = ''
    }
    else {
      // so maybe a real key?
      key = this.key('[]*"')
    }

    if (this.tryMatch('=')) {
      // nope; endnote just skips the comma; we can infer we're in this moronic situation because we've been dumped into field-parsing
      this.key_equals_value(key)
    }
    else {
      // so we did find the real key earlier
      this.entries[0].key = key
    }
    this.tryMatch(',', true)
    if (this.tryMatch(guard)) return // no fields

    this.key_equals_value()
    while (this.tryMatch(',', true)) {
      // fixes problems with commas at the end of a list
      if (this.tryMatch(guard)) return

      this.key_equals_value()
    }
  }

  private directive() {
    this.match('@')
    return this.key().toLowerCase()
  }

  private string() { // eslint-disable-line id-blacklist
    this.key_equals_value()
  }

  private preamble() {
    this.preambles.push(this.value())
  }

  private comment() {
    while (this.isWhitespace(this.input[this.pos], true)) this.pos++

    if (this.input[this.pos] === '{') {
      this.comments.push(this.value_braces())
    }
    else {
      const start = this.pos
      while (this.input[this.pos] !== '\n' && this.pos < this.input.length) this.pos++
      this.comments.push(this.input.substring(start, this.pos))
    }
  }

  private hasMore() {
    if (this.max_entries && this.entries.length >= this.max_entries) return false
    return (this.pos < this.input.length)
  }

  private bibtex() {
    while (this.hasMore()) {
      this.parseNext()
    }
  }

  private bibtexAsync() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.hasMore() ? (new Promise(resolve => resolve(this.parseNext()))).then(() => this.bibtexAsync()) : Promise.resolve(null)
  }

  private matchGuard() {
    for (const guard of ['{}', '()']) {
      if (this.tryMatch(guard[0])) {
        this.match(guard[0])
        return guard[1]
      }
    }

    throw new ParsingError(`Token mismatch, expected '{' or '(', found ${JSON.stringify(this.input.substr(this.pos, 20))}...`, this) // eslint-disable-line no-magic-numbers
  }

  private parseNext() {
    this.skipWhitespace()

    while (this.pos < this.input.length && this.input[this.pos] !== '@') {
      if (this.input[this.pos] === '%') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') this.pos++
      }
      else {
        this.pos++
      }
    }
    if (this.pos >= this.input.length) return

    let guard = ''
    const start = this.pos
    try {
      const d = this.parsing = this.directive()
      switch (d) {
        case 'string':
          guard = this.matchGuard()
          this.string()
          this.match(guard)
          break

        case 'preamble':
          this.preamble()
          break

        case 'comment':
          this.comment()
          break

        default:
          guard = this.matchGuard()
          this.entries.unshift({ input: '', type: d, key: '', fields: {} })
          this.entry(d, guard)
          this.match(guard)
          this.entries[0].input = this.input.substring(start, this.pos).trim()
          break
      }
    }
    catch (err) {
      if (err.name !== 'ParsingError') throw err
      // skip ahead to the next @ and try again
      this.pos = start + 1
      while (this.pos < this.input.length && this.input[this.pos] !== '@') this.pos++
      this.error({
        error: err.message,
        input: this.input.substring(start, this.pos),
      })
    }
  }
}

/**
 * Parses a bibtex source in verbatim mode. Good for detection of bibtex and for later LaTeX-reparsing.
 */
export function parse(input: string, options: ParserOptions = {}): Library {
  const parser = new Library(input, options)
  parser.parse()
  return parser
}

export const promises = {
  async parse(input: string, options: ParserOptions = {}): Promise<Library> { // eslint-disable-line prefer-arrow/prefer-arrow-functions
    const parser = new Library(input, options)
    await parser.parseAsync()
    return parser
  },
}
