/**
 * Conductor 0.92.0 stopped keeping the chat strip and the terminal strip side by side: the terminal strip
 * (Setup / Run / Terminal N) sits at depth 7 beside the workspace header, the chat strip at depth 11 beside the
 * composer. The old `tabGroups()` returned only the shallowest depth that had a tab group, so it returned the
 * terminal strip alone and every send failed with "couldn't identify the chat tab strip" (relay log 2026-10-25).
 *
 * The behaviour needs a live Conductor, so these scan the AppleScript source for the three decisions that keep the
 * fix in place. The live checks (read-only, against the real window) are in the PR description.
 */
import { describe, expect, it } from 'vitest'
import { conductorAppleScriptSources } from '../../src/writes/applescript/source.ts'

/** Code only: `(* … *)` blocks and `-- …` line comments removed, which is where the explanation lives. */
function code(text: string): string {
	return text
		.replace(/\(\*[\s\S]*?\*\)/g, '')
		.split('\n')
		.map(line => line.replace(/--.*$/, ''))
		.join('\n')
}

const sources = conductorAppleScriptSources()
const all = sources.map(source => code(source.text)).join('\n')

/** The body of one handler, or '' when it does not exist. */
function handler(name: string): string {
	return all.split(new RegExp(`^on ${name}\\(`, 'm'))[1]?.split(new RegExp(`^end ${name}`, 'm'))[0] ?? ''
}

describe('chat strip discovery', () => {
	it('collects tab groups at every depth instead of stopping at the first depth that has one', () => {
		const collect = handler('collectTabGroups')
		expect(collect).not.toBe('')
		// The old loop returned from inside itself as soon as a level had a tab group.
		expect(collect).not.toMatch(/if \(count of found\) > 0 then return found/)
		expect(collect).toMatch(/depth < 14/)
		expect(collect).toMatch(/visited < 400/)
		expect(collect).toContain('return found')
	})

	it('keeps the shallowest-first order and widens once when the narrow pass finds nothing', () => {
		const body = handler('tabGroups')
		expect(body).toContain('my collectTabGroups(30)')
		expect(body).toMatch(/if \(count of found\) is 0 then set found to my collectTabGroups\(100000\)/)
	})

	it('finds the composer through the strip that has one, not through `item 1 of strips`', () => {
		expect(handler('composerPane')).toContain('whose name is "composer"')
		// Both callers go through the helper, and neither reads the composer off the first strip's parent.
		expect(handler('composerField')).toContain('my composerPane(strips)')
		expect(handler('composerControls')).toContain('my composerPane(strips)')
		for (const name of ['composerField', 'composerControls']) {
			expect(handler(name), name).not.toMatch(/AXParent" of \(item 1 of strips\)/)
		}
	})

	it('lets a lone chat through only when no strip holds any chat tab, never with several chats', () => {
		const select = handler('selectChatTab')
		expect(select).toMatch(/if wantCount <= 1 and not \(my hasChatTabs\(strips\)\) then return/)
		// The scoring and the tie refusal are still what decides among several chats.
		expect(select).toContain('my pickChatStrip(strips, wantCount, wantTitle)')
		expect(handler('pickChatStrip')).toContain("couldn't identify the chat tab strip")
		expect(handler('pickChatStrip')).toContain("can't tell which tab strip holds the target chat")
	})

	it('treats only a "Close chat" radio as a chat tab, so the terminal strip is never mistaken for one', () => {
		expect(handler('hasChatTabs')).toContain('starts with "Close chat"')
	})
})
