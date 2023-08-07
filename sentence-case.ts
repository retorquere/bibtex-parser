/* eslint-disable @typescript-eslint/no-unsafe-argument */
import categories = require('xregexp/tools/output/categories')

const cat = name => categories.find(c => c.name === name).bmp as string
const L = cat('L')
const Lu = cat('Lu')
const Ll = cat('Ll')
const N = cat('N')
const No = cat('No')
const Pc = cat('Pc')

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

export function toSentenceCase(sentence: string, preserveQuoted=false): string {
  const preserve: { pos: number, text: string, description?: string }[] = []

  sentence.replace(/([.?!][\s]+)(<[^>]+>)?([A-Z])/g, (match: string, end: string, markup: string, char: string, i: number) => {
    if (!sentence.substring(0, i + 1).match(re.acronym)) {
      preserve.push({ pos: i + end.length + (markup?.length || 0), text: char, description: 'sub-sentence-start' })
    }
    return ''
  })

  sentence.replace(/^(<[^>]+>)?([A-Z])/, (match: string, markup: string, char: string) => {
    preserve.push({ pos: (markup?.length || 0), text: char, description: 'sentence-start' })
    return ''
  })

  sentence.replace(/<span class="nocase">.*?<\/span>|<nc>.*?<\/nc>/gi, (text: string, pos: number) => {
    preserve.push({ pos, text, description: 'nocase' })
    return ''
  })

  let masked = sentence.replace(/<[^>]+>/g, (text: string, pos: number) => {
    preserve.push({ pos, text, description: 'markup' })
    return '\uFFFD'.repeat(text.length)
  })

  // last because we're potentially modifying the original
  for (const q of [/(“)(.*?)”/g, /(‘)(.*?)’/g, /(["])(.*?)\1/g]) {
    sentence.replace(q, (text: string, quote: string, quoted: string, pos: number) => {
      preserve.push({
        pos: pos + (preserveQuoted ? 0 : quote.length),
        text: preserveQuoted ? text : toSentenceCase(quoted, preserveQuoted),
        description: `quoted with ${q}`,
      })
      return ''
    })
  }

  masked = masked
    .replace(/[;:]\uFFFD*\s+\uFFFD*A\s/g, match => match.toLowerCase())
    .replace(/[–—]\uFFFD*\s*\uFFFD*A\s/g, match => match.toLowerCase())
    .replace(re.words, word => lowercase(word))

  sentence = masked
  for (const { pos, text } of preserve) {
    sentence = sentence.substring(0, pos) + text + sentence.substring(pos + text.length)
  }
  return sentence
}
