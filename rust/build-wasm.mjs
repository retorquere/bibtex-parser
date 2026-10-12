import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rust = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.join(rust, 'pkg')

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

copyFileSync(path.join(rust, 'wasm.js'), path.join(pkg, 'index.js'))
copyFileSync(path.join(rust, 'wasm.d.ts'), path.join(pkg, 'index.d.ts'))

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
  copyFileSync(path.join(pkg, file), path.join(dist, file))
}