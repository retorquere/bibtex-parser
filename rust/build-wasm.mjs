import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rust = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.join(rust, 'pkg')

execFileSync('wasm-pack', [ 'build', rust, '--target', 'web', '--out-dir', 'pkg', '--out-name', 'bibtex_parser' ], { stdio: 'inherit' })
execFileSync('wasm-pack', [ 'build', '.', '--target', 'web', '--out-dir', path.join(rust, 'pkg/tokenizer'), '--out-name', 'bibtex_tokenizer' ], { cwd: path.join(rust, 'tokenizer-only'), stdio: 'inherit' })
const tokenizerSource = path.join(pkg, 'tokenizer/index.ts')
copyFileSync(path.join(rust, 'tokenizer-only/index.ts'), tokenizerSource)
try {
  execFileSync(path.join(rust, '../node_modules/.bin/tsc'), [ '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--declaration', '--skipLibCheck', '--strictNullChecks', tokenizerSource ], { stdio: 'inherit' })
}
finally {
  unlinkSync(tokenizerSource)
}
rmSync(path.join(pkg, 'jabref.js'), { force: true })
rmSync(path.join(pkg, 'jabref.d.ts'), { force: true })

const source = path.join(pkg, 'index.ts')
copyFileSync(path.join(rust, 'index.ts'), source)
copyFileSync(path.join(rust, 'data/english.json'), path.join(pkg, 'english.json'))
try {
  execFileSync(path.join(rust, '../node_modules/.bin/tsc'), [ '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--resolveJsonModule', '--declaration', '--skipLibCheck', '--strictNullChecks', source ], { stdio: 'inherit' })
}
finally {
  unlinkSync(source)
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
  'english.json',
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
rmSync(path.join(dist, 'jabref.js'), { force: true })
rmSync(path.join(dist, 'jabref.d.ts'), { force: true })
for (const file of manifest.files) {
  cpSync(path.join(pkg, file), path.join(dist, file), { recursive: true })
}

const tokenizerDist = path.resolve(rust, '../dist/tokenizer')
rmSync(tokenizerDist, { recursive: true, force: true })
mkdirSync(tokenizerDist, { recursive: true })
for (const file of ['index.js', 'index.d.ts', 'bibtex_tokenizer.js', 'bibtex_tokenizer.d.ts', 'bibtex_tokenizer_bg.wasm', 'bibtex_tokenizer_bg.wasm.d.ts']) {
  copyFileSync(path.join(pkg, 'tokenizer', file), path.join(tokenizerDist, file))
}
