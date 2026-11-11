import { execFileSync } from 'node:child_process'
import { copyFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const crate = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(crate, '..')
const output = path.join(root, 'dist/unicode2latex')

switch (process.argv[2]) {
	case 'tables':
		execFileSync('cargo', ['run', '--bin', 'rebuild'], { cwd: crate, stdio: 'inherit' })
		break
	case 'wasm':
		await buildWasm()
		break
	default:
		throw new Error('Expected build phase "tables" or "wasm"')
}

/** Build the WASM bindings, then compile the caller-controlled JavaScript adapter and its declarations. */
async function buildWasm() {
	execFileSync('wasm-pack', ['build', '--target', 'web', '--out-dir', output, '--out-name', 'unicode2latex'], {
		cwd: crate,
		stdio: 'inherit',
	})
	await rm(path.join(output, '.gitignore'), { force: true })

	const bindingTypes = path.join(crate, 'unicode2latex.d.ts')
	await copyFile(path.join(output, 'unicode2latex.d.ts'), bindingTypes)
	try {
		execFileSync(path.join(root, 'node_modules/.bin/tsc'), [
			'--target', 'ES2022',
			'--module', 'NodeNext',
			'--moduleResolution', 'NodeNext',
			'--rootDir', root,
			'--outDir', path.join(root, 'dist'),
			'--resolveJsonModule',
			'--declaration',
			'--skipLibCheck',
			'--strictNullChecks',
			path.join(crate, 'index.ts'),
		], { stdio: 'inherit' })
	}
	finally {
		await rm(bindingTypes, { force: true })
	}
}