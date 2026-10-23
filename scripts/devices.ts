// `conductor-remote devices [pair | list | revoke <id>]` — manage which phones may reach this relay.
//
// Works on the same `devices.json` the daemon reads, and the daemon re-reads it when it changes,
// so a revoke here takes effect on the device's very next request with no restart. Only the
// shared token (admin) can do this; a paired device cannot. Strip-clean (plain-node
// type-stripping), stdlib-only — see AGENTS.md.

import { DeviceStore, PAIRING_CODE_TTL_MS } from '../src/auth/devices.ts'

const [sub = 'list', arg] = process.argv.slice(2)
const store = new DeviceStore()

function when(ms: number): string {
	return new Date(ms).toLocaleString()
}

switch (sub) {
	case 'pair': {
		const { code, expiresAt } = store.createPairingCode()
		console.info(`pairing code: ${code}`)
		console.info(`valid once, for ${PAIRING_CODE_TTL_MS / 60_000} minutes (until ${when(expiresAt)})`)
		console.info('The phone trades it at POST /api/devices/pair { code, name } for its own device token.')
		break
	}
	case 'list': {
		const devices = store.list()
		if (devices.length === 0) {
			console.info('no paired devices')
			break
		}
		for (const d of devices) {
			const state = d.revokedAt === null ? 'active' : `revoked ${when(d.revokedAt)}`
			console.info(`${d.id}  ${d.name}  [${d.scope}]  paired ${when(d.createdAt)}  ${state}`)
		}
		break
	}
	case 'revoke': {
		if (!arg) {
			console.error('usage: conductor-remote devices revoke <id>')
			process.exit(1)
		}
		if (!store.revoke(arg)) {
			console.error(`no such device: ${arg}`)
			process.exit(1)
		}
		console.info(`revoked ${arg}`)
		break
	}
	default:
		console.error(`unknown devices subcommand: ${sub}\nusage: conductor-remote devices [pair | list | revoke <id>]`)
		process.exit(1)
}
