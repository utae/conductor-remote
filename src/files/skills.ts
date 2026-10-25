import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The skills and slash commands an agent in a workspace can be sent as `/name`, read off disk.
 *
 * There is no list to ask for: Conductor's stored frames keep only the MCP servers of an agent's `init`
 * message (measured: no `skills`, no `slash_commands`), and the Claude CLI's own listing is its TUI. So this
 * reads the places Claude Code itself loads from — the workspace's `.claude/`, the user's `~/.claude/`,
 * every *enabled* plugin, and the skills Conductor bundles — and takes only what a menu needs from each
 * file's frontmatter. Nothing else in those files, and nothing in `settings.json` but `enabledPlugins`,
 * is read, because that file also holds `env` and hooks.
 *
 * What it cannot see is whatever the CLI ships inside its own binary (`/compact`, `/review`, …): those are
 * not files. Hard-coding them would rot, so they are absent rather than guessed.
 */

export interface SkillEntry {
	/** What follows the slash: `ralph`, or `oh-my-claudecode:ralph` for a plugin's. */
	name: string
	description: string
	kind: 'skill' | 'command'
	source: 'project' | 'user' | 'plugin' | 'conductor'
	/** The plugin that owns it, for `source: 'plugin'` and `'conductor'`. */
	plugin?: string
}

export interface SkillRoots {
	home: string
	/** The workspace's checkout; null for a workspace whose folder is gone. */
	worktree: string | null
	/** `…/Conductor.app/Contents/Resources/conductor-skill/skills`, where the bundled skill lives. */
	conductorSkills: string
}

export const CONDUCTOR_SKILLS_ROOT = '/Applications/Conductor.app/Contents/Resources/conductor-skill/skills'

/** A frontmatter is a header: if the closing fence is further away than this, it is not one. */
const FRONTMATTER_BYTES = 8 * 1024
const MAX_DESCRIPTION = 240
const MAX_SKILLS = 600

/** The first bytes of a file as text, or null when it cannot be read. Never the whole file: a skill can ship megabytes. */
function readHead(file: string): string | null {
	let fd: number | undefined
	try {
		fd = fs.openSync(file, 'r')
		const buffer = Buffer.alloc(FRONTMATTER_BYTES)
		const read = fs.readSync(fd, buffer, 0, FRONTMATTER_BYTES, 0)
		return buffer.toString('utf8', 0, read)
	} catch {
		return null
	} finally {
		if (fd !== undefined) fs.closeSync(fd)
	}
}

function unquote(value: string): string {
	const v = value.trim()
	if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
		return v.slice(1, -1)
	}
	return v
}

/**
 * The top-level `key: value` pairs of a `---` frontmatter, as strings. This is the YAML subset skills actually
 * use — plain and quoted scalars, and `>` / `|` block scalars (which is how long descriptions are written) —
 * not a YAML parser: a nested map yields an empty value for its key and its children are skipped.
 */
export function parseFrontmatter(text: string): Record<string, string> {
	const lines = text.replace(/\r\n/g, '\n').split('\n')
	if (lines[0]?.trim() !== '---') return {}
	const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
	if (end === -1) return {}
	const out: Record<string, string> = {}
	for (let i = 1; i < end; i++) {
		const match = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
		if (!match) continue
		const [, key, rest] = match
		if (/^[>|][+-]?$/.test(rest.trim())) {
			// A block scalar owns every following line that is indented (or blank).
			const block: string[] = []
			while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim())
			out[key] = block.join(rest.trim().startsWith('|') ? '\n' : ' ').trim()
		} else {
			out[key] = unquote(rest)
			// Skip an indented continuation or nested map under a bare key.
			while (i + 1 < end && /^\s+\S/.test(lines[i + 1])) i++
		}
	}
	return out
}

function tidy(description: string | undefined): string {
	const flat = (description ?? '').replace(/\s+/g, ' ').trim()
	return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : flat
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory()
	} catch {
		return false
	}
}

function listDir(dir: string): fs.Dirent[] {
	try {
		return fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return []
	}
}

/** `<dir>/<skill>/SKILL.md` for each skill folder, including a symlinked one. */
function skillsIn(dir: string, source: SkillEntry['source'], plugin?: string): SkillEntry[] {
	const found: SkillEntry[] = []
	for (const entry of listDir(dir)) {
		const folder = path.join(dir, entry.name)
		if (!(entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(folder)))) continue
		const head = readHead(path.join(folder, 'SKILL.md'))
		if (head === null) continue
		const meta = parseFrontmatter(head)
		// A skill the author hid from the slash menu is not offered, however the agent may still use it.
		if (meta['user-invocable']?.toLowerCase() === 'false') continue
		const base = meta.name?.trim() || entry.name
		found.push({
			name: plugin ? `${plugin}:${base}` : base,
			description: tidy(meta.description),
			kind: 'skill',
			source,
			...(plugin ? { plugin } : {})
		})
	}
	return found
}

