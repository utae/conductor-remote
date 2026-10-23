/**
 * `service update` fast-forwards the checkout the login service runs from, so the rules for when it may
 * are what keep it from running a feature branch or tangling a pull with unsaved work. Pinned here, apart
 * from the command that actually runs git.
 */
import { describe, expect, it } from 'vitest'
import { parseCount, updateBlocker } from '../../scripts/service/update-plan.ts'

const ok = { hasGit: true, branch: 'main', clean: true, behind: 3 }

describe('updateBlocker', () => {
	it('allows a clean main checkout, whether it is behind or already current', () => {
		expect(updateBlocker(ok)).toBeNull()
		expect(updateBlocker({ ...ok, behind: 0 })).toBeNull()
	})

	it('leaves a published package to its own auto-update', () => {
		expect(updateBlocker({ ...ok, hasGit: false })).toMatch(/not a git checkout/)
	})

	it('refuses any branch but main, a detached HEAD included', () => {
		expect(updateBlocker({ ...ok, branch: 'feat/send-needs-check' })).toMatch(/"feat\/send-needs-check", not main/)
		expect(updateBlocker({ ...ok, branch: null })).toMatch(/detached HEAD/)
	})

	it('refuses a dirty tree', () => {
		expect(updateBlocker({ ...ok, clean: false })).toMatch(/local changes/)
	})

	it('refuses when it could not compare with origin, rather than guessing there is nothing to do', () => {
		expect(updateBlocker({ ...ok, behind: null })).toMatch(/Could not compare/)
	})

	it('names the checkout problem before the network one, so the cheaper fix comes first', () => {
		expect(updateBlocker({ hasGit: true, branch: 'dev', clean: false, behind: null })).toMatch(/not main/)
	})
})

describe('parseCount', () => {
	it('reads a rev-list count', () => {
		expect(parseCount('0\n')).toBe(0)
		expect(parseCount('12')).toBe(12)
	})

	it('treats anything else as unknown, never as zero', () => {
		expect(parseCount('')).toBeNull()
		expect(parseCount('fatal: bad revision')).toBeNull()
		expect(parseCount('-1')).toBeNull()
	})
})
