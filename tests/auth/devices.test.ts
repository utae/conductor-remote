/**
 * The device registry is the thing standing between a lost phone and the Mac, so what is pinned
 * here is what fails silently: a revoked token that still works, a pairing code that works twice,
 * a hash on disk that is really the token, and a scope that has quietly grown a write route.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceStore, deviceMay, PAIRING_CODE_TTL_MS } from '../../src/auth/devices.ts'

let directory: string
let file: string
let clock: number

beforeEach(() => {
	directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devices-test-'))
	file = path.join(directory, 'devices.json')
	clock = 1_000_000
})

afterEach(() => {
	fs.rmSync(directory, { recursive: true, force: true })
})

const store = () => new DeviceStore(file, () => clock)

function pairOne(s: DeviceStore, name = 'Galaxy') {
	const paired = s.pair(s.createPairingCode().code, name)
	if (!paired) throw new Error('pairing failed')
	return paired
}

describe('pairing', () => {
	it('trades a code for a token that verifies', () => {
		const s = store()
		const { device, token } = pairOne(s)
		expect(device.name).toBe('Galaxy')
		expect(device.scope).toBe('phone')
		expect(s.verify(token)?.id).toBe(device.id)
	})

	it('spends the code on first use', () => {
		const s = store()
		const { code } = s.createPairingCode()
		expect(s.pair(code, 'one')).not.toBeNull()
		expect(s.pair(code, 'two')).toBeNull()
	})

	it('refuses an unknown or expired code', () => {
		const s = store()
		expect(s.pair('not-a-code', 'x')).toBeNull()
		const { code } = s.createPairingCode()
		clock += PAIRING_CODE_TTL_MS + 1
		expect(s.pair(code, 'x')).toBeNull()
	})

	it('names an unnamed device and caps a long name', () => {
		const s = store()
		expect(pairOne(s, '   ').device.name).toBe('Phone')
		expect(pairOne(s, 'x'.repeat(200)).device.name).toHaveLength(40)
	})

	it('keeps a bounded number of outstanding codes', () => {
		const s = store()
		const codes = Array.from({ length: 8 }, () => s.createPairingCode().code)
		expect(s.pair(codes[0], 'old')).toBeNull()
		expect(s.pair(codes[7], 'new')).not.toBeNull()
	})
})

describe('verify and revoke', () => {
	it('rejects a malformed, unknown or tampered token', () => {
		const s = store()
		const { device, token } = pairOne(s)
		expect(s.verify('')).toBeNull()
		expect(s.verify('no-dot')).toBeNull()
		expect(s.verify('.secret')).toBeNull()
		expect(s.verify(`ffffffffffff.${token.split('.')[1]}`)).toBeNull()
		expect(s.verify(`${device.id}.${token.split('.')[1]}x`)).toBeNull()
	})

	it('stops a revoked device at once, from another store instance on the same file', () => {
		const daemon = store()
		const { device, token } = pairOne(daemon)
		expect(daemon.verify(token)).not.toBeNull()
		// The CLI is a different process holding its own instance of the same file.
		expect(store().revoke(device.id)).toBe(true)
		expect(daemon.verify(token)).toBeNull()
	})

	it('answers an unknown id with false and a repeat revoke with true', () => {
		const s = store()
		const { device } = pairOne(s)
		expect(s.revoke('nope')).toBe(false)
		expect(s.revoke(device.id)).toBe(true)
		expect(s.revoke(device.id)).toBe(true)
		expect(s.list()[0].revokedAt).toBe(clock)
	})

	it('keeps other devices working when one is revoked', () => {
		const s = store()
		const a = pairOne(s, 'a')
		const b = pairOne(s, 'b')
		s.revoke(a.device.id)
		expect(s.verify(a.token)).toBeNull()
		expect(s.verify(b.token)).not.toBeNull()
	})
})

describe('storage', () => {
	it('never writes the token or the pairing code, only hashes', () => {
		const s = store()
		const { code } = s.createPairingCode()
		const { token } = (() => {
			const paired = s.pair(code, 'x')
			if (!paired) throw new Error('pairing failed')
			return paired
		})()
		const raw = fs.readFileSync(file, 'utf8')
		expect(raw).not.toContain(token)
		expect(raw).not.toContain(token.split('.')[1])
		expect(raw).not.toContain(code)
	})

	it('is private to the owner', () => {
		pairOne(store())
		expect(fs.statSync(file).mode & 0o777).toBe(0o600)
	})

	it('accepts nobody from an unreadable file instead of crashing or trusting everyone', () => {
		const s = store()
		const { token } = pairOne(s)
		fs.writeFileSync(file, '{not json')
		expect(s.verify(token)).toBeNull()
		expect(s.list()).toEqual([])
	})

	it('never lists a hash', () => {
		const s = store()
		pairOne(s)
		expect(Object.keys(s.list()[0])).not.toContain('secretHash')
	})
})

describe('deviceMay', () => {
	it('allows what a phone needs to read and send', () => {
		expect(deviceMay('phone', 'GET', '/api/state')).toBe(true)
		expect(deviceMay('phone', 'GET', '/api/connection')).toBe(true)
		expect(deviceMay('phone', 'GET', '/api/workspaces/w1/sessions')).toBe(true)
		expect(deviceMay('phone', 'GET', '/api/sessions/s1/messages')).toBe(true)
		expect(deviceMay('phone', 'POST', '/api/sessions/s1/prompt')).toBe(true)
	})

	it('allows the read-only lookups the app makes by itself, but not the ones that do real work or write', () => {
		expect(deviceMay('phone', 'GET', '/api/models')).toBe(true)
		expect(deviceMay('phone', 'GET', '/api/auto-model')).toBe(true)
		expect(deviceMay('phone', 'GET', '/api/workspaces/w1/dev-server')).toBe(true)
		// Same paths, other verbs: starting or stopping the dev server and editing Auto are writes.
		expect(deviceMay('phone', 'POST', '/api/workspaces/w1/dev-server')).toBe(false)
		expect(deviceMay('phone', 'DELETE', '/api/workspaces/w1/dev-server')).toBe(false)
		expect(deviceMay('phone', 'PATCH', '/api/auto-model')).toBe(false)
		// Plan usage runs the provider CLIs; only opening its sheet should pay for that, and not for a phone.
		expect(deviceMay('phone', 'GET', '/api/usage')).toBe(false)
		// The live model menu opens Conductor's real menu on the Mac.
		expect(deviceMay('phone', 'GET', '/api/sessions/s1/models')).toBe(false)
	})

	it('refuses everything that changes the Mac or its workspaces', () => {
		for (const [method, pathname] of [
			['POST', '/api/conductor/restart'],
			['POST', '/api/workspaces'],
			['POST', '/api/workspaces/w1/archive'],
			['POST', '/api/workspaces/w1/merge'],
			['POST', '/api/workspaces/w1/status'],
			['DELETE', '/api/sessions/s1'],
			['POST', '/api/sessions/s1/stop'],
			['POST', '/api/sessions/s1/agent'],
			['POST', '/api/nosleep'],
			['PATCH', '/api/settings'],
			['GET', '/api/logs'],
			['GET', '/api/settings']
		] as const) {
			expect(deviceMay('phone', method, pathname), `${method} ${pathname}`).toBe(false)
		}
	})

	it('refuses device management, so a phone cannot mint codes or revoke another device', () => {
		expect(deviceMay('phone', 'POST', '/api/devices/pairing-code')).toBe(false)
		expect(deviceMay('phone', 'GET', '/api/devices')).toBe(false)
		expect(deviceMay('phone', 'DELETE', '/api/devices/abc')).toBe(false)
	})

	it('matches the method, not just the path', () => {
		expect(deviceMay('phone', 'DELETE', '/api/state')).toBe(false)
		expect(deviceMay('phone', 'GET', '/api/sessions/s1/prompt')).toBe(false)
	})
})
