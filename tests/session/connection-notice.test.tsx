import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { connectionNotice } from '../../web/src/lib/connection.ts'
import type { ConnectionResponse } from '../../web/src/lib/types.ts'

// SessionNotices reaches the app store and API module through ui.tsx; static rendering needs only
// their boot-time browser globals, not a DOM (same approach as prompt-status-dot.test.tsx).
Object.defineProperty(globalThis, 'location', {
	configurable: true,
	value: { hash: '', pathname: '/', search: '', hostname: 'mac.example.ts.net' }
})
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
})
Object.defineProperty(globalThis, 'history', { configurable: true, value: { replaceState: () => {} } })

const { ConnectionStrip } = await import('../../web/src/components/session/SessionNotices.tsx')

const connection = (reason: ConnectionResponse['reason']): ConnectionResponse => ({
	relay: 'ok',
	conductor: { running: true, windows: 1, locked: false },
	reason,
	sendReady: reason === 'ok',
	actuator: { name: 'applescript', caveat: '', precise: true, available: true }
})

/**
 * What matters here is the silence: a strip that appears for `ok`, for a probe that merely failed
 * to answer, or for stale data is a warning over a healthy Mac, and people stop reading it.
 */
describe('connectionNotice', () => {
	test('says nothing when the Mac is fine, when a probe could not answer, or when there is no data yet', () => {
		expect(connectionNotice(connection('ok'))).toBeNull()
		expect(connectionNotice(connection('unknown'))).toBeNull()
		expect(connectionNotice(undefined)).toBeNull()
	})

	test('names each cause separately and offers the unlock hand-off only for the lock', () => {
		const locked = connectionNotice(connection('locked'))
		const closed = connectionNotice(connection('conductor_not_running'))
		const windowless = connectionNotice(connection('no_window'))
		expect(locked?.unlock).toBe(true)
		expect(closed?.unlock).toBe(false)
		expect(windowless?.unlock).toBe(false)
		expect(new Set([locked?.text, closed?.text, windowless?.text]).size).toBe(3)
	})
})

describe('ConnectionStrip', () => {
	test('renders nothing without a notice', () => {
		expect(renderToStaticMarkup(<ConnectionStrip notice={null} />)).toBe('')
	})

	test('a locked Mac gets the status strip with the unlock link', () => {
		const html = renderToStaticMarkup(<ConnectionStrip notice={connectionNotice(connection('locked'))} />)
		expect(html).toContain('role="status"')
		expect(html).toContain('data-connection-reason="locked"')
		expect(html).toContain('The Mac is locked')
		expect(html).toContain('Unlock the Mac')
	})

	test('a closed Conductor gets the strip without an unlock link', () => {
		const html = renderToStaticMarkup(
			<ConnectionStrip notice={connectionNotice(connection('conductor_not_running'))} />
		)
		expect(html).toContain('data-connection-reason="conductor_not_running"')
		expect(html).toContain('isn’t running')
		expect(html).not.toContain('Unlock the Mac')
	})
})
