import { describe, expect, test } from 'vitest'
import { deviceIdFromToken, deviceNameGuess } from '../../web/src/lib/auth-token.ts'

/**
 * The Connect sheet decides between "here is a QR with this token" and "this phone is paired" from the
 * token's shape alone. Getting it wrong either way is costly: a QR of a device token clones that device's
 * identity, and a paired note for the shared token hides the only way to add another phone.
 */
describe('deviceIdFromToken', () => {
	test('reads the id out of a device token', () => {
		expect(deviceIdFromToken('4f2a9c01d3b7.aB3_xY-9zQ')).toBe('4f2a9c01d3b7')
	})

	test('leaves the shared token alone, whatever else it looks like', () => {
		expect(deviceIdFromToken('0123456789abcdef0123456789abcdef')).toBeNull()
		expect(deviceIdFromToken('some-pinned-secret')).toBeNull()
		expect(deviceIdFromToken(null)).toBeNull()
		expect(deviceIdFromToken('')).toBeNull()
	})

	test('does not take a near miss for a device', () => {
		expect(deviceIdFromToken('4f2a9c01d3b.short')).toBeNull()
		expect(deviceIdFromToken('4F2A9C01D3B7.upper')).toBeNull()
		expect(deviceIdFromToken('4f2a9c01d3b7.')).toBeNull()
		expect(deviceIdFromToken('4f2a9c01d3b7.has space')).toBeNull()
	})
})

describe('deviceNameGuess', () => {
	test('uses the Android model from the user agent', () => {
		expect(
			deviceNameGuess(
				'Mozilla/5.0 (Linux; Android 15; SM-S931N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
			)
		).toBe('SM-S931N')
		expect(deviceNameGuess('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A) Chrome/130.0 Mobile')).toBe('Pixel 8')
	})

	test('falls back to Phone when there is no model', () => {
		expect(deviceNameGuess('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1')).toBe('Phone')
		expect(deviceNameGuess('')).toBe('Phone')
	})
})
