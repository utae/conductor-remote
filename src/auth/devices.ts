import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { stateDir } from '../config.ts'
import { isRoute, type Route0, type Route1, routeParam, routes } from '../routes.ts'

/**
 * Per-device credentials, so one lost phone can be cut off without re-issuing the token every
 * other device and `conductor-remote mcp` hold.
 *
 * The shared token stays what it was — the admin credential, accepted everywhere — and a device
 * token is the narrower thing a phone is handed once it has paired. Only a hash is stored, a
 * revoked record is kept (so a repeat is distinguishable from an unknown id) and refuses at once.
 *
 * The file is shared by the daemon and the `conductor-remote devices` CLI, which are different
 * processes, so it is re-read when it changes on disk rather than cached for the daemon's life:
 * a revoke from the CLI has to take effect on the very next request.
 */

/** `phone` is read-and-send: what the Android MVP needs and nothing that changes the Mac. */
export type DeviceScope = 'phone'

export interface DeviceRecord {
	id: string
	name: string
	/** sha256 of the secret half of the token, hex. The token itself is never stored. */
	secretHash: string
	scope: DeviceScope
	createdAt: number
	revokedAt: number | null
}

/** What a caller may see: everything but the hash. */
export type DeviceInfo = Omit<DeviceRecord, 'secretHash'>

interface PairingCode {
	/** sha256 of the code, hex. */
	hash: string
	expiresAt: number
}

interface DeviceFile {
	version: 1
	devices: DeviceRecord[]
	codes: PairingCode[]
}

/** Long enough to type from a QR fallback, short enough that an unused code is not a standing credential. */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000
/** A backstop on outstanding codes, so a loop minting them cannot grow the file without bound. */
const MAX_OUTSTANDING_CODES = 5
const MAX_DEVICE_NAME = 40

function sha256(text: string): string {
	return crypto.createHash('sha256').update(text).digest('hex')
}

