import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const crate = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(crate, '..')

execFileSync('cargo', ['run', '--bin', 'rebuild'], { cwd: crate, stdio: 'inherit' })

const source = path.join(root, 'tables/unicode2latex')
const output = path.join(root, 'dist/unicode2latex/tables')
mkdirSync(output, { recursive: true })
for (const filename of readdirSync(source).filter(filename => filename.endsWith('.json'))) {
  cpSync(path.join(source, filename), path.join(output, filename))
}