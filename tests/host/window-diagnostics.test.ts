/**
 * The diagnosis is only useful if it fires for the failure it was written for and for nothing else, and if
 * its one line can be read without opening the code. Pinned: the error matcher (including macOS's own
 * Korean wording, which is what reached a phone) and the line's shape for a healthy window, a window whose
 * tree stops short, and one that is not on any display. The embedded AppleScript and JXA are *not* covered
 * here — they live in strings, so only running them tells you (run once against the live Mac).
 */
import { describe, expect, it } from 'vitest'
import {
	formatWindowDiagnostics,
	isAxTreeFailure,
	isTabStripFailure,
	wantsWindowDiagnosis
} from '../../src/host/window-diagnostics.ts'

describe('isAxTreeFailure', () => {
	it('matches the failure that reached a phone, in Korean and in English', () => {
		expect(
			isAxTreeFailure(
				'System Events에 오류 발생: UI element 1 of UI element 1 of window 1 of process "Conductor"을(를) 가져올 수 없습니다. 유효하지 않은 인덱스.'
			)
		).toBe(true)
		expect(
			isAxTreeFailure(
				'System Events got an error: Can’t get UI element 1 of UI element 1 of window 1 of process "Conductor". Invalid index.'
			)
		).toBe(true)
	})

	it('leaves every other send failure alone', () => {
		expect(isAxTreeFailure(undefined)).toBe(false)
		expect(isAxTreeFailure('')).toBe(false)
		expect(isAxTreeFailure('chat tab 2 not found')).toBe(false)
		expect(isAxTreeFailure('The Mac is locked')).toBe(false)
		// The no-window case is already named in words by windowFailure(); it must not start a diagnosis.
		expect(isAxTreeFailure('Can’t get window 1 of process "Conductor". Invalid index.')).toBe(false)
		// An Invalid index with no UI element path is somebody else's error.
		expect(isAxTreeFailure('Invalid index')).toBe(false)
	})
})

describe('formatWindowDiagnostics', () => {
	const healthy = {
		ax: 'front=conductor windows=1 win1=@-2560,-115 2560x1440 tree=1>1>1>1>3',
		server: {
			displays: 3,
			thinWindows: 13,
			mainWindows: [{ x: -2560, y: -115, w: 2560, h: 1440, onscreen: true, onDisplay: true }]
		}
	}

	it('puts the AX trail, the display count and the main window on one line', () => {
		const line = formatWindowDiagnostics(healthy)
		expect(line.split('\n')).toHaveLength(1)
		expect(line).toContain('tree=1>1>1>1>3')
		expect(line).toContain('displays=3')
		expect(line).toContain('main1=@-2560,-115 2560x1440 onscreen on-display')
		expect(line).toContain('thin=13')
	})

	it('shows where a tree stops short and a window that is under no display', () => {
		const line = formatWindowDiagnostics({
			ax: 'front=Google Chrome windows=1 tree=1>0',
			server: {
				displays: 1,
				thinWindows: 13,
				mainWindows: [{ x: -2560, y: -115, w: 2560, h: 1440, onscreen: false, onDisplay: false }]
			}
		})
		expect(line).toContain('tree=1>0')
		expect(line).toContain('displays=1')
		expect(line).toContain('hidden OFF-DISPLAY')
	})

	it('says plainly what it could not read instead of dropping it', () => {
		expect(formatWindowDiagnostics({ ax: null, server: null })).toBe('ax=unreadable server=unreadable')
		const noMain = formatWindowDiagnostics({
			ax: 'front=x windows=0',
			server: { displays: null, thinWindows: 0, mainWindows: [] }
		})
		expect(noMain).toContain('displays=?')
		expect(noMain).toContain('main=none')
	})

	it('lists at most three main windows', () => {
		const w = { x: 0, y: 0, w: 100, h: 100, onscreen: true, onDisplay: true }
		const line = formatWindowDiagnostics({
			ax: 'a',
			server: { displays: 1, thinWindows: 0, mainWindows: [w, w, w, w, w] }
		})
		expect(line).toContain('main3=')
		expect(line).not.toContain('main4=')
	})
})

describe('isTabStripFailure', () => {
	it('matches the three sentences the chat-strip handlers raise', () => {
		expect(isTabStripFailure("couldn't identify the chat tab strip")).toBe(true)
		expect(isTabStripFailure("couldn't identify the chat tab strip (tried 5×)")).toBe(true)
		expect(isTabStripFailure("can't tell which tab strip holds the target chat")).toBe(true)
		expect(isTabStripFailure("couldn't find the chat tab strip")).toBe(true)
		// macOS sometimes hands back typographic apostrophes.
		expect(isTabStripFailure('couldn’t identify the chat tab strip')).toBe(true)
	})

	it('leaves unrelated failures alone', () => {
		expect(isTabStripFailure(undefined)).toBe(false)
		expect(isTabStripFailure('chat tab 2 not found')).toBe(false)
		expect(isTabStripFailure('The Mac is locked')).toBe(false)
		expect(isTabStripFailure("the palette didn't land on pla-5932")).toBe(false)
	})

	it('either kind of window-shape failure starts a diagnosis, and nothing else does', () => {
		expect(wantsWindowDiagnosis("couldn't identify the chat tab strip")).toBe(true)
		expect(wantsWindowDiagnosis('UI element 1 of UI element 1 of window 1 … Invalid index')).toBe(true)
		expect(wantsWindowDiagnosis('chat tab 2 not found')).toBe(false)
		expect(wantsWindowDiagnosis(undefined)).toBe(false)
	})
})
