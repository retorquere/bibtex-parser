import { execFileSync } from 'node:child_process'
import { copyFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const crate = fileURLToPath(new URL('../', import.meta.url))
const output = path.resolve(crate, '../dist/unicode2latex')

// Compile only the library: SQLite and CSV are host-side table-generation dependencies.
execFileSync('wasm-pack', ['build', '--target', 'web', '--out-dir', path.join(output, 'raw'), '--out-name', 'unicode2latex'], {
  cwd: crate,
  stdio: 'inherit',
})

// Keep generated ESM bindings in the published tarball, without wasm-pack's ignore file.
await writeFile(path.join(output, 'raw/package.json'), '{"type":"module"}\n')
await rm(path.join(output, 'raw/.gitignore'), { force: true })
await copyFile(new URL('./index.js', import.meta.url), path.join(output, 'index.js'))
await copyFile(new URL('../index.d.ts', import.meta.url), path.join(output, 'index.d.ts'))