/** `<dir>/<command>.md`, and `<dir>/<group>/<command>.md` as `group:command`, the way Claude Code names them. */
function commandsIn(dir: string, source: SkillEntry['source'], plugin?: string): SkillEntry[] {
	const found: SkillEntry[] = []
	const add = (file: string, name: string) => {
		const head = readHead(file)
		if (head === null) return
		const meta = parseFrontmatter(head)
		found.push({
			name: plugin ? `${plugin}:${name}` : name,
			description: tidy(meta.description),
			kind: 'command',
			source,
			...(plugin ? { plugin } : {})
		})
	}
	for (const entry of listDir(dir)) {
		const full = path.join(dir, entry.name)
		if (entry.isFile() && entry.name.endsWith('.md')) add(full, entry.name.slice(0, -3))
		else if (entry.isDirectory()) {
			for (const inner of listDir(full)) {
				if (inner.isFile() && inner.name.endsWith('.md'))
					add(path.join(full, inner.name), `${entry.name}:${inner.name.slice(0, -3)}`)
			}
		}
	}
	return found
}

/** Only `enabledPlugins` is taken from a settings file: the rest holds environment variables and hooks. */
function enabledPlugins(settingsFile: string): Record<string, boolean> {
	try {
		const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as { enabledPlugins?: unknown }
		const raw = parsed.enabledPlugins
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
		return Object.fromEntries(
			Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
		)
	} catch {
		return {}
	}
}

interface PluginInstall {
	name: string
	installPath: string
}

/** Installed plugins that are switched on for this workspace: user scope, or project scope for this checkout. */
function activePlugins(roots: SkillRoots): PluginInstall[] {
	const claude = path.join(roots.home, '.claude')
	let registry: { plugins?: Record<string, { scope?: string; installPath?: string; projectPath?: string }[]> }
	try {
		registry = JSON.parse(fs.readFileSync(path.join(claude, 'plugins', 'installed_plugins.json'), 'utf8'))
	} catch {
		return []
	}
	const enabled: Record<string, boolean> = {
		...enabledPlugins(path.join(claude, 'settings.json')),
		...(roots.worktree ? enabledPlugins(path.join(roots.worktree, '.claude', 'settings.json')) : {}),
		...(roots.worktree ? enabledPlugins(path.join(roots.worktree, '.claude', 'settings.local.json')) : {})
	}
	const active: PluginInstall[] = []
	for (const [key, installs] of Object.entries(registry.plugins ?? {})) {
		if (enabled[key] !== true || !Array.isArray(installs)) continue
		const install = installs.find(
			entry =>
				entry.installPath && (entry.scope === 'user' || (!!roots.worktree && entry.projectPath === roots.worktree))
		)
		if (install?.installPath) active.push({ name: key.split('@')[0], installPath: install.installPath })
	}
	return active
}

/**
 * Everything a `/` could name here, one entry per name, project before user before plugin before Conductor's
 * own (the first to claim a name keeps it), sorted by name.
 */
export function listSkills(roots: SkillRoots): SkillEntry[] {
	const claude = path.join(roots.home, '.claude')
	const all: SkillEntry[] = []
	if (roots.worktree) {
		all.push(...skillsIn(path.join(roots.worktree, '.claude', 'skills'), 'project'))
		all.push(...commandsIn(path.join(roots.worktree, '.claude', 'commands'), 'project'))
	}
	all.push(...skillsIn(path.join(claude, 'skills'), 'user'))
	all.push(...commandsIn(path.join(claude, 'commands'), 'user'))
	for (const plugin of activePlugins(roots)) {
		all.push(...skillsIn(path.join(plugin.installPath, 'skills'), 'plugin', plugin.name))
		all.push(...commandsIn(path.join(plugin.installPath, 'commands'), 'plugin', plugin.name))
	}
	// Conductor injects its own skill into every agent under the plugin-style name `conductor:conductor`.
	all.push(...skillsIn(roots.conductorSkills, 'conductor', 'conductor'))

	const seen = new Set<string>()
	const unique = all.filter(entry => {
		if (seen.has(entry.name)) return false
		seen.add(entry.name)
		return true
	})
	return unique.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })).slice(0, MAX_SKILLS)
}

const TTL_MS = 20_000
const cache = new Map<string, { at: number; skills: SkillEntry[] }>()

/** `listSkills` with a short memory, because the phone asks each time a `/` is typed and the answer is files. */
export function listSkillsCached(worktree: string | null, now = Date.now()): SkillEntry[] {
	const key = worktree ?? ''
	const hit = cache.get(key)
	if (hit && now - hit.at < TTL_MS) return hit.skills
	const skills = listSkills({ home: os.homedir(), worktree, conductorSkills: CONDUCTOR_SKILLS_ROOT })
	cache.set(key, { at: now, skills })
	return skills
}
