/**
 * What the `/` menu can offer is read off disk, and every way that read is wrong is silent: a disabled plugin's
 * skills offered, a block-scalar description read as ">", a hidden skill listed, a project skill shadowed by the
 * user's. The fixtures are built the way Claude Code lays its folders out; the real home is never touched.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listSkills, parseFrontmatter, type SkillRoots } from '../../src/files/skills.ts'

let root: string
let roots: SkillRoots

function write(file: string, text: string) {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, text)
}

function skill(dir: string, name: string, frontmatter: string) {
	write(path.join(dir, name, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# body\n`)
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'))
	roots = {
		home: path.join(root, 'home'),
		worktree: path.join(root, 'work'),
		conductorSkills: path.join(root, 'conductor-skills')
	}
	fs.mkdirSync(roots.home, { recursive: true })
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const claude = () => path.join(roots.home, '.claude')
const names = () => listSkills(roots).map(s => s.name)

describe('parseFrontmatter', () => {
	it('reads plain, quoted and block-scalar values, which is how long descriptions are written', () => {
		const meta = parseFrontmatter(
			[
				'---',
				'name: "quoted-name"',
				'description: >',
				'  First line of a folded',
				'  description.',
				"license: 'MIT'",
				'notes: |',
				'  keeps',
				'  lines',
				'---',
				'body: not part of it'
			].join('\n')
		)
		expect(meta.name).toBe('quoted-name')
		expect(meta.description).toBe('First line of a folded description.')
		expect(meta.license).toBe('MIT')
		expect(meta.notes).toBe('keeps\nlines')
		expect(meta.body).toBeUndefined()
	})

	it('skips a nested map without mistaking its children for top-level keys', () => {
		const meta = parseFrontmatter('---\nname: a\nmetadata:\n  author: someone\n  name: not-this\ndescription: d\n---\n')
		expect(meta).toEqual({ name: 'a', metadata: '', description: 'd' })
	})

	it('returns nothing for a file with no frontmatter, an unclosed one, or CRLF line endings that are fine', () => {
		expect(parseFrontmatter('# just markdown')).toEqual({})
		expect(parseFrontmatter('---\nname: never closed\n')).toEqual({})
		expect(parseFrontmatter('---\r\nname: crlf\r\n---\r\n')).toEqual({ name: 'crlf' })
	})
})

describe('listSkills', () => {
	it('reads user and project skills, naming each by its frontmatter name and falling back to the folder', () => {
		skill(path.join(claude(), 'skills'), 'review-folder', 'name: review\ndescription: Reviews code')
		skill(path.join(claude(), 'skills'), 'no-name', 'description: Folder name wins')
		skill(path.join(roots.worktree as string, '.claude', 'skills'), 'proj', 'description: Project only')
		const found = listSkills(roots)
		expect(found.map(s => [s.name, s.source])).toEqual([
			['no-name', 'user'],
			['proj', 'project'],
			['review', 'user']
		])
		expect(found.find(s => s.name === 'review')?.description).toBe('Reviews code')
	})

	it('lets a project skill claim a name before the user one, and shows each name once', () => {
		skill(path.join(claude(), 'skills'), 'dup', 'description: from user')
		skill(path.join(roots.worktree as string, '.claude', 'skills'), 'dup', 'description: from project')
		const found = listSkills(roots).filter(s => s.name === 'dup')
		expect(found).toHaveLength(1)
		expect(found[0]).toMatchObject({ source: 'project', description: 'from project' })
	})

	it('hides a skill its author marked not user-invocable', () => {
		skill(path.join(claude(), 'skills'), 'visible', 'description: ok')
		skill(path.join(claude(), 'skills'), 'hidden', 'description: no\nuser-invocable: false')
		expect(names()).toEqual(['visible'])
	})

	it('follows a symlinked skill folder, and ignores a folder with no SKILL.md', () => {
		const target = path.join(root, 'elsewhere')
		skill(target, 'linked', 'description: via symlink')
		fs.mkdirSync(path.join(claude(), 'skills'), { recursive: true })
		fs.symlinkSync(path.join(target, 'linked'), path.join(claude(), 'skills', 'linked'))
		fs.mkdirSync(path.join(claude(), 'skills', 'empty'), { recursive: true })
		expect(names()).toEqual(['linked'])
	})

	it('adds commands, naming a nested one group:name', () => {
		write(path.join(claude(), 'commands', 'deploy.md'), '---\ndescription: Ship it\n---\nbody')
		write(path.join(claude(), 'commands', 'git', 'sync.md'), 'no frontmatter here')
		const found = listSkills(roots)
		expect(found.map(s => [s.name, s.kind, s.description])).toEqual([
			['deploy', 'command', 'Ship it'],
			['git:sync', 'command', '']
		])
	})

	it('truncates a long description to one tidy line', () => {
		skill(path.join(claude(), 'skills'), 'long', `description: ${'word '.repeat(200)}`)
		const [entry] = listSkills(roots)
		expect(entry.description.length).toBeLessThanOrEqual(240)
		expect(entry.description.endsWith('…')).toBe(true)
		expect(entry.description).not.toMatch(/\s{2}/)
	})

	it('survives missing folders and a missing worktree', () => {
		expect(listSkills(roots)).toEqual([])
		expect(listSkills({ ...roots, worktree: null })).toEqual([])
	})
})

describe('plugins', () => {
	const install = (key: string, dir: string, extra: Record<string, unknown> = {}) => ({
		[key]: [{ scope: 'user', installPath: dir, version: '1', ...extra }]
	})

	function setup(plugins: Record<string, unknown>, settings: unknown) {
		write(path.join(claude(), 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }))
		write(path.join(claude(), 'settings.json'), JSON.stringify(settings))
	}

	it("offers an enabled plugin's skills as plugin:name and leaves a disabled or unlisted one out", () => {
		const on = path.join(root, 'cache', 'on')
		const off = path.join(root, 'cache', 'off')
		const unlisted = path.join(root, 'cache', 'unlisted')
		for (const dir of [on, off, unlisted]) skill(path.join(dir, 'skills'), 'thing', 'description: from a plugin')
		setup(
			{ ...install('on@market', on), ...install('off@market', off), ...install('unlisted@market', unlisted) },
			{ enabledPlugins: { 'on@market': true, 'off@market': false } }
		)
		const found = listSkills(roots)
		expect(found.map(s => s.name)).toEqual(['on:thing'])
		expect(found[0]).toMatchObject({ source: 'plugin', plugin: 'on' })
	})

	it("reads a plugin's commands too, and honours a project-scoped plugin only for that checkout", () => {
		const dir = path.join(root, 'cache', 'proj')
		write(path.join(dir, 'commands', 'run.md'), '---\ndescription: Runs\n---')
		const other = path.join(root, 'elsewhere-checkout')
		setup(install('proj@market', dir, { scope: 'project', projectPath: other }), {
			enabledPlugins: { 'proj@market': true }
		})
		expect(names()).toEqual([])
		setup(install('proj@market', dir, { scope: 'project', projectPath: roots.worktree }), {
			enabledPlugins: { 'proj@market': true }
		})
		expect(names()).toEqual(['proj:run'])
	})

	it("enables a plugin from the project's own settings", () => {
		const dir = path.join(root, 'cache', 'local')
		skill(path.join(dir, 'skills'), 'x', 'description: d')
		setup(install('local@market', dir), {})
		write(
			path.join(roots.worktree as string, '.claude', 'settings.json'),
			JSON.stringify({ enabledPlugins: { 'local@market': true } })
		)
		expect(names()).toEqual(['local:x'])
	})

	it('never reads anything from settings.json but enabledPlugins', () => {
		const dir = path.join(root, 'cache', 'p')
		skill(path.join(dir, 'skills'), 'x', 'description: d')
		setup(install('p@market', dir), {
			env: { SECRET_TOKEN: 'do-not-leak-this-value' },
			hooks: { Stop: [{ command: 'do-not-leak-this-hook' }] },
			enabledPlugins: { 'p@market': true }
		})
		const out = JSON.stringify(listSkills(roots))
		expect(out).not.toContain('do-not-leak')
	})

	it('survives a missing or corrupt registry and a corrupt settings file', () => {
		write(path.join(claude(), 'plugins', 'installed_plugins.json'), '{not json')
		write(path.join(claude(), 'settings.json'), '{also not json')
		expect(listSkills(roots)).toEqual([])
	})
})

describe("Conductor's bundled skill", () => {
	it('is offered under the plugin-style name conductor:<skill>', () => {
		skill(roots.conductorSkills, 'conductor', 'description: Operate Conductor')
		const [entry] = listSkills(roots)
		expect(entry).toMatchObject({ name: 'conductor:conductor', source: 'conductor', plugin: 'conductor' })
	})
})
