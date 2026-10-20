import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rust = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.join(rust, 'pkg')

execFileSync('node', [path.join(rust, 'unicode-tables.mjs')], { stdio: 'inherit' })
execFileSync('wasm-pack', [
  'build',
  rust,
  '--target',
  'web',
  '--out-dir',
  'pkg',
  '--out-name',
  'bibtex_parser',
], { stdio: 'inherit' })

const source = path.join(pkg, 'index.ts')
copyFileSync(path.join(rust, 'index.ts'), source)
const jabref = path.join(pkg, 'jabref.ts')
copyFileSync(path.join(rust, '../jabref.ts'), jabref)
try {
  execFileSync(path.join(rust, '../node_modules/.bin/tsc'), [
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--declaration',
    '--skipLibCheck',
    '--strictNullChecks',
    source,
  ], { stdio: 'inherit' })
}
finally {
  unlinkSync(source)
  unlinkSync(jabref)
}

const manifestPath = path.join(pkg, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.main = 'index.js'
manifest.module = 'index.js'
manifest.types = 'index.d.ts'
manifest.files = [
  'bibtex_parser_bg.wasm',
  'bibtex_parser.js',
  'bibtex_parser.d.ts',
  'bibtex_parser_bg.wasm.d.ts',
  'index.js',
  'index.d.ts',
  'jabref.js',
  'jabref.d.ts',
  'snippets',
]
manifest.exports = {
  '.': {
    types: './index.d.ts',
    import: './index.js',
    default: './index.js',
  },
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const dist = path.resolve(rust, '../dist/wasm')
mkdirSync(dist, { recursive: true })
for (const file of manifest.files) {
  cpSync(path.join(pkg, file), path.join(dist, file), { recursive: true })
}
