/**
 * AppleScript is the one language nothing else in the toolchain reads, and "window 1" is a quiet trap in it:
 * it is the *frontmost* window, not the main one. Conductor sometimes draws a tiny floating window in front
 * of the main window, and every walk rooted at `window 1` then fails with "UI element 1 of UI element 1 of
 * window 1 ... Invalid index" until it goes away (measured 2026-10-25: windows=2, window 1 an 84x77 layer-3
 * window, 39s, nothing landed). The handlers go through `mainWindowIndex` instead; this keeps it that way.
 *
 * It scans the source, not behaviour, because the behaviour needs a live Conductor with a second window.
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

describe('Conductor AppleScript window addressing', () => {
	const sources = conductorAppleScriptSources()

	it('never roots a walk at `window 1`', () => {
		const offenders = sources.filter(source => /\bwindow 1\b/.test(code(source.text))).map(source => source.file)
		expect(offenders).toEqual([])
	})

	it('reaches the web area, the tab strips and the dialogs through the main window', () => {
		const text = sources.map(source => code(source.text)).join('\n')
		expect(text).toMatch(/on mainWindowIndex\(\)/)
		expect(text).toMatch(/window mainIdx\b/)
		// Each caller computes the index outside the tell, so the handler name cannot resolve as an SE term.
		// `tabGroups` delegates the walk to `collectTabGroups`, which is where the window is chosen.
		for (const handler of ['webArea', 'collectTabGroups', 'dialogButtons']) {
			const body = text.split(new RegExp(`^on ${handler}\\(`, 'm'))[1]?.split(/^end /m)[0] ?? ''
			expect(body, handler).toContain('my mainWindowIndex()')
		}
	})

	it('falls back to window 1 only when it cannot read sizes, never to nothing', () => {
		const text = code(sources.map(source => source.text).join(''))
		const body = text.split(/^on mainWindowIndex\(\)/m)[1]?.split(/^end mainWindowIndex/m)[0] ?? ''
		expect(body).toContain('set bestIdx to 1')
		expect(body).toContain('if winTotal < 2 then return 1')
		expect(body).toContain('return bestIdx')
	})
})
