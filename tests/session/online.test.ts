import { describe, expect, test } from 'vitest'
import { OFFLINE_GRACE_MS, offlineDelay } from '../../web/src/lib/online.ts'

describe('offline delay', () => {
	const now = 1_000_000

	test('keeps the banner hidden for 25 seconds after a failure', () => {
		expect(OFFLINE_GRACE_MS).toBe(25_000)
		expect(offlineDelay(null, now)).toBe(25_000)
	})

	test('uses the last successful request to calculate the remaining grace period', () => {
		expect(offlineDelay(now - 3_000, now)).toBe(22_000)
		expect(offlineDelay(now - 30_000, now)).toBe(0)
	})
})
