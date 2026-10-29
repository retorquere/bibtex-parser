import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { combining, latex2unicode } from 'unicode2latex'

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
const packed = []

/** Append an unsigned LEB128 value to the packed table. */
function writeLength(value) {
  while (value >= 0x80) {
    packed.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  packed.push(value)
}

/** Encode null as zero and strings as their UTF-8 byte length plus one. */
function writeField(value) {
  if (value === null) {
    writeLength(0)
    return
  }
  const bytes = Buffer.from(value)
  writeLength(bytes.length + 1)
  for (const byte of bytes) packed.push(byte)
}

writeLength(rows.length)
for (const [key, value] of rows) {
  writeField(key)
  writeField(value.text)
  writeField(value.math)
  writeField(value.combining)
}

const rust = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(rust, 'src')
writeFileSync(path.join(source, 'unicode_tables.rs'), 'const UNICODE_TABLES_COMPRESSED: &[u8] = include_bytes!("unicode_tables.bin");\n')
writeFileSync(path.join(source, 'unicode_tables.bin'), deflateRawSync(Buffer.from(packed), { level: 9 }))