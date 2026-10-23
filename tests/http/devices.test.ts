/**
 * The HTTP boundary of device credentials: who gets in, who is held to scope, and that revoking a
 * device ends its access on the next request. Uses the real router with a registry in a temp file,
 * so nothing here touches the relay's own state directory.
 */
import { once } from 'node:events'
import fs from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DeviceStore } from '../../src/auth/devices.ts'
import type { Config } from '../../src/config.ts'
import { createRelayServer } from '../../src/http/router.ts'
import { createMcpServices } from '../../src/http/services/mcp.ts'
import { createResponsesServices } from '../../src/http/services/responses.ts'
import type { RelayServices } from '../../src/http/services.ts'

const adminToken = 'devices-test-admin-token'
const servers: Server[] = []
let directory: string

beforeEach(() => {
	directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devices-http-test-'))
})

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(server => {
			server.closeAllConnections()
			return new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
		})
	)
	fs.rmSync(directory, { recursive: true, force: true })
})

async function start() {
	const cfg: Config = {
		token: adminToken,
		dbPath: '/unused/conductor.db',
		workspacesRoot: '/unused/workspaces',
		publicDir: '/unused/public',
		port: 0,
		host: '127.0.0.1',
		writeStrategy: 'applescript',
		preventScreenLock: false
	}
	const devices = new DeviceStore(path.join(directory, 'devices.json'))
	const responses = createResponsesServices({ cfg, devices })
	const services = {
		cfg,
		...responses,
		...createMcpServices({ cfg, ...responses }),
		workflowHttpError: vi.fn(() => null),
		serveStatic: vi.fn(),
		reads: { listRepos: vi.fn(() => [{ id: 'repo-1', name: 'example', root_path: '/unused/repo' }]) }
	} as unknown as RelayServices
	const server = createRelayServer(services)
	servers.push(server)
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	const request = (pathname: string, init: RequestInit & { bearer?: string | null } = {}) => {
		const { bearer = adminToken, ...rest } = init
		return fetch(`${base}${pathname}`, {
			...rest,
			signal: AbortSignal.timeout(5_000),
			headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...rest.headers }
		})
	}
	return { request, devices }
}

async function pairPhone(request: Awaited<ReturnType<typeof start>>['request']) {
	const minted = await request('/api/devices/pairing-code', { method: 'POST' })
	const { code } = (await minted.json()) as { code: string }
	const paired = await request('/api/devices/pair', {
		method: 'POST',
		bearer: null,
		body: JSON.stringify({ code, name: 'Galaxy' })
	})
	return { paired, code }
}

describe('pairing over HTTP', () => {
	test('trades a code for a token without any credential, and the token then reads', async () => {
		const { request } = await start()
		const { paired } = await pairPhone(request)
		expect(paired.status).toBe(200)
		const { token, device } = (await paired.json()) as { token: string; device: { id: string; name: string } }
		expect(device.name).toBe('Galaxy')

		const read = await request('/api/repos', { bearer: token })
		expect(read.status).toBe(200)
	})

	test('refuses a spent code and throttles repeated failures', async () => {
		const { request } = await start()
		const { code } = await pairPhone(request)
		const again = await request('/api/devices/pair', { method: 'POST', bearer: null, body: JSON.stringify({ code }) })
		expect(again.status).toBe(401)

		let last = again
		for (let i = 0; i < 12; i++) {
			last = await request('/api/devices/pair', { method: 'POST', bearer: null, body: JSON.stringify({ code: 'x' }) })
		}
		expect(last.status).toBe(429)
		expect(last.headers.get('retry-after')).toBe('60')
	})

	test('rejects malformed pairing bodies', async () => {
		const { request } = await start()
		const bad = await request('/api/devices/pair', { method: 'POST', bearer: null, body: '{nope' })
		expect(bad.status).toBe(400)
		const missing = await request('/api/devices/pair', { method: 'POST', bearer: null, body: '{}' })
		expect(missing.status).toBe(401)
	})
})

describe('scope over HTTP', () => {
	test('holds a device to its allowlist with 403, while the admin token still reaches everything', async () => {
		const { request } = await start()
		const { paired } = await pairPhone(request)
		const { token } = (await paired.json()) as { token: string }

		const restart = await request('/api/conductor/restart', { method: 'POST', bearer: token })
		expect(restart.status).toBe(403)
		const manage = await request('/api/devices', { bearer: token })
		expect(manage.status).toBe(403)
		const mint = await request('/api/devices/pairing-code', { method: 'POST', bearer: token })
		expect(mint.status).toBe(403)

		const admin = await request('/api/devices')
		expect(admin.status).toBe(200)
	})

	test('keeps device tokens out of the MCP endpoint and out of the query string', async () => {
		const { request } = await start()
		const { paired } = await pairPhone(request)
		const { token } = (await paired.json()) as { token: string }

		const mcp = await request('/mcp', { method: 'POST', bearer: token, body: '{}' })
		expect(mcp.status).toBe(401)
		const query = await request(`/api/repos?token=${encodeURIComponent(token)}`, { bearer: null })
		expect(query.status).toBe(401)
	})

	test('rejects a request with no credential or a made-up device token', async () => {
		const { request } = await start()
		expect((await request('/api/repos', { bearer: null })).status).toBe(401)
		expect((await request('/api/repos', { bearer: 'aaaaaaaaaaaa.bbbb' })).status).toBe(401)
	})
})

describe('revocation over HTTP', () => {
	test('ends a device’s access on its next request, and lists it as revoked', async () => {
		const { request } = await start()
		const { paired } = await pairPhone(request)
		const { token, device } = (await paired.json()) as { token: string; device: { id: string } }
		expect((await request('/api/repos', { bearer: token })).status).toBe(200)

		const revoked = await request(`/api/devices/${device.id}`, { method: 'DELETE' })
		expect(revoked.status).toBe(200)
		expect((await request('/api/repos', { bearer: token })).status).toBe(401)

		const listed = (await (await request('/api/devices')).json()) as {
			devices: { id: string; revokedAt: number | null; secretHash?: string }[]
		}
		expect(listed.devices[0].id).toBe(device.id)
		expect(listed.devices[0].revokedAt).not.toBeNull()
		expect(listed.devices[0].secretHash).toBeUndefined()
	})

	test('answers 404 for an unknown device', async () => {
		const { request } = await start()
		expect((await request('/api/devices/nope', { method: 'DELETE' })).status).toBe(404)
	})
})
