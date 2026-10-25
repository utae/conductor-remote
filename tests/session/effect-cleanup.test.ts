import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const WEB_SRC = path.join(import.meta.dirname, '../../web/src')

function sources(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) return sources(full)
		return /\.tsx?$/.test(entry.name) ? [full] : []
	})
}

// React runs whatever an effect returns as its cleanup. `useEffect(() => setActive(0), [q])` returns the setter's
// `undefined`, which is harmless, but `useEffect(() => el?.scrollIntoView(), …)` and any call that returns a value do
// not: the next commit throws "x is not a function", and with no error boundary the whole app goes black. Static
// rendering never runs effects, so this is the only place a typed-character crash like that is caught.
test('no effect returns an expression from an arrow shorthand', () => {
	const offenders = sources(WEB_SRC).flatMap(file =>
		fs
			.readFileSync(file, 'utf8')
			.split(/(?=use(?:Layout)?Effect\()/)
			.slice(1)
			.filter(chunk => /^use(?:Layout)?Effect\(\s*\(\)\s*=>\s*(?!\(\)\s*=>)[^\s{]/.test(chunk))
			.map(chunk => `${path.relative(WEB_SRC, file)}: ${chunk.split('\n')[0]}`)
	)
	expect(offenders).toEqual([])
})
