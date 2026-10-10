import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { combining, latex2unicode } from 'unicode2latex'

/** Encode table strings as Rust literals, escaping syntax and invisible control/format code points. */
function rustString(value) {
  let result = '"'
  for (const character of value) {
    switch (character) {
      case '\\': result += '\\\\'; break
      case '"': result += '\\"'; break
      case '\n': result += '\\n'; break
      case '\r': result += '\\r'; break
      case '\t': result += '\\t'; break
      case '\0': result += '\\0'; break
      default: {
        const codePoint = character.codePointAt(0)
        // Keep invisible format characters explicit so generated Rust stays reviewable and lintable.
        result += codePoint < 0x20 || codePoint === 0x7f || /\p{Cf}/u.test(character)
          ? `\\u{${codePoint.toString(16)}}`
          : character
      }
    }
  }
  return `${result}"`
}

const mappings = new Map()
// Normalize scalar entries to both modes, then merge accent macros into the same lookup structure.
for (const [key, value] of Object.entries(latex2unicode)) {
  mappings.set(key, typeof value === 'string'
    ? { text: value, math: value, combining: null }
    : { text: value.text ?? null, math: value.math ?? null, combining: null })
}
for (const [name, mark] of Object.entries(combining.tounicode)) {
  const key = `\\${name}`
  const mapping = mappings.get(key) ?? { text: null, math: null, combining: null }
  mapping.combining = mark
  mappings.set(key, mapping)
}

const rows = [...mappings.entries()]
  // Rust binary_search requires bytewise key ordering, not locale collation.
  .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  .map(([key, value]) => [
    `    UnicodeMapping { key: ${rustString(key)},`,
    ` text: ${value.text === null ? 'None' : `Some(${rustString(value.text)})`},`,
    ` math: ${value.math === null ? 'None' : `Some(${rustString(value.math)})`},`,
    ` combining: ${value.combining === null ? 'None' : `Some(${rustString(value.combining)})`} },`,
  ].join(''))

const source = [
  '#[allow(dead_code)]',
  'const UNICODE_MAPPINGS: &[UnicodeMapping] = &[',
  ...rows,
  '];',
  '',
].join('\n')

// Cargo sets OUT_DIR for build scripts and their child processes.
writeFileSync(path.join(process.env.OUT_DIR, 'unicode_tables.rs'), source)