/* eslint-disable @typescript-eslint/no-unsafe-argument */
import categories = require('xregexp/tools/output/categories')

const cat = name => categories.find(c => c.name === name).bmp as string
const L = cat('L')
const Lu = cat('Lu')
const Ll = cat('Ll')
const N = cat('N')
const No = cat('No')
const Pc = cat('Pc')

export type TextRange = { start: number, end: number, description?: string }

export function restore(text: string, orig: string, preserve: TextRange[]): string {
  for (const { start, end } of preserve) {
    text = text.substring(0, start) + orig.substring(start, end) + text.substring(end)
  }
  return text
}

const re = {
  acronym: new RegExp(`([${Lu}][.])+$`),
  innerCaps: new RegExp(`.[${Lu}]`),
  ident: new RegExp(`^[$p{L}]+[${N}${No}][${L}${N}${No}]*$`),
  allCaps: new RegExp(`^[${Lu}${N}${No}]+$`),
  skipWords: /^(but|or|yet|so|for|and|nor|a|an|the|at|by|from|in|into|of|on|to|with|updown|as)$/i,
  // chemElements: /^(H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pb|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn|Fr|Ra|Ac|Rf|Db|Sg|Bh|Hs|Mt|Ds|Rg|Cn|Nh|Fl|Mc|Lv|Ts|Og|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Ac|Th|Pa|U|Np|Pu|Am|Cm|Bk|Cf|Es|Fm|Md|No|Lr)$/,
  words: new RegExp(`([\uFFFD${L}${N}${No}]+([\uFFFD${Pc}${L}${N}${No}]*))|(\\s([\uFFFD${Lu}]+[.]){2,})?`, 'g'), // compound words and acronyms
  titleCase: new RegExp(`^[${Lu}][${Ll}${N}${No}]+$`),

  // private aint = XRegExp("^\\p{L}n't(?=$|[\\P{L}])") // isn't
  // private word = XRegExp('^\\p{L}+([-.]\\p{L}+)*') // also match gallium-nitride as one word
  // private and = XRegExp('^\\p{Lu}&\\p{Lu}(?=$|[\\P{L}])') // Q&A
}

function lowercase(word: string): string {
  if (!word) return word

  const unmasked = word.replace(/\uFFFD/g, '')

  if (unmasked.match(re.skipWords)) return word.toLowerCase()

  if (unmasked.match(re.titleCase)) return word.toLowerCase()

  // if (unmasked.match(re.chemElements)) return word

  if (unmasked.length === 1) return unmasked === 'A' ? word.toLowerCase() : word

  if (unmasked.match(re.innerCaps)) return word

  if (unmasked.match(re.ident) || unmasked.match(re.allCaps)) return word

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

  text.replace(/([.?!][\s]+)(<[^>]+>)?([A-Z])/g, (match: string, end: string, markup: string, char: string, i: number) => {
    if (!text.substring(0, i + 1).match(re.acronym)) {
      preserve.push({ start: i + end.length + (markup?.length || 0), end: i + end.length + (markup?.length || 0) + char.length, description: 'sub-sentence-start' })
    }
    return ''
  })

  text.replace(/^(<[^>]+>)?([A-Z])/, (match: string, markup: string, char: string) => {
    preserve.push({ start: (markup?.length || 0), end: (markup?.length || 0) + char.length, description: 'sentence-start' })
    return ''
  })

  text.replace(/<span class="nocase">.*?<\/span>|<nc>.*?<\/nc>/gi, (match: string, i: number) => {
    preserve.push({ start: i, end: i + match.length, description: 'nocase' })
    return ''
  })

  let masked = text.replace(/<[^>]+>/g, (match: string, i: number) => {
    preserve.push({ start: i, end: i + match.length, description: 'markup' })
    return '\uFFFD'.repeat(match.length)
  })

  masked = masked
    .replace(/[;:]\uFFFD*\s+\uFFFD*A\s/g, match => match.toLowerCase())
    .replace(/[–—]\uFFFD*\s*\uFFFD*A\s/g, match => match.toLowerCase())
    .replace(re.words, word => lowercase(word))
  return restore(masked, text, preserve)
}
