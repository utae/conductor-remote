/**
 * `connectionReason` is what keeps "locked", "Conductor not running" and "no window" from being
 * folded into one error on the phone, so each branch and the precedence between them is pinned.
 * `listsConductorProcess` is the only parse in the probe: the helper processes carry the same
 * bundle path as a prefix, and a match on the path alone would call a dead app alive.
 */
import { describe, expect, it, vi } from 'vitest'
import { connectionReason, listsConductorProcess, retryOnce } from '../../src/host/conductor-status.ts'

describe('retryOnce', () => {
	it('returns a definite answer without a second call', async () => {
		const probe = vi.fn(async () => 3)
		expect(await retryOnce(probe)).toBe(3)
		expect(probe).toHaveBeenCalledTimes(1)
	})

	it('treats false and 0 as answers, not as failures', async () => {
		const falsy = vi.fn(async () => false)
		expect(await retryOnce(falsy)).toBe(false)
		expect(falsy).toHaveBeenCalledTimes(1)
		const zero = vi.fn(async () => 0)
		expect(await retryOnce(zero)).toBe(0)
		expect(zero).toHaveBeenCalledTimes(1)
	})

	it('tries once more after a null and uses the second answer', async () => {
		const probe = vi.fn<() => Promise<number | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(7)
		expect(await retryOnce(probe)).toBe(7)
		expect(probe).toHaveBeenCalledTimes(2)
	})

	it('gives up after the second null instead of looping', async () => {
		const probe = vi.fn(async () => null)
		expect(await retryOnce(probe)).toBeNull()
		expect(probe).toHaveBeenCalledTimes(2)
	})
})

describe('connectionReason', () => {
	it('is ok only when nothing is wrong and every probe answered', () => {
		expect(connectionReason({ locked: false, running: true, windows: 1 })).toBe('ok')
	})

	it('names the lock first, even with no process or window behind it', () => {
		expect(connectionReason({ locked: true, running: false, windows: 0 })).toBe('locked')
		expect(connectionReason({ locked: true, running: true, windows: 2 })).toBe('locked')
	})

	it('separates a missing app from a windowless one', () => {
		expect(connectionReason({ locked: false, running: false, windows: 0 })).toBe('conductor_not_running')
		expect(connectionReason({ locked: false, running: true, windows: 0 })).toBe('no_window')
	})

	it('treats a failed probe as unknown, never as a verdict', () => {
		expect(connectionReason({ locked: false, running: null, windows: 1 })).toBe('unknown')
		expect(connectionReason({ locked: false, running: true, windows: null })).toBe('unknown')
		expect(connectionReason({ locked: null, running: true, windows: 1 })).toBe('unknown')
	})

	it('does not let a failed probe hide a definite problem', () => {
		expect(connectionReason({ locked: false, running: true, windows: 0 })).toBe('no_window')
		expect(connectionReason({ locked: false, running: false, windows: null })).toBe('conductor_not_running')
	})
})

describe('listsConductorProcess', () => {
	const main = '/Applications/Conductor.app/Contents/MacOS/Conductor'

	it('finds the main executable', () => {
		expect(listsConductorProcess(`/sbin/launchd\n${main}\n/usr/bin/ssh\n`)).toBe(true)
	})

	it('matches the real binary name, which is lowercase inside the Conductor.app bundle', () => {
		expect(listsConductorProcess('/Applications/Conductor.app/Contents/MacOS/conductor\n')).toBe(true)
	})

	it('ignores helper processes that share the bundle path', () => {
		const helper =
			'/Applications/Conductor.app/Contents/Frameworks/Conductor Helper.app/Contents/MacOS/Conductor Helper'
		expect(listsConductorProcess(`${helper}\n`)).toBe(false)
	})

	it('is false for an empty or unrelated listing', () => {
		expect(listsConductorProcess('')).toBe(false)
		expect(listsConductorProcess('/usr/bin/vim\n')).toBe(false)
	})
})
