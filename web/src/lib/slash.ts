import type { SkillEntry } from './types.ts'

/**
 * The `/` menu over the composer: which `/word` the caret is in, which skills it matches, and what a pick
 * does to the draft. Pure, because the menu is a handful of rules about a string and a caret and every one of
 * them is easy to get quietly wrong (a menu that opens on "and/or", or eats the sentence typed after the name).
 */

export interface SlashToken {
	/** What was typed after the slash. */
	query: string
	/** Where the token ends in the draft: the first whitespace, or the end. */
	end: number
}

/**
 * The slash command being typed, or null. Claude Code only reads a command at the very start of a prompt, so
 * only a draft that *begins* with `/` has one — "and/or" and a path mid-sentence never open the menu — and only
 * while the caret is inside that first word: once there is a space and arguments, the name is done.
 */
export function slashToken(text: string, caret: number): SlashToken | null {
	if (!text.startsWith('/')) return null
	const word = /^\/(\S*)/.exec(text)
	const end = word ? word[0].length : 1
	if (caret < 1 || caret > end) return null
	return { query: word?.[1] ?? '', end }
}

/** The part of a plugin skill's name after `plugin:`, which is what someone types when they know it. */
function bareName(name: string): string {
	const colon = name.indexOf(':')
	return colon === -1 ? name : name.slice(colon + 1)
}

/**
 * What matches `query`, best first: the name starts with it, then the name without its plugin prefix does, then the
 * name contains it, then only the description does. Within a tier the relay's order (alphabetical) stands. An
 * empty query is everything. Case-insensitive; the colon is an ordinary character, so `omc:` narrows to a plugin.
 */
export function filterSkills(skills: readonly SkillEntry[], query: string, limit = 80): SkillEntry[] {
	const q = query.trim().toLowerCase()
	if (!q) return skills.slice(0, limit)
	const tiers: SkillEntry[][] = [[], [], [], []]
	for (const skill of skills) {
		const name = skill.name.toLowerCase()
		if (name.startsWith(q)) tiers[0].push(skill)
		else if (bareName(name).startsWith(q)) tiers[1].push(skill)
		else if (name.includes(q)) tiers[2].push(skill)
		else if (skill.description.toLowerCase().includes(q)) tiers[3].push(skill)
	}
	return tiers.flat().slice(0, limit)
}

/**
 * The draft after picking `name`: the typed word becomes `/name`, whatever followed it stays, and there is exactly
 * one space after the name so the arguments can be typed straight away. The caret goes after that space.
 */
export function applySkill(
	text: string,
	token: Pick<SlashToken, 'end'>,
	name: string
): { text: string; caret: number } {
	const rest = text.slice(token.end)
	const head = `/${name} `
	return { text: head + rest.replace(/^[ \t]+/, ''), caret: head.length }
}

export type SlashKeyAction = 'next' | 'previous' | 'choose' | 'dismiss'

/**
 * What a key does while the menu is open, or null to let the textarea have it. Enter and Tab pick (a soft keyboard's
 * Enter would otherwise add a line break under a menu the user is looking at), the arrows move and wrap, Escape
 * closes. Anything with a modifier is left alone: Cmd+Enter is Send.
 */
export function slashKeyAction(
	key: string,
	modifiers: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }
): SlashKeyAction | null {
	if (modifiers.meta || modifiers.ctrl || modifiers.alt) return null
	if (key === 'ArrowDown') return 'next'
	if (key === 'ArrowUp') return 'previous'
	if (key === 'Escape') return 'dismiss'
	if (key === 'Enter' && !modifiers.shift) return 'choose'
	if (key === 'Tab' && !modifiers.shift) return 'choose'
	return null
}

/** Step the highlighted row, wrapping at both ends. */
export function moveActive(active: number, delta: 1 | -1, count: number): number {
	if (count <= 0) return 0
	return (active + delta + count) % count
}
