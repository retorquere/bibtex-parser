/* eslint-disable @typescript-eslint/no-unsafe-argument */
import * as bibtex from './grammar'
import * as chunker from './chunker'
import * as jabref from './jabref'
import { JabRefMetadata, parse as parseJabRef } from './jabref'
import { latex as latex2unicode, diacritics } from 'unicode2latex'
import crossref from './crossref.json'
import allowed from './fields.json'
import XRegExp from 'xregexp'

type TextRange = { start: number, end: number, description?: string }

function restore(text: string, orig: string, preserve: TextRange[]) {
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

/*
export function toSentenceCase(text: string): string {
  let haslowercase = false
  const restore: [number, number, string][] = []
  let sentencecased = text.replace(/((?:^|[?!]|[-.:;[\]<>'*\\(),{}—_“”‘’])?\s*)([^-\s;?:.![\]<>'*\\(),{}—_“”‘’]+)/g, (match: string, leader:string, word:string, offset: number) => {
    // if (word.match(/^[A-Z]$/) && word !== 'I') {
    if (word === 'I') {
      const leaderlen = leader?.length || 0
      restore.push([offset + leaderlen, offset + leaderlen + word.length, word])
    }
    else if (word.match(/^[a-z]/)) {
      haslowercase = true
    }
    if (leader && !leader.match(/^[?!]/) && word.match(/^[A-Z][^A-Z]*$/)) {
      word = word.toLowerCase()
    }
    return (leader || '') + word
  })

  if (haslowercase) {
    for (const [start, end, word] of restore) {
      sentencecased = sentencecased.substr(0, start) + word + sentencecased.substr(end)
    }
  }

  return sentencecased
}
*/

type Node =
  | bibtex.Bibliography
  | bibtex.Math
  | bibtex.Environment
  | bibtex.Block
  | bibtex.RegularCommand
  | bibtex.DiacriticCommand
  | bibtex.Entry
  | bibtex.Field
  | bibtex.NumberValue
  | bibtex.StringDeclaration
  | bibtex.StringReference
  | bibtex.SubscriptCommand
  | bibtex.SuperscriptCommand
  | bibtex.SymbolCommand
  | bibtex.TextValue
  | bibtex.PreambleExpression
  | bibtex.BracedComment
  | bibtex.LineComment

  | bibtex.Markup
  | bibtex.NonEntryText

class ParserError extends Error {
  public node: any

  constructor(message?: string, node?: any) {
    super(message) // 'Error' breaks prototype chain here
    Object.setPrototypeOf(this, new.target.prototype) // restore prototype chain
    this.name = this.constructor.name
    this.node = node
  }
}

class TeXError extends Error {
  public node: any
  public text: string

  constructor(message: string, node: any, text: string) {
    super(message) // 'Error' breaks prototype chain here
    Object.setPrototypeOf(this, new.target.prototype) // restore prototype chain
    this.name = this.constructor.name
    this.node = node
    this.text = text
  }
}

type CharCategory = { alias: string, bmp: string }
function charCat(charcats: CharCategory[], select: string[]): string {
  return charcats.filter((cat: CharCategory) => select.includes(cat.alias)).map((cat: CharCategory) => cat.bmp).join('')
}

import charCategories = require('xregexp/tools/output/categories')
const charClass = {
  Lu: charCat(charCategories, ['Uppercase_Letter', 'Titlecase_Letter']),
  Ll: charCat(charCategories, ['Lowercase_Letter']),
  LnotLu: charCat(charCategories, ['Lowercase_Letter', 'Modifier_Letter', 'Other_Letter', 'Nonspacing_Mark', 'Spacing_Mark', 'Decimal_Number', 'Letter_Number']),
  P: charCat(charCategories, ['Punctuation']),
  L: charCat(charCategories, ['Letter']),
  N: charCat(charCategories, ['Decimal_Number', 'Letter_Number']),
  AlphaNum: charCat(charCategories, ['Letter', 'Decimal_Number', 'Letter_Number']),
  LC: charCat(charCategories, ['Cased_Letter']),
}

const marker = {
  and: '\u0001',
  comma: '\u0002',
  space: '\u0003',
  literal: '\u0004',
  markup: '\u0005',

  re: {
    and: /./,
    comma: /./,
    space: /./,
    literal: /./,

    literalName: /./,
  },
  clean(s: string): string { // eslint-disable-line prefer-arrow/prefer-arrow-functions
    return s.replace(marker.re.space, ' ').replace(marker.re.comma, ', ').replace(marker.re.literal, '')
  },
}
marker.re = {
  and: new RegExp(marker.and, 'g'),
  comma: new RegExp(marker.comma, 'g'),
  space: new RegExp(marker.space, 'g'),
  literal: new RegExp(marker.literal, 'g'),

  literalName: new RegExp(`^${marker.literal}([^${marker.literal}]*)${marker.literal}$`),
}

const preserveCase = {
  leadingCap: new RegExp(`^[${charClass.Lu}][${charClass.LnotLu}]+[${charClass.P}]?$`),
  allCaps: new RegExp(`^[${charClass.Lu}${charClass.N}]{2,}$`),
  allLower: new RegExp(`^[${charClass.Ll}${charClass.N}]{2,}$`),
  joined: new RegExp(`^[${charClass.Lu}][${charClass.LnotLu}]*([-+][${charClass.L}${charClass.N}]+)*[${charClass.P}]*$`),
  hasUpper: new RegExp(`[${charClass.Lu}]`),
  hasLower: new RegExp(`[${charClass.Ll}]`),
  isNumber: /^[0-9]+$/,
  hasAlpha: new RegExp(`[${charClass.L}]`),
  hasAlphaNum: new RegExp(`[${charClass.AlphaNum}]`),
  notAlphaNum: new RegExp(`[^${charClass.AlphaNum}]`, 'g'),
  sentenceStart: new RegExp(`(^|([\u2014:?!.]\\s+))[${charClass.Lu}]`, 'g'),

  markup: /<\/?span[^>]*>/g,
  acronym: new RegExp(`.*\\.${marker.markup}*[${charClass.Lu}]${marker.markup}*\\.$`),

  notCaseSensitive: new RegExp(`[^${charClass.LC}]`),
  isCaseSensitive: new RegExp(`[${charClass.LC}]`),
  quoted: /("[^"]+")|(“[^“]+“)/g,
}

export interface Name {
  /**
   * If the name is a literal (surrounded by braces) it will be in this property, and none of the other properties will be set
   */
  literal?: string

  /**
   * Family name
   */
  lastName?: string

  /**
   * available when parsing biblatex extended name format
   */
  useprefix?: boolean

  /**
   * available when parsing biblatex extended name format
   */
  juniorcomma?: boolean

  /**
   * given name. Will include middle names and initials.
   */
  firstName?: string

  /**
   * Initials.
   */
  initial?: string

  /**
   * things like `Jr.`, `III`, etc
   */
  suffix?: string

  /**
   * things like `von`, `van der`, etc
   */
  prefix?: string
}

export interface Entry {
  /**
   * citation key
   */
  key: string

  /**
   * entry type
   */
  type: string

  /**
   * entry fields. The keys are always in lowercase
   */
  fields: { [key: string]: string[] }

  /**
   * authors, editors, by creator type. Name order within the creator-type is retained.
   */
  creators: { [type: string]: Name[] }

  /**
   * will be set to `true` if sentence casing was applied to the entry
   */
  sentenceCased?: boolean
}

type FieldBuilder = {
  name: string
  text: string
  level: number
  preserveRanges: TextRange[]
  html?: boolean
  words: {
    upper: number
    lower: number
    other: number
  }
}

/**
 * Markup mapping. As the bibtex file is parsed, markup will be transformed according to this table
 */
export interface MarkupMapping {
  sub?: { open: string, close: string }
  sup?: { open: string, close: string }
  bold?: { open: string, close: string }
  italics?: { open: string, close: string }
  smallCaps?: { open: string, close: string }
  caseProtect?: { open: string, close: string }
  enquote?: { open: string, close: string }
  h1?: { open: string, close: string }
  h2?: { open: string, close: string }

  roman?: { open: string, close: string }
  fixedWidth?: { open: string, close: string }
}

export interface Bibliography {
  /**
   * errors found while parsing
   */
  errors: ParseError[]

  /**
   * entries in the order in which they are found, omitting those which could not be parsed.
   */
  entries: Entry[]

  /**
   * `@comment`s found in the bibtex file.
   */
  comments: string[]

  /**
   * `@string`s found in the bibtex file.
   */
  strings: Record<string, string>

  /**
   * `@preamble` declarations found in the bibtex file
   */
  preamble: string[]

  /**
   * jabref metadata (such as groups information) found in the bibtex file
   */
  jabref: JabRefMetadata
}

export interface ParseError {
  /**
   * error message
   */
  message: string

  /**
   * text block that was parsed where the error was found
   */
  source?: string

  /**
   * Error line number within the bibtex file
   */
  line?: number

  /**
   * Error column number within the bibtex file
   */
  column?: number
}

export const fields = {
  creator: [
    'author',
    'bookauthor',
    'collaborator',
    'commentator',
    'director',
    'editor',
    'editora',
    'editorb',
    'editors',
    'holder',
    'scriptwriter',
    'translator',
  ],
  title: [
    'title',
    'series',
    'shorttitle',
    'booktitle',
    'type',
    'origtitle',
    'maintitle',
    'eventtitle',
  ],
  unnest: [
    'publisher',
    'location',
  ],
  verbatim: [
    'doi',
    'eprint',
    'file',
    'files',
    'groups', // jabref unilaterally decided to make this non-standard field verbatim
    'ids',
    'url',
    'verba',
    'verbb',
    'verbc',
  ],
  html: [
    'annotation',
    'comment',
    'annote',
    'review',
    'notes',
    'note',
  ],
  unabbrev: [
    'journal',
    'journaltitle',
    'journal-full',
  ],
}

export interface ParserOptions {
  /**
   * BibTeX files are expected to store title-type fields in Sentence Case, where other reference managers (such as Zotero) expect them to be stored as Sentence case. When there is no language field, or the language field
   * is one of the languages (case insensitive) passed in this option, the parser will attempt to sentence-case title-type fields as they are being parsed. This uses heuristics and does not employ any kind of natural
   * language processing, so you should always inspect the results. Default languages to sentenceCase are:
   *
   * - american
   * - british
   * - canadian
   * - english
   * - australian
   * - newzealand
   * - usenglish
   * - ukenglish
   * - en
   * - eng
   * - en-au
   * - en-bz
   * - en-ca
   * - en-cb
   * - en-gb
   * - en-ie
   * - en-jm
   * - en-nz
   * - en-ph
   * - en-tt
   * - en-us
   * - en-za
   * - en-zw
   *
   * If you pass an empty array, or `false`, no sentence casing will be applied (even when there's no language field).
   */
  sentenceCase?: string[] | boolean

  /**
   * Some bibtex has titles in sentence case, or all-uppercase. If this is on, and there is a field that would normally have sentence-casing applied in which more words are all-`X`case
   * (where `X` is either lower or upper) than mixed-case, it is assumed that you want them this way, and no sentence-casing will be applied to that field
   */
  guessAlreadySentenceCased?: boolean

  /**
   * translate braced parts of text into a case-protected counterpart; uses the [[MarkupMapping]] table in `markup`. Default == true == as-needed.
   * In as-needed mode the parser will assume that words that have capitals in them imply "nocase" behavior in the consuming application. If you don't want this, turn this option on, and you'll get
   * case protection exactly as the input has it
   */
  caseProtection?: 'as-needed' | 'strict' | boolean

  /**
   * The parser can change TeX markup (\\textsc, \\emph, etc) to a text equivalent. The defaults are HTML-oriented, but you can pass in your own configuration here
   */
  markup?: MarkupMapping

  /**
   * By default, when an unexpected parsing error is found (such as a TeX command which the parser does not know about), the parser will throw an error. You can pass a function to handle the error instead,
   * where you can log it, display it, or even still throw an error
   */
  errorHandler?: false | ((err: Error) => void)

  /**
   * By default, when a TeX command is encountered which the parser does not know about, the parser will throw an error. You can pass a function here to return the appropriate AST for the command.
   */
  unknownCommandHandler?: false | ((node: bibtex.RegularCommand) => Node)

  /**
   * Some fields such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands. You can change the default list here if you want,
   * for example to help parse Mendeley `file` fields, which against spec are not in verbatim mode.
   */
  verbatimFields?: (string | RegExp)[]

  /**
   * Some commands such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands.
   */
  verbatimCommands?: string[]

  /**
   * In the past many bibtex entries would just always wrap a field in double braces, likely because whomever was writing them couldn't figure out the case meddling rules (and who could
   * blame them). Fields listed here will either have one outer layer of braces treated as case-preserve, or have the outer braced be ignored completely, if this is detected.
   */
  unnestFields?: string[]
  unnestMode?: 'preserve' | 'unwrap'

  /**
   * Some note-like fields may have more rich formatting. If listed here, more HTML conversions will be applied.
   */
  htmlFields?: string[]

  /**
   * If this flag is set entries will be returned without conversion of LaTeX to unicode equivalents.
   */
  raw?: boolean

  /**
   * You can pass in an existing @string dictionary
   */
  strings?: Record<string, string> | string

  /**
   * BibTeX files may have abbreviations in the journal field. If you provide a dictionary, journal names that are found in the dictionary are replaced with the attached full name
   */
  unabbreviate?: Record<string, string>

  /**
   * Apply crossref inheritance
   */
  applyCrossRef?: boolean
}

const english = [
  'american',
  'british',
  'canadian',
  'english',
  'australian',
  'newzealand',
  'usenglish',
  'ukenglish',
  'en',
  'eng',
  'en-au',
  'en-bz',
  'en-ca',
  'en-cb',
  'en-gb',
  'en-ie',
  'en-jm',
  'en-nz',
  'en-ph',
  'en-tt',
  'en-us',
  'en-za',
  'en-zw',
  'anglais', // don't do this people
]

class Parser {
  private errors: ParseError[]
  private strings: Record<string, bibtex.ValueType[]>
  private in_preamble = false
  private newcommands: Record<string, bibtex.ValueType[]>
  private unresolvedStrings: Record<string, boolean>
  private default_strings: Record<string, bibtex.TextValue[]>
  private preloaded_strings: Record<string, bibtex.ValueType[]>
  private comments: string[]
  private entries: Entry[]
  private entry: Entry
  private cleaning: {
    type: 'title' | 'creator' | 'other'
    name?: string
  }
  private field: FieldBuilder
  private chunk: string
  private options: ParserOptions
  private preamble: string[] = []

  public log: (string) => void = function(_str) {} // eslint-disable-line prefer-arrow/prefer-arrow-functions, @typescript-eslint/no-empty-function, id-blacklist

  constructor(options: ParserOptions = {}) {
    for (const [option, value] of Object.entries(options)) {
      if (typeof value === 'undefined') delete options[option]
    }

    if (options.errorHandler === false) {
      // eslint-disable-next-line prefer-arrow/prefer-arrow-functions, @typescript-eslint/no-empty-function
      options.errorHandler = function(_err) {}
    }
    else if (typeof options.errorHandler === 'undefined') {
      // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
      options.errorHandler = function(err) { throw err }
    }

    if (typeof options.sentenceCase === 'boolean') {
      options.sentenceCase = options.sentenceCase ? english : []
    }
    else {
      options.sentenceCase = options.sentenceCase || english
    }

    if (!options.strings) options.strings = {}
    if (!options.unabbreviate) options.unabbreviate = {}

    if (options.raw) {
      options.sentenceCase = false
      options.caseProtection = false
    }

    this.options = {
      caseProtection: 'as-needed',
      verbatimFields: [ /^citeulike-linkout-[0-9]+$/, /^bdsk-url-[0-9]+$/, ...fields.verbatim],
      verbatimCommands: [ 'url' ],
      unnestFields: [ ...fields.title, ...fields.unnest, ...fields.verbatim],
      unnestMode: 'unwrap',
      htmlFields: fields.html,
      guessAlreadySentenceCased: true,
      applyCrossRef: options.applyCrossRef || typeof options.applyCrossRef === 'undefined',
      markup: {},

      ...options,
    }

    const markup_defaults: Record<string, { open: string, close: string}> = {
      enquote: { open: '\u201c', close: '\u201d' },
      sub: { open: '<sub>', close: '</sub>' },
      sup: { open: '<sup>', close: '</sup>' },
      bold: { open: '<b>', close: '</b>' },
      italics: { open: '<i>', close: '</i>' },
      smallCaps: { open: '<span style="font-variant:small-caps;">', close: '</span>' },
      caseProtect: { open: '<span class="nocase">', close: '</span>' },
      roman: { open: '', close: '' },
      fixedWidth: { open: '<tt>', close: '</tt>' },
    }
    // patch in because the options will likely not have enquote and case-protect
    for (const [markup, {open, close}] of Object.entries(markup_defaults)) {
      this.options.markup[markup] = this.options.markup[markup] || { open, close }
    }
    for (const i of [1, 2, 3, 4]) { // eslint-disable-line no-magic-numbers
      this.options.markup[`h${i}`] = this.options.markup[`h${i}`] || { open: `<h${i}>`, close: `</h${i}>` }
    }

    this.unresolvedStrings = {}

    this.errors = []
    this.comments = []
    this.entries = []
    this.strings = { }
    this.newcommands = { }
    this.default_strings = {
      JAN: [ this.text('01') ],
      FEB: [ this.text('02') ],
      MAR: [ this.text('03') ],
      APR: [ this.text('04') ],
      MAY: [ this.text('05') ],
      JUN: [ this.text('06') ],
      JUL: [ this.text('07') ],
      AUG: [ this.text('08') ],
      SEP: [ this.text('09') ],
      OCT: [ this.text('10') ],
      NOV: [ this.text('11') ],
      DEC: [ this.text('12') ],
      ACMCS: [ this.text('ACM Computing Surveys') ],
      ACTA: [ this.text('Acta Informatica') ],
      CACM: [ this.text('Communications of the ACM') ],
      IBMJRD: [ this.text('IBM Journal of Research and Development') ],
      IBMSJ: [ this.text('IBM Systems Journal') ],
      IEEESE: [ this.text('IEEE Transactions on Software Engineering') ],
      IEEETC: [ this.text('IEEE Transactions on Computers') ],
      IEEETCAD: [ this.text('IEEE Transactions on Computer-Aided Design of Integrated Circuits') ],
      IPL: [ this.text('Information Processing Letters') ],
      JACM: [ this.text('Journal of the ACM') ],
      JCSS: [ this.text('Journal of Computer and System Sciences') ],
      SCP: [ this.text('Science of Computer Programming') ],
      SICOMP: [ this.text('SIAM Journal on Computing') ],
      TOCS: [ this.text('ACM Transactions on Computer Systems') ],
      TODS: [ this.text('ACM Transactions on Database Systems') ],
      TOG: [ this.text('ACM Transactions on Graphics') ],
      TOMS: [ this.text('ACM Transactions on Mathematical Software') ],
      TOOIS: [ this.text('ACM Transactions on Office Information Systems') ],
      TOPLAS: [ this.text('ACM Transactions on Programming Languages and Systems') ],
      TCS: [ this.text('Theoretical Computer Science') ],
    }

    if (typeof this.options.strings === 'string') {
      const strings = this.options.strings
      this.options.strings = {}
      this.parseChunk({ text: strings, offset: { pos: 0, line: 0 } })
      this.preloaded_strings = this.strings
      this.strings = {}
    }
    else {
      this.preloaded_strings = {}
    }
  }

  public ast(input, clean = true): Node[] {
    let parsed: Node[] = []
    for (const chunk of chunker.parse(input)) {
      const { children } = bibtex.parse(chunk.text, {...this.options, combiningDiacritics: diacritics.commands})
      if (clean) this.clean(children)
      parsed = parsed.concat(children)
    }
    return parsed
  }

  public parse(input): Bibliography {
    for (const chunk of chunker.parse(input)) {
      this.parseChunk(chunk)
    }
    return this.parsed()
  }

  public async parseAsync(input): Promise<Bibliography> {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    for (const chunk of await chunker.promises.parse(input)) {
      this.parseChunk(chunk)
    }
    return this.parsed()
  }

  private applyCrossref(entry: Entry, entries: Record<string, Entry>) {
    for (const xref of ['crossref', 'xdata']) {
      if (!entry.fields[xref]) continue
      for (const parents of entry.fields[xref]) {
        let applied = false
        for (const parent of parents.split(/\s*,\s*/).map(key => entries[key]).filter(p => p)) {
          this.applyCrossref(parent, entries)

          for (const mappings of [crossref[entry.type], crossref['*']].filter(m => m)) {
            for (const mapping of [mappings[parent.type], mappings['*']].filter(m => m)) {
              for (const [target, source] of Object.entries(mapping as Record<string, string>)) {
                if (!entry.fields[target] && parent.fields[source]) {
                  entry.fields[target] = parent.fields[source]
                  applied = true
                }
              }

              for (const field of (allowed[entry.type] || [])) {
                if (!entry.fields[field] && parent.fields[field]) {
                  entry.fields[field] = parent.fields[field]
                  applied = true
                }
              }
            }
          }
        }
        if (applied) delete entry.fields[xref]
      }
    }
  }

  private parsed(): Bibliography {
    this.field = null
    const strings = {}
    this.cleaning = { type: 'other' }
    for (const [key, value] of Object.entries(this.strings)) {
      this.field = {
        name: '@string',
        text: '',
        level: 0,
        preserveRanges: null,
        words: {
          upper: 0,
          lower: 0,
          other: 0,
        },
      }
      this.convert(this.clean(value))
      strings[key] = this.field.text
    }

    if (this.options.applyCrossRef) {
      const entries: Record<string, Entry> = this.entries.reduce((acc, entry) => {
        acc[entry.key] = entry
        return acc
      }, {})

      for (const entry of this.entries) {
        this.applyCrossref(entry, entries)
      }
    }

    const { comments, jabref } = parseJabRef(this.comments) // eslint-disable-line @typescript-eslint/no-shadow

    return {
      errors: this.errors,
      entries: this.entries,
      comments,
      jabref,
      strings,
      preamble: this.preamble,
    }
  }

  private preserve(start: number, end?: number, reason?: string) {
    if (!this.field.preserveRanges) return

    if (!end) {
      this.field.preserveRanges = null
      return
    }

    /*
    this.field.preserveRanges = this.field.preserveRanges.filter(range => range.start < start || range.end > end)
    if (this.field.preserveRanges.find(range => range.start <= start && range.end >= end)) return
    */

    /*
    if (this.field.preserveRanges && this.field.preserveRanges.length) {
      const last = this.field.preserveRanges[this.field.preserveRanges.length - 1]
      if (start < last.start) throw new Error(JSON.stringify({...last, new: { start, end, reason }, text: this.field.text}))
    }
    */
    this.field.preserveRanges.push({start, end, description: reason})
  }

  private parseChunk(chunk: chunker.Chunk) {
    this.chunk = chunk.text

    try {
      let bib = bibtex.parse(chunk.text, {...this.options, combiningDiacritics: diacritics.commands})
      if (bib.kind !== 'Bibliography') throw new Error(this.show(bib))
      bib = (this.clean(bib) as bibtex.Bibliography)

      for (const entity of bib.children) {
        switch (entity.kind) {
          case 'Entry':
          case 'BracedComment':
          case 'LineComment':
          case 'PreambleExpression':
            this.convert(entity)
            break

          case 'StringDeclaration':
          case 'NonEntryText':
            break
        }
      }

      return bib
    }
    catch (err) {
      if (!err.location) throw err
      this.errors.push({
        message: err.message,
        // no idea why eslint doesn't understand this type guard
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        line: err.location.start.line + chunk.offset.line,
        column: err.location.start.column,
        source: this.chunk,
      })

      return null
    }
  }

  private show(o) {
    // eslint-disable-next-line prefer-template
    let text = JSON.stringify(o)
    if (this.chunk) text += `\n${this.chunk.trim()}`
    return text
  }

  private text(value = ''): bibtex.TextValue {
    return { kind: 'Text', value, mode: 'text' }
  }

  private error(err, returnvalue?: Node): Node {
    if (typeof this.options.errorHandler === 'function') this.options.errorHandler(err)
    return returnvalue || this.text()
  }

  private condense(node: bibtex.Field | bibtex.Block | bibtex.Math | bibtex.Environment) {
    // apply cleaning to resulting children
    node.value = this.clean(node.value) as bibtex.ValueType[]

    // unpack redundant blocks
    node.value = node.value.reduce((acc: bibtex.ValueType[], child: bibtex.ValueType) => {
      if (child.kind === 'Block' && !child.case && Object.keys(child.markup).length === 0) {
        acc = acc.concat(child.value)
      }
      else {
        acc.push(child)
      }
      return acc
    }, [])

    // condense text nodes to make whole words for sentence casing
    node.value = node.value.reduce((acc: Node[], child: Node, i: number) => {
      if (acc.length === 0) {
        acc.push(child)
        return acc
      }

      const last = acc[acc.length - 1]
      const next = node.value[i + 1]

      if (this.options.caseProtection === 'strict' && this.onlyCaseProtected(last) && child.kind === 'Text' && !child.value.match(preserveCase.isCaseSensitive) && this.onlyCaseProtected(next)) {
        (last as bibtex.Block).value.push(child)
        delete last.source
        return acc
      }

      if (last.kind === 'Block' && child.kind === 'Block' && Object.keys(last.markup).sort().join('/') === Object.keys(child.markup).sort().join('/')) {
        last.value = last.value.concat(child.value)
        delete last.source
        return acc
      }

      if (last.kind === 'Text' && child.kind === 'Text' && last.mode === child.mode) {
        last.value += child.value
        delete last.source
        return acc
      }

      acc.push(child)
      return acc
    }, []) as unknown as bibtex.ValueType[]
  }
  private onlyCaseProtected(node) {
    return node?.kind === 'Block' && node.case === 'protect' && Object.keys(node.markup).join('/') === ''
  }

  private argument(node: bibtex.RegularCommand, kind: string | number) {
    if (!node.arguments || !node.arguments.required.length) return (kind === 'none')

    // expect 'n' text arguments
    if (typeof kind === 'number') {
      return node.arguments.required.length === kind ? node.arguments.required : false
    }

    // return first argument if it's the only one
    if (node.arguments.required.length !== 1) return false

    // loose checking for text
    if (kind === 'text') {
      const first = node.arguments.required[0]
      if (first.kind === 'Block') {
        switch (first.value.length) {
          case 0:
            return ''
          case 1:
            if (first.value[0].kind === 'Text') return first.value[0].value
            break
        }
      }
      // fall back to strict kind check
      kind = 'Text'
    }

    // return first argument if it's the only one and is of the specified kind
    if (node.arguments.required.length !== 1 || node.arguments.required[0].kind !== kind) return false
    switch (node.arguments.required[0].kind) {
      case 'Text':
        // no idea why eslint insists this is a @typescript-eslint/no-unsafe-return
        return node.arguments.required[0].value
      case 'RegularCommand':
        return node.arguments.required[0]
      case 'Block':
        return node.arguments.required[0]
    }

    return false
  }

  private isBreak(node: Node, kind: string[]) {
    return node && node.kind === 'RegularCommand' && kind.includes(node.command)
  }

  private clean(node: Node[]): Node[]
  private clean(node: Node): Node
  private clean(node: Node | Node[]): Node | Node[] {
    if (Array.isArray(node)) {
      return node
        .filter((child, i) => !(this.isBreak(child, ['\\']) && this.isBreak(node[i-1], ['\\', 'par']))) // condense linebreaks
        .filter((child, i) => !this.isBreak(child, ['par']) || !this.isBreak(node[i-1], ['par'])) // condense parbreaks
        .map(child => this.clean(child)) // eslint-disable-line @typescript-eslint/no-unsafe-return
    }
    delete node.loc

    switch (node.kind) {
      case 'InlineMath':
      case 'DisplayMath':
        return this.clean_block(node)

      case 'Environment':
        return this.clean_environment(node)

      case 'Block':
        return this.clean_block(node)

      case 'Bibliography':
        return this.clean_bib(node)

      case 'RegularCommand':
        return this.clean_command(node)

      case 'DiacriticCommand':
        return this.clean_diacritic(node)

      case 'Entry':
        return this.clean_entry(node)

      case 'Field':
        return this.options.raw ? node : this.clean_field(node)

      case 'StringDeclaration':
        return this.clean_stringdecl(node)

      case 'StringReference':
        return this.clean_stringref(node)

      case 'SubscriptCommand':
      case 'SuperscriptCommand':
        return this.clean_script(node)

      case 'SymbolCommand':
        return this.clean_symbol(node)

      case 'PreambleExpression':
        return this.clean_preamble(node)

      case 'Number':
      case 'Text':
      case 'BracedComment':
      case 'LineComment':
      case 'NonEntryText':
        return node

      default:
        return this.error(new ParserError(`no cleanup method for ${this.show(node)}`, node), this.text())
    }
  }

  private clean_preamble(node: bibtex.PreambleExpression): Node {
    this.in_preamble = true
    try {
      return this.clean(node.value) as unknown as Node
    }
    finally {
      this.in_preamble = false
    }
  }
  private clean_bib(node: bibtex.Bibliography) {
    node.children = node.children.filter(child => child.kind !== 'NonEntryText').map(child => this.clean(child as Node)) as bibtex.Node[]
    return node
  }

  private clean_stringdecl(node: bibtex.StringDeclaration) {
    this.strings[node.name.toUpperCase()] = node.value
    return node
  }

  private clean_stringref(node: bibtex.StringReference) {
    const name = node.name.toUpperCase()
    const stringvalue = this.strings[name]
      || this.options.strings[name]
      || this.preloaded_strings[name]
      || this.default_strings[name]
      || (fields.unabbrev.includes(this.cleaning.name) && this.options.unabbreviate[name] && [ this.text(this.options.unabbreviate[name]) ])

    if (!stringvalue) {
      if (!this.unresolvedStrings[name]) this.errors.push({ message: `Unresolved @string reference ${JSON.stringify(node.name)}` })
      this.unresolvedStrings[name] = true
    }

    return this.clean({
      kind: 'Block',
      // if the string isn't found, add it as-is but exempt it from sentence casing
      case: stringvalue ? undefined : 'preserve',
      markup: {},
      value: stringvalue ? (JSON.parse(JSON.stringify(stringvalue)) as bibtex.ValueType[]) : [ this.text(node.name) ],
    })
  }

  private clean_entry(node: bibtex.Entry) {
    const shortjournals = []
    for (const field of node.fields) {
      if (fields.unabbrev.includes(field.name) && Array.isArray(field.value)) {
        const abbr = field.value.map(v => v.source).join('').toUpperCase()
        const journal = this.options.unabbreviate[abbr]
        if (journal) {
          shortjournals.push({ ...JSON.parse(JSON.stringify(field)), name: 'shortjournal' })
          field.value = [ this.text(journal) ]
        }
      }
    }
    node.fields = node.fields.concat(shortjournals).map(child => this.clean(child) as bibtex.Field)

    return node
  }

  private startCleaning(name) {
    name = name.toLowerCase()
    if (fields.title.includes(name)) {
      this.cleaning = { type: 'title', name }
    }
    else if (fields.creator.includes(name.replace(/s$/, ''))) {
      this.cleaning = { type: 'creator', name: name.replace(/s$/, '') }
    }
    else {
      this.cleaning = { type: 'other', name }
    }
  }

  private stripNoCase(node: Node, strip, preserve) {
    switch (node.kind) {
      case 'RegularCommand':
        // a bit cheaty to assume these to be nocased, but it's just more likely to be what people want
        if (['chsf', 'bibstring', 'cite'].includes(node.command)) strip = true
        node.arguments.required.map(arg => this.stripNoCase(arg, strip, preserve))
        break

      case 'Block':
      case 'InlineMath':
      case 'DisplayMath':
        if (strip && node.case === 'protect') {
          if (preserve) {
            node.case = 'preserve'
          }
          else {
            delete node.case
          }
        }
        node.value.map(v => this.stripNoCase(v, strip || node.case === 'protect', preserve))
        break

      case 'Field':
        if (Array.isArray(node.value)) node.value.forEach(v => this.stripNoCase(v, strip, preserve))
        break
    }
  }

  private isVerbatimField(name) {
    return !!this.options.verbatimFields.find(p => (typeof p === 'string') ? name === p : name.match(p))
  }
  private clean_field(node: bibtex.Field) {
    this.startCleaning(node.name)

    this.stripNoCase(node, !this.options.caseProtection || this.isVerbatimField(node.name), (this.options.sentenceCase as string[]).length === 0)

    if (Array.isArray(node.value)) this.condense(node)

    return node
  }

  private clean_script(node: bibtex.SubscriptCommand | bibtex.SuperscriptCommand) {
    let m, value, singlechar
    // recognize combined forms like \^\circ
    if (singlechar = latex2unicode[node.source]) return this.text(singlechar)
    if ((m = node.source.match(/^([\^_])([^{}]+)$/)) && ((singlechar = latex2unicode[`${m[1]}${m[2]}`]) || (singlechar = latex2unicode[`${m[1]}{${m[2]}}`]))) return this.text(singlechar)
    if ((m = node.source.match(/^([\^_])\{([^{}]+)\}$/)) && ((singlechar = latex2unicode[`${m[1]}${m[2]}`]) || (singlechar = latex2unicode[`${m[1]}{${m[2]}}`]))) return this.text(singlechar)

    const cmd = node.kind === 'SuperscriptCommand' ? '^' : '_'

    if (typeof node.value === 'string' && (singlechar = latex2unicode[`${cmd}${node.value}`] || latex2unicode[`${cmd}{${node.value}}`])) {
      return this.text(singlechar)
    }

    if (typeof node.value === 'string') {
      value = [ this.text(node.value) ]
    }
    else if (!Array.isArray(node.value)) {
      value = [ node.value ]
    }
    else {
      value = node.value
    }

    const mode = node.kind === 'SuperscriptCommand' ? 'sup' : 'sub'
    return this.clean({
      kind: 'Block',
      markup: { [mode]: true },
      value,
    })
  }

  private clean_environment(node: bibtex.Environment) {
    this.condense(node)
    return node
  }

  private needsProtection(word: string): boolean {
    return !word.match(preserveCase.hasUpper) && !!word.match(preserveCase.hasLower)
  }

  private clean_block(node: bibtex.Block | bibtex.Math) {
    this.condense(node)

    if (this.options.caseProtection !== 'strict' && this.cleaning?.type === 'title' && node.case === 'protect') {
      // test whether we can get away with skipping case protection because it contains all words that will be preserved anyway when converting back to Title Case
      let preserve = true
      for (const child of node.value) {
        if (child.kind === 'Text') {
          const value = child.value.trim()
          preserve = !value.match(preserveCase.isCaseSensitive) || !value.split(/\s+/).find(word => this.needsProtection(word))
        }
        else {
          preserve = false
        }
        if (!preserve) break
      }
      if (preserve) node.case = 'preserve'
    }

    if (node.kind === 'Block') {
      for (const [markup, on] of Object.entries(node.markup)) {
        if (!on) delete node.markup[markup]
      }
    }

    return node
  }

  private clean_diacritic(node: bibtex.DiacriticCommand): Node {
    const char = node.dotless ? `\\${node.character}` : node.character
    let unicode = latex2unicode[`\\${node.mark}{${char}}`]
      || latex2unicode[`\\${node.mark}${char}`]
      || latex2unicode[`{\\${node.mark} ${char}}`]
      || latex2unicode[`{\\${node.mark}${char}}`]
      || latex2unicode[`\\${node.mark} ${char}`]

    if (!unicode && !node.dotless && node.character.length === 1 && diacritics.tounicode[node.mark]) unicode = node.character + diacritics.tounicode[node.mark]
    if (!unicode && !this.in_preamble) return this.error(new TeXError(`Unhandled \\${node.mark}{${char}}`, node, this.chunk))
    return this.text(unicode)
  }

  private clean_symbol(node: bibtex.SymbolCommand) {
    if (node.command === '\\') return this.text('\n')
    return this.text(latex2unicode[`\\${node.command}`] || node.command)
  }

  private first_text_block(node: Node): bibtex.Block {
    if (!node) return null

    if (node.kind === 'Block') {
      for (const child of node.value) {
        switch (child.kind) {
          case 'Text':
            return child.value ? node : null

          case 'Block':
            // eslint-disable-next-line no-case-declarations
            const candidate = this.first_text_block(child)
            if (candidate) return candidate
            break

          default:
            return null
        }
      }
    }
    else {
      return null
    }
  }

  private clean_command(node: bibtex.RegularCommand): Node {
    let arg, unicode

    if (unicode = latex2unicode[node.source]) return this.text(unicode)

    switch (node.command) {
      case 'newcommand':
        if (node.arguments?.required.length === 2
          && node.arguments.required[0].kind === 'Block'
          && node.arguments.required[0].value.length === 1
          && node.arguments.required[0].value[0].kind === 'RegularCommand'
          && node.arguments.required[1].kind === 'Block'
        ) {
          this.newcommands[node.arguments.required[0].value[0].command] = node.arguments.required[1].value
          return this.text()
        }
        // console.log('newcommand?', JSON.stringify(node, null, 2))
        break

      case 'item':
        return { kind: 'Markup', value: '<li>', source: node.source }

      case 'frac':
        if (arg = this.argument(node, 2)) {
          if (arg[0].kind === 'Text' && arg[1].kind === 'Text' && (unicode = latex2unicode[`\\frac{${arg[0].value}}{${arg[1].value}}`])) return this.text(unicode)

          return this.clean({
            kind: 'Block',
            case: 'protect',
            markup: {},
            value: [
              { kind: 'Block', markup: { sup: true }, value: [ arg[0] ] },
              this.text('\u2044'),
              { kind: 'Block', markup: { sub: true }, value: [ arg[1] ] },
            ],
          })
        }
        break

      // ignore
      case 'vspace':
      case 'vphantom':
      case 'path':
      case 'aftergroup':
      case 'ignorespaces':
      case 'relax':
      case 'noopsort':
      case 'ifdefined':
      case 'DeclarePrefChars':
      case 'else':
      case 'fi':
      case 'makeatletter':
        return this.text()

      case 'ElsevierGlyph':
        if (arg = this.argument(node, 'Text')) {
          if (unicode = latex2unicode[`\\${node.command}{${arg}}`]) return this.text(unicode)
          return this.text(String.fromCharCode(parseInt(arg, 16)))
        }
        break

      case 'chsf':
        if (this.argument(node, 'none')) return this.text()
        if (arg = this.argument(node, 'Block')) return this.clean(arg as Node)
        break

      case 'enquote':
      case 'mkbibquote':
      case 'bibstring':
      case 'cite':
      case 'textsc':
      case 'textbf':
      case 'mkbibbold':
      case 'section':
      case 'subsection':
      case 'subsubsection':
      case 'subsubsubsection':
        if (arg = this.argument(node, 'Block')) return this.clean(arg as Node)
        break

      case 'textsuperscript':
      case 'sp':
        if ((arg = this.argument(node, 'Text')) && (unicode = latex2unicode[`^{${arg}}`])) return this.text(unicode)
        if (arg = this.argument(node, 'Block')) return this.clean(arg as Node)
        break

      case 'textsubscript':
      case 'sb':
        if ((arg = this.argument(node, 'Text')) && (unicode = latex2unicode[`_{${arg}}`])) return this.text(unicode)
        if (arg = this.argument(node, 'Block')) return this.clean(arg as Node)
        break

      case 'mkbibitalic':
      case 'mkbibemph':
      case 'textit':
      case 'emph':
        if (arg = this.argument(node, 'Block')) return this.clean(arg as Node)
        if (arg = this.argument(node, 'Text')) return this.clean({ kind: 'Block', markup: { italics: true }, value: [ this.text(arg) ] })
        break

      case 'bibcyr':
        if (this.argument(node, 'none')) return this.text()
        if (arg = this.argument(node, 'Block')) return this.clean(arg as Node)
        break

      case 'hspace':
      case 'mathrm':
      case 'textrm':
      case 'ocirc':
      case 'mbox':
        if (arg = this.argument(node, 'text')) {
          if (node.command === 'mbox' && !arg) return this.text('\u200b')
          unicode = latex2unicode[`\\${node.command}{${arg}}`]
          return this.text(unicode || (node.command === 'hspace' ? ' ' : arg))
        }
        else if (!node.arguments.required.length) {
          return (node.command === 'mbox') ? this.text('\u200b') : this.text()
        }
        else if (arg = this.argument(node, 'Block')) {
          return this.clean(arg as Node)
        }
        break

      case 'href':
        node.arguments.required = node.arguments.required.map(a => this.clean(a)) as bibtex.Argument[]
        return node

      case 'url':
        if (arg = this.argument(node, 'Text')) return this.text(arg)
        if (arg = this.argument(node, 'Block')) return this.clean(arg as Node)
        break

      case 'sl':
      case 'em':
      case 'it':
      case 'itshape':
      case 'bf':
      case 'bfseries':
      case 'sc':
      case 'scshape':
      case 'tt':
      case 'rm':
      case 'sf':
      case 'verb':
        // handled in the grammar
        return this.text()

      // wouldn't know what to do with these
      case 'left':
      case 'right':
        return this.text()

      case 'par':
      case '\\':
        return node

      case 'cyr':
        if (this.argument(node, 'none')) return this.text()
        break

      case 'polhk':
        if (unicode = this.argument(node, 'text')) {
          if (unicode.length === 1) return this.text(`${unicode}\u0328`)
        }
        if (this.argument(node, 'none')) return this.text('\u0328')
        break

      default:
        if (node.kind === 'RegularCommand' && this.newcommands[node.command]) {
          return this.clean({
            kind: 'Block',
            markup: {},
            value: (JSON.parse(JSON.stringify(this.newcommands[node.command])) as bibtex.ValueType[]),
          })
        }

        if (diacritics.tounicode[node.command]) {
          node.arguments.required = this.clean(node.arguments.required) as bibtex.Argument[]

          let block: bibtex.Block
          if (node.arguments.required.length === 1 && node.arguments.required[0].kind === 'Text') {
            // no idea why I can't just straight return this but typescript just won't shut up
            block = {
              kind: 'Block',
              markup: {},
              value: [ {
                kind: 'DiacriticCommand',
                mark: node.command,
                character: (node.arguments.required[0]).value,
                dotless: false,
                loc: node.arguments.required[0].loc,
                source: node.arguments.required[0].source,
              } ],
            }
            return this.clean(block)

          }
          else if (block = this.first_text_block(node.arguments.required[0])) {
            let fixed = false
            block.value = block.value.reduce((value: bibtex.ValueType[], child: bibtex.ValueType) => {
              if (!fixed && child.kind === 'Text') {
                fixed = true

                value.push({ kind: 'DiacriticCommand', mark: node.command, character: child.value[0] })
                value.push({ ...child, value: child.value.substring(1) })
              }
              else {
                value.push(child)
              }

              return value
            }, [])

            return this.clean({
              kind: 'Block',
              markup: {},
              value: node.arguments.required,
            })

          }
          else {
            // overline without arguments doesn't seem to render in LaTeX
            if (node.command === 'overline') return this.text(' ')

            return this.clean({
              kind: 'Block',
              markup: {},
              value: ([ this.text(` ${diacritics.tounicode[node.command]}`) ] as bibtex.ValueType[]).concat(node.arguments.required),
            })
          }
        }

        if (unicode = latex2unicode[node.source] || latex2unicode[`${node.source}{}`]) return this.text(unicode)
        if ((unicode = latex2unicode[`\\${node.command}`] || latex2unicode[`\\${node.command}{}`]) && this.argument(node, 'none')) return this.text(unicode)
        if ((arg = this.argument(node, 'Text')) && (unicode = latex2unicode[`\\${node.command}{${arg}}`])) return this.text(unicode)
        break
    }

    if (this.in_preamble) return this.text(node.source)

    if (this.options.unknownCommandHandler) {
      return this.options.unknownCommandHandler.call(this, node) as Node
    }
    else if (this.options.unknownCommandHandler === false) {
      return this.text()
    }
    else {
      return this.error(new TeXError(`Unhandled command: ${node.command}${this.show(node)}`, node, this.chunk))
    }
  }

  private preserveCase(word) {
    // word = word.replace(new RegExp(`"[${this.markup.enquote.open}${this.markup.enquote.close}:()]`, 'g'), '')

    if (!word.trim()) return false
    if (!word.match(preserveCase.hasAlphaNum)) return true

    word = word.replace(/[/’'”:()]/g, '')

    if (word === 'I') return true
    if (word.length === 1) return false
    if (word.replace(preserveCase.notCaseSensitive) === '') return false
    // word = word.replace(preserveCase.notAlphaNum, '')

    // simple cap at start of field
    if (word.match(preserveCase.leadingCap) && this.field?.text?.length === 0) return false

    if (word.match(preserveCase.allCaps)) return true
    if (word.length > 1 && word.match(preserveCase.joined)) return false
    if (word.match(preserveCase.hasUpper)) return true
    if (word.match(preserveCase.isNumber)) return true
    return false
  }

  // private convert(node: Node[]): Node[]
  // private convert(node: Node): Node
  private convert(node: Node | Node[]): Node | Node[] {
    if (Array.isArray(node)) return node.map((child: Node) => this.convert(child)) as Node[]

    if (this.options.raw && this.field) node = this.text(node.source)

    switch (node.kind) {
      case 'Markup':
        if (this.field) this.field.text += node.value
        break

      case 'BracedComment':
      case 'LineComment':
        this.comments.push(node.value)
        break

      case 'Entry':
        this.convert_entry(node)
        break

      case 'Number':
        this.convert_number(node)
        break

      case 'Text':
        this.convert_text(node)
        break

      case 'Block':
      case 'InlineMath':
      case 'DisplayMath':
        // eslint-disable-next-line no-case-declarations
        const start = this.field ? this.field.text.length : null
        // eslint-disable-next-line no-case-declarations
        const preserve: false | TextRange[] = typeof start === 'number' && this.field.preserveRanges

        this.convert_block(node)

        if (preserve && (node.case || node.kind.endsWith('Math'))) this.preserve(start, this.field.text.length) // , `convert-block: case=${node.case}, math=${node.kind.endsWith('Math')}`)
        break

      case 'Environment':
        this.convert_environment(node)
        break

      case 'PreambleExpression':
        this.preamble.push(node.value.map(preamble => preamble.source).join('\n\n'))
        break

      case 'StringDeclaration':
        break

      default:
        if (node.kind === 'RegularCommand' && node.command === 'href') {
          this.convert_href(node)
        }
        else if (node.kind === 'RegularCommand' && node.command === 'par') {
          this.field.text += this.field.html ? '<p>\n' : ' '
        }
        else if (node.kind === 'RegularCommand' && node.command === '\\') {
          this.field.text += this.field.html ? '<b>\n' : ' '
        }
        else {
          return this.error(new ParserError(`no converter for ${node.kind}: ${this.show(node)}`, node))
        }
    }
  }

  private splitOnce(s :string, sep: string, fromEnd = false): [string, string] {
    const split: number = fromEnd ? s.lastIndexOf(sep) : s.indexOf(sep)
    return (split < 0) ? [s, ''] : [ s.substr(0, split), s.substr(split + 1) ]
  }
  private parseName(name) {
    let parsed: Name = null

    const parts = name.split(marker.comma)

    if (parts.length && !parts.find(p => !p.match(/^[a-z]+(-i)?=/i))) { // extended name format

      for (const part of parts) {
        parsed = parsed || {}

        const [ attr, value ] = this.splitOnce(part.replace(marker.re.space, ''), '=').map((v: string) => v.trim())

        if (!value) {
          parsed = null
          break
        }

        switch (attr.toLowerCase()) {
          case 'family':
            parsed.lastName = value
            break

          case 'given-i':
            parsed.initial = value
            break

          case 'given':
            parsed.firstName = value
            break

          case 'prefix':
            parsed.prefix = value
            break

          case 'suffix':
            parsed.suffix = value
            break

          case 'useprefix':
            parsed.useprefix = value.toLowerCase() === 'true'
            break

          case 'juniorcomma':
            parsed.useprefix = value.toLowerCase() === 'true'
            break

          default:
            parsed[attr.toLowerCase()] = value
            break

        }
      }
    }

    const prefix = /(.+?)\s+(vere|von|van den|van der|van|de|del|della|der|di|da|pietro|vanden|du|st.|st|la|lo|ter|bin|ibn|te|ten|op|ben|al)\s+(.+)/
    let m
    switch (parsed ? 0 : parts.length) {
      case 0:
        // already parsed
        break

      case 1: // name without commas
        // literal
        if (marker.re.literalName.test(parts[0])) {
          parsed = { literal: parts[0] }
        }
        else if (m = parts[0].replace(marker.re.space, ' ').match(prefix)) { // split on prefix
          parsed = {
            firstName: m[1],
            prefix: m[2],
            lastName: m[3], // eslint-disable-line no-magic-numbers
          }
        }
        else {
          // top-level "firstname lastname"
          const [ firstName, lastName ] = this.splitOnce(parts[0], marker.space, true)
          if (lastName) {
            parsed = { firstName, lastName }
          }
          else {
            parsed = { lastName: firstName }
          }
        }
        break

      case 2: // lastname, firstname
        parsed = {
          lastName: parts[0],
          firstName: parts[1],
        }
        break

      default: // lastname, suffix, firstname
        parsed = {
          lastName: parts[0],
          suffix: parts[1],
          firstName: parts.slice(2).join(marker.comma),
        }
    }

    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') continue
      parsed[k] = marker.clean(v).trim()
    }

    return parsed
  }

  private convert_entry(node: bibtex.Entry) {
    this.entry = {
      key: node.id,
      type: node.type,
      fields: {},
      creators: {},
    }
    this.entries.push(this.entry)

    // order these first for language-dependent sentence casing
    const order = ['langid', 'hyphenation', 'language']
    node.fields.sort((a, b) => {
      const ia = order.indexOf(a.name)
      const ib = order.indexOf(b.name)
      if (ia === -1 && ib === -1) return a.name.localeCompare(b.name) // doesn't matter really
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

    let sentenceCase = !!(this.options.sentenceCase as string[]).length // if sentenceCase is empty, no sentence casing
    for (const field of node.fields) {
      if (field.kind !== 'Field') return this.error(new ParserError(`Expected Field, got ${field.kind}`, node))

      this.startCleaning(field.name)

      /*
      if (this.options.raw && this.fieldType !== 'creator') {
        this.entry.fields[field.name] = [ field.value.map(v => v.source).join('') ]
        continue
      }
      */

      this.field = {
        name: field.name,
        text: '',
        level: 0,
        words: {
          upper: 0,
          lower: 0,
          other: 0,
        },
        preserveRanges: (sentenceCase && fields.title.includes(field.name)) ? [] : null,
        html: this.options.htmlFields.includes(field.name),
      }

      this.entry.fields[this.field.name] = this.entry.fields[this.field.name] || []

      // special case for 'title = 2020'
      if ((field.value as any).kind === 'Number') {
        this.entry.fields[this.field.name].push((field.value as any).value as string)
        this.field = null
        continue
      }

      this.convert(field.value)
      this.field.text = this.field.text.trim()
      this.field.text = this.field.text.replace(/<\/([a-z])><\1>/g, '')
      this.field.text = this.field.text.replace(/<([a-z])>(\s*)<\/\1>/g, '$1')
      if (!this.field.text) continue

      // disable sentenceCasing if not an english
      switch (this.field.name) {
        case 'langid':
        case 'hyphenation':
          sentenceCase = sentenceCase && (this.options.sentenceCase as string[]).includes(this.field.text.toLowerCase())
          break

        case 'language':
          sentenceCase = sentenceCase && !!(this.field.text.toLowerCase().trim().split(/\s*,\s*/).find(lang => (this.options.sentenceCase as string[]).includes(lang)))
          break
      }

      // "groups" is a jabref 3.8+ monstrosity
      if (this.field.name.match(/^(keywords?|groups)$/)) {
        for (let text of this.field.text.split(marker.comma)) {
          text = text.trim()
          if (text) this.entry.fields[this.field.name].push(text)
        }
      }
      else if (this.cleaning.type === 'creator') {
        if (!this.entry.creators[this.field.name]) this.entry.creators[this.field.name] = []

        // {M. Halle, J. Bresnan, and G. Miller}
        if (this.field.text.includes(`${marker.comma}${marker.and}`)) { //
          this.field.text = this.field.text.replace(new RegExp(`${marker.comma}${marker.and}`, 'g'), marker.and).replace(new RegExp(marker.comma), marker.and)
        }

        for (const creator of this.field.text.split(marker.and)) {
          this.entry.fields[this.field.name].push(marker.clean(creator))
          this.entry.creators[this.field.name].push(this.parseName(creator))
        }
      }
      else if (fields.unabbrev.includes(field.name)) { // doesn't get sentence casing anyhow TODO: booktitle does!
        this.entry.fields[this.field.name].push((this.options.unabbreviate[this.field.text] || this.field.text).normalize('NFC'))
      }
      else {
        if (this.field.preserveRanges) {
          if (this.options.guessAlreadySentenceCased && Math.max(this.field.words.upper, this.field.words.lower) > (this.field.words.other + Math.min(this.field.words.upper, this.field.words.lower))) {
            this.preserve(null, null) // , 'mostly sentence cased already')
          }
          else {
            const txt = this.field.text.replace(preserveCase.markup, markup => marker.markup.repeat(markup.length))

            let match
            preserveCase.sentenceStart.lastIndex = 0
            while ((match = preserveCase.sentenceStart.exec(txt))) {
              // exclude stuff like "U.S. Taxes"
              // eslint doesn't grok these are numbers
              // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
              if (match.index > 2 && txt.substr(0, match.index + 1).match(preserveCase.acronym)) continue

              // eslint doesn't grok these are numbers
              // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
              this.preserve(match.index, match.index + match[0].length)
            }

            preserveCase.quoted.lastIndex = 0
            while ((match = preserveCase.quoted.exec(this.field.text) as RegExpMatchArray)) {
              // eslint doesn't grok these are numbers
              // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
              this.preserve(match.index, match.index + match[0].length)
            }
          }
        }

        this.entry.fields[this.field.name].push(this.convertToSentenceCase(this.field.text).normalize('NFC'))
      }

    }

    this.field = null
  }

  private convertToSentenceCase(text: string): string {
    if (!this.field.preserveRanges) return text

    const sentenceCased = restore(sentenceCaser.convert(text, true), text, this.field.preserveRanges)

    if (text !== sentenceCased) this.entry.sentenceCased = true

    return sentenceCased
  }

  private convert_number(node: bibtex.NumberValue) {
    this.field.text += `${node.value}`
  }

  private convert_text(node: bibtex.TextValue) {
    if (node.mode === 'verbatim') {
      this.field.text += node.value.trim()
      return
    }

    // heuristic to detect pre-sentencecased text
    for (const word of node.value.split(/\b/)) {
      if (word.match(preserveCase.allLower)) {
        this.field.words.lower++
      }
      else if (word.match(preserveCase.allCaps)) {
        this.field.words.upper++
      }
      else if (word.match(preserveCase.hasAlpha)) {
        this.field.words.other++
      }
    }

    if (this.field.level === 0 && this.cleaning.type === 'creator') {
      this.field.text += node.value.replace(/\s+and\s+/ig, marker.and).replace(/\s*,\s*/g, marker.comma).replace(/\s+/g, marker.space)
      return
    }

    if (this.field.level === 0 && this.field.name.match(/^(keywords?|groups)$/)) {
      this.field.text += node.value.replace(/\s*[;,]\s*/g, marker.comma)
      return
    }

    if (this.field.html) {
      this.field.text += node.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    else if (this.field.preserveRanges) {
      const words = node.value.split(/(\s+)/)
      for (const word of words) {
        const start = this.field.text.length
        this.field.text += word
        if (this.preserveCase(word)) this.preserve(start, this.field.text.length) // , `word: ${JSON.stringify(word)}`)
      }
    }
    else {
      this.field.text += node.value
    }
  }

  private convert_environment(node: bibtex.Environment) {
    const [ open, close ] = {
      enumerate: [ '<ol>', '</ol>' ],
      itemize: [ '<ul>', '</ul>' ],
      quotation: [ '<blockquote>', '</blockquote>' ],
    }[node.env] || [ '', '' ]

    if (!open) this.error(new TeXError(`Unhandled \\${node.env}{...}`, node, this.chunk))

    this.field.text += open
    this.convert_block({...node, kind: 'Block', markup: {} })
    this.field.text += close
  }

  private convert_href(node: bibtex.RegularCommand): void {
    this.field.text += '<a href="'
    this.convert(node.arguments.required[0])
    this.field.text += '">'
    this.convert(node.arguments.required[1])
    this.field.text += '</a>'
  }

  private convert_block(node: bibtex.Block | bibtex.Math): void {
    const start = this.field.text.length

    let prefix = ''
    let postfix = ''

    if (this.options.caseProtection !== 'strict' && this.cleaning.type === 'other') delete node.case
    if (this.cleaning.type === 'creator' && node.case === 'protect') {
      prefix += marker.literal
      postfix = marker.literal + postfix
      delete node.case
    }

    if (node.case === 'protect') {
      prefix += this.options.markup.caseProtect.open
      postfix = this.options.markup.caseProtect.close + postfix
    }

    if (node.kind === 'Block') {
      for (const markup of Object.keys(node.markup)) {
        if (!this.options.markup[markup]) {
          this.error(new ParserError(`markup: ${markup}`, node))
          return
        }

        prefix += this.options.markup[markup].open
        postfix = `${this.options.markup[markup].close}${postfix}`
      }
    }

    const end = {
      withoutPrefix: this.field.text.length,
      withPrefix: this.field.text.length + prefix.length,
    }
    this.field.text += prefix

    this.field.level++
    this.convert(node.value)
    this.field.level--

    const added = this.field.text.substring(end.withPrefix)
    const added_text = added.replace(/<\/?[^>]+>/g, '')
    const needsProtection = added_text && (
      (this.options.caseProtection === 'strict' && added_text.match(preserveCase.isCaseSensitive))
      ||
      (this.options.caseProtection === 'as-needed' && added_text.split(/\s+/).find(word => this.needsProtection(word)))
    )

    if (!added) { // nothing was added, so remove prefix
      this.field.text = this.field.text.substring(0, end.withoutPrefix)
    }
    else if (this.field.preserveRanges && prefix === this.options.markup.caseProtect.open && !needsProtection) {
      // something was added that didn't actually need case protection
      this.field.text = this.field.text.substring(0, end.withoutPrefix) + added
      this.field.preserveRanges = this.field.preserveRanges.filter(range => range.start < end.withoutPrefix)
    }
    else {
      this.field.text += postfix
    }

    this.field.text = this.field.text.replace(/<(sup|sub)>([^<>]+)<\/\1>$/i, (m, mode, chars) => {
      const cmd = mode === 'sup' ? '^' : '_'
      let script = ''
      for (const char of chars) {
        const unicode = latex2unicode[`${cmd}${char}`] || latex2unicode[`${cmd}{${char}}`]
        script += unicode ? unicode : `<${mode}>${char}</${mode}>`
      }
      script = script.replace(new RegExp(`</${mode}><${mode}>`, 'g'), '')
      return script.length < m.length ? script : m
    })

    if (node.case && this.field.preserveRanges) this.preserve(start, this.field.text.length) // , 'in convert-block ' + node.source || '<source>')
  }
}

/**
 * parse bibtex. This will try to convert TeX commands into unicode equivalents, and apply `@string` expansion
 */
export function parse(input: string, options: ParserOptions = {}): Bibliography {
  const parser = new Parser(options)
  return parser.parse(input)
}

export function ast(input: string, options: ParserOptions = {}, clean = true): Node[] {
  const parser = new Parser(options)
  return parser.ast(input, clean)
}

export const promises = {
  async parse(input: string, options: ParserOptions = {}): Promise<Bibliography> { // eslint-disable-line prefer-arrow/prefer-arrow-functions
    const parser = new Parser(options)
    return await parser.parseAsync(input)
  },
}

export { chunker }
export { jabref }
