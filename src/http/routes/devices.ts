import { isRoute, routeParam, routes } from '../../routes.ts'
import { NOT_HANDLED, type RouteHandler } from '../router-types.ts'
import type { RelayServices } from '../services.ts'

/**
 * Device management. Every route here is outside `deviceMay`'s allowlist, so only the admin
 * (shared) token reaches it — a paired phone cannot mint a code or revoke its neighbour.
 */
export function createDevicesRoutes(services: Pick<RelayServices, 'json' | 'devices'>): RouteHandler {
	const { json, devices } = services
	return async (req, res, url) => {
		const { pathname } = url

		// POST /api/devices/pairing-code — a one-time code, shown once, valid for a few minutes.
		if (isRoute(routes.createPairingCode, req.method, pathname)) {
			return json(req, res, 200, devices.createPairingCode())
		}

		// GET /api/devices
		if (isRoute(routes.devices, req.method, pathname)) {
			return json(req, res, 200, { devices: devices.list() })
		}

		// DELETE /api/devices/:deviceId — takes effect on the device's next request.
		const deviceId = routeParam(routes.revokeDevice, req.method, pathname)
		if (deviceId !== null) {
			if (!devices.revoke(deviceId)) return json(req, res, 404, { error: 'no such device' })
			console.info(`[auth] revoked device ${deviceId}`)
			return json(req, res, 200, { ok: true })
		}

		return NOT_HANDLED
	}
}
