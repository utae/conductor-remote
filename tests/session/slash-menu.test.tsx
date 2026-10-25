import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { applySkill, filterSkills, moveActive, slashKeyAction, slashToken } from '../../web/src/lib/slash.ts'
import type { SkillEntry } from '../../web/src/lib/types.ts'

// SlashMenu imports the store only through lib helpers; static rendering needs no DOM.
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
})

const { SlashMenu } = await import('../../web/src/components/session/SlashMenu.tsx')

const skill = (name: string, description = '', over: Partial<SkillEntry> = {}): SkillEntry => ({
	name,
	description,
	kind: 'skill',
	source: 'user',
	...over
})

const none = { meta: false, ctrl: false, alt: false, shift: false }

describe('slashToken', () => {
	test('opens for a draft that starts with a slash while the caret is in that first word', () => {
		expect(slashToken('/', 1)).toEqual({ query: '', end: 1 })
		expect(slashToken('/ra', 3)).toEqual({ query: 'ra', end: 3 })
		expect(slashToken('/ra', 2)).toEqual({ query: 'ra', end: 3 })
		expect(slashToken('/oh-my-claudecode:ra', 20)).toEqual({ query: 'oh-my-claudecode:ra', end: 20 })
	})

	test('never opens for a slash that is not the start of the prompt', () => {
		expect(slashToken('and/or', 6)).toBeNull()
		expect(slashToken('see /ralph', 10)).toBeNull()
		expect(slashToken(' /ralph', 7)).toBeNull()
		expect(slashToken('', 0)).toBeNull()
		expect(slashToken('\n/ralph', 7)).toBeNull()
	})

	test('closes once the name is done and arguments are being typed', () => {
		expect(slashToken('/ralph do the thing', 19)).toBeNull()
		expect(slashToken('/ralph do the thing', 7)).toBeNull()
		// The caret still inside the name of a draft that has arguments keeps it open.
		expect(slashToken('/ra do the thing', 3)).toEqual({ query: 'ra', end: 3 })
	})

	test('the caret before the slash is outside it', () => {
		expect(slashToken('/ralph', 0)).toBeNull()
	})
})

describe('filterSkills', () => {
	const all = [
		skill('plan', 'Strategic planning'),
		skill('omc:plan', 'Plugin planning'),
		skill('ralph', 'Loop until done'),
		skill('replan', 'Plan again'),
		skill('review', 'Review a diff, then plan next steps')
	]

	test("an empty query is everything, in the relay's order", () => {
		expect(filterSkills(all, '').map(s => s.name)).toEqual(['plan', 'omc:plan', 'ralph', 'replan', 'review'])
	})

	test('ranks name prefix, then the bare name after a plugin prefix, then contains, then description', () => {
		expect(filterSkills(all, 'plan').map(s => s.name)).toEqual(['plan', 'omc:plan', 'replan', 'review'])
	})

	test('is case-insensitive and treats the colon as ordinary text', () => {
		expect(filterSkills(all, 'PLAN').map(s => s.name)[0]).toBe('plan')
		expect(filterSkills(all, 'omc:').map(s => s.name)).toEqual(['omc:plan'])
	})

	test('matches a description only when nothing else does, and returns nothing for no match', () => {
		expect(filterSkills(all, 'loop').map(s => s.name)).toEqual(['ralph'])
		expect(filterSkills(all, 'zzz')).toEqual([])
	})

	test('caps the list', () => {
		const many = Array.from({ length: 200 }, (_, i) => skill(`s${i}`))
		expect(filterSkills(many, '', 50)).toHaveLength(50)
	})
})

describe('applySkill', () => {
	test('replaces the typed word and leaves one space for the arguments', () => {
		expect(applySkill('/ra', { end: 3 }, 'ralph')).toEqual({ text: '/ralph ', caret: 7 })
		expect(applySkill('/', { end: 1 }, 'plan')).toEqual({ text: '/plan ', caret: 6 })
	})

	test('keeps what was already typed after the word, without doubling the space', () => {
		expect(applySkill('/ra do the thing', { end: 3 }, 'ralph')).toEqual({ text: '/ralph do the thing', caret: 7 })
		expect(applySkill('/ra   spaced', { end: 3 }, 'ralph')).toEqual({ text: '/ralph spaced', caret: 7 })
		expect(applySkill('/ra\nnext line', { end: 3 }, 'ralph').text).toBe('/ralph \nnext line')
	})

	test('a plugin name with a colon goes in whole', () => {
		expect(applySkill('/omc', { end: 4 }, 'oh-my-claudecode:ralph').text).toBe('/oh-my-claudecode:ralph ')
	})
})

describe('keys while the menu is open', () => {
	test('arrows move, Enter and Tab pick, Escape closes', () => {
		expect(slashKeyAction('ArrowDown', none)).toBe('next')
		expect(slashKeyAction('ArrowUp', none)).toBe('previous')
		expect(slashKeyAction('Enter', none)).toBe('choose')
		expect(slashKeyAction('Tab', none)).toBe('choose')
		expect(slashKeyAction('Escape', none)).toBe('dismiss')
	})

	test('leaves modified keys and ordinary typing to the textarea', () => {
		expect(slashKeyAction('Enter', { ...none, meta: true })).toBeNull()
		expect(slashKeyAction('Enter', { ...none, ctrl: true })).toBeNull()
		expect(slashKeyAction('Enter', { ...none, shift: true })).toBeNull()
		expect(slashKeyAction('Tab', { ...none, shift: true })).toBeNull()
		expect(slashKeyAction('a', none)).toBeNull()
		expect(slashKeyAction('Backspace', none)).toBeNull()
	})

	test('the highlight wraps at both ends and survives an empty list', () => {
		expect(moveActive(0, -1, 3)).toBe(2)
		expect(moveActive(2, 1, 3)).toBe(0)
		expect(moveActive(1, 1, 3)).toBe(2)
		expect(moveActive(0, 1, 0)).toBe(0)
	})
})

describe('SlashMenu', () => {
	const items = [
		skill('ralph', 'Loop until done', { source: 'plugin', plugin: 'omc' }),
		skill('deploy', 'Ship it', { kind: 'command', source: 'project' }),
		skill('conductor:conductor', '', { source: 'conductor', plugin: 'conductor' })
	]
	const html = renderToStaticMarkup(<SlashMenu items={items} active={1} onPick={() => {}} onHover={() => {}} />)

	test('lists each skill as an option with the slash, and marks the highlighted one', () => {
		expect(html).toContain('role="listbox"')
		expect((html.match(/role="option"/g) ?? []).length).toBe(3)
		expect(html).toContain('/ralph')
		expect(html).toContain('/conductor:conductor')
		expect(html).toMatch(/aria-selected="true"[^>]*>[\s\S]*?\/deploy/)
		expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1)
	})

	test('says where each comes from, and that a command is one', () => {
		expect(html).toContain('omc')
		expect(html).toContain('command · ')
		expect(html).toContain('project')
		expect(html).toContain('Conductor')
	})

	test('shows a description when there is one and does not invent one', () => {
		expect(html).toContain('Loop until done')
		expect(html).toContain('Ship it')
		// The bundled skill had none: no empty description line.
		expect(html.split('/conductor:conductor')[1]).not.toContain('line-clamp-2')
	})

	test('is anchored above the composer and keeps the textarea focused', () => {
		expect(html).toContain('bottom-full')
		expect(html).toContain('data-slash-menu')
	})
})