function sameHash(a: string, b: string): boolean {
	const x = Buffer.from(a, 'hex')
	const y = Buffer.from(b, 'hex')
	return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

function emptyFile(): DeviceFile {
	return { version: 1, devices: [], codes: [] }
}

export function devicesFilePath(): string {
	return path.join(stateDir(), 'devices.json')
}

export class DeviceStore {
	private readonly file: string
	private readonly now: () => number
	private cache: { stamp: string; data: DeviceFile } | null = null

	constructor(file: string = devicesFilePath(), now: () => number = Date.now) {
		this.file = file
		this.now = now
	}

	private read(): DeviceFile {
		let stamp = 'missing'
		try {
			const stat = fs.statSync(this.file)
			stamp = `${stat.mtimeMs}:${stat.size}`
		} catch {
			this.cache = null
			return emptyFile()
		}
		if (this.cache?.stamp === stamp) return this.cache.data
		try {
			const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<DeviceFile>
			const data: DeviceFile = {
				version: 1,
				devices: Array.isArray(parsed.devices) ? parsed.devices : [],
				codes: Array.isArray(parsed.codes) ? parsed.codes : []
			}
			this.cache = { stamp, data }
			return data
		} catch {
			// A torn or hand-edited file must not turn into "every device is valid" or a crash loop:
			// an unreadable registry authorises nobody, and the shared token still works.
			console.warn(`[auth] could not read ${this.file}; no device credentials are accepted until it is fixed`)
			return emptyFile()
		}
	}

	private write(data: DeviceFile): void {
		fs.mkdirSync(path.dirname(this.file), { recursive: true })
		const tmp = `${this.file}.${process.pid}.tmp`
		fs.writeFileSync(tmp, JSON.stringify(data, null, '\t'), { mode: 0o600 })
		fs.renameSync(tmp, this.file)
		this.cache = null
	}

	/** Mint a one-time code a phone can trade for a device token. Returned once; only its hash is kept. */
	createPairingCode(): { code: string; expiresAt: number } {
		const data = this.read()
		const now = this.now()
		const live = data.codes.filter(c => c.expiresAt > now).slice(-(MAX_OUTSTANDING_CODES - 1))
		const code = crypto.randomBytes(9).toString('base64url')
		const expiresAt = now + PAIRING_CODE_TTL_MS
		this.write({ ...data, codes: [...live, { hash: sha256(code), expiresAt }] })
		return { code, expiresAt }
	}

	/**
	 * Trade a pairing code for a device. The code is spent whether or not anything else fails,
	 * and an expired or unknown one answers null without saying which.
	 */
	pair(code: string, name: string): { device: DeviceInfo; token: string } | null {
		const data = this.read()
		const now = this.now()
		const hash = sha256(code)
		const match = data.codes.find(c => c.expiresAt > now && sameHash(c.hash, hash))
		if (!match) return null
		const id = crypto.randomBytes(6).toString('hex')
		const secret = crypto.randomBytes(24).toString('base64url')
		const record: DeviceRecord = {
			id,
			name: name.trim().slice(0, MAX_DEVICE_NAME) || 'Phone',
			secretHash: sha256(secret),
			scope: 'phone',
			createdAt: now,
			revokedAt: null
		}
		this.write({
			version: 1,
			devices: [...data.devices, record],
			codes: data.codes.filter(c => c !== match && c.expiresAt > now)
		})
		const { secretHash: _secretHash, ...device } = record
		return { device, token: `${id}.${secret}` }
	}

	/** The device a token belongs to, or null. A revoked device is null: it never authenticates again. */
	verify(token: string): DeviceInfo | null {
		const dot = token.indexOf('.')
		if (dot < 1) return null
		const id = token.slice(0, dot)
		const record = this.read().devices.find(d => d.id === id)
		// Hash even when the id is unknown, so the miss costs what a hit costs.
		const candidate = sha256(token.slice(dot + 1))
		if (!record || !sameHash(record.secretHash, candidate) || record.revokedAt !== null) return null
		const { secretHash: _secretHash, ...device } = record
		return device
	}

	list(): DeviceInfo[] {
		return this.read().devices.map(({ secretHash: _secretHash, ...device }) => device)
	}

	/** Revoke by id. False for an unknown id; revoking an already-revoked device is a success that changes nothing. */
	revoke(id: string): boolean {
		const data = this.read()
		const record = data.devices.find(d => d.id === id)
		if (!record) return false
		if (record.revokedAt === null) {
			this.write({
				...data,
				devices: data.devices.map(d => (d.id === id ? { ...d, revokedAt: this.now() } : d))
			})
		}
		return true
	}
}

// ── what a `phone` device may call ──────────────────────────────────────────────

const PHONE_FLAT: Route0[] = [
	routes.state,
	routes.connection,
	routes.search,
	routes.repos,
	routes.prefs,
	routes.updatePrefs,
	routes.push,
	routes.pushSubscribe,
	routes.pushUnsubscribe
]

const PHONE_PARAM: Route1[] = [
	routes.repoIcon,
	routes.localImage,
	routes.filePreview,
	routes.toolImage,
	routes.workspace,
	routes.sessions,
	routes.closedSessions,
	routes.diff,
	routes.fileDiff,
	routes.workspaceFiles,
	routes.messages,
	routes.context,
	routes.sendPrompt,
	routes.dismissParkedPrompt
]

/**
 * An allowlist, not a denylist: a route added later is closed to a phone until someone decides
 * otherwise. Everything that changes the Mac or its workspaces (create, archive, merge, status,
 * restart, keep-awake, settings, MCP) is absent, as are device management and the logs.
 *
 * The send route still accepts the optional `agent` patch in its body, so a device can change a
 * chat's model or effort *through a send*; scoping that needs the body, not the path.
 */
export function deviceMay(scope: DeviceScope, method: string | undefined, pathname: string): boolean {
	if (scope !== 'phone') return false
	return (
		PHONE_FLAT.some(route => isRoute(route, method, pathname)) ||
		PHONE_PARAM.some(route => routeParam(route, method, pathname) !== null)
	)
}
