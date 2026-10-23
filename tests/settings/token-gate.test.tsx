import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

// TokenGate reaches the app store and API module on import; static rendering needs only their
// boot-time browser globals, not a DOM (same approach as prompt-status-dot.test.tsx).
Object.defineProperty(globalThis, 'location', { configurable: true, value: { hash: '', pathname: '/', search: '' } })
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
})
Object.defineProperty(globalThis, 'history', { configurable: true, value: { replaceState: () => {} } })

const { TokenGate } = await import('../../web/src/components/settings/TokenGate.tsx')

/**
 * The gate is the only screen a phone without a credential can see, so what it offers is what a new
 * phone can do: the old ways in must survive, and the pairing code must be one of them.
 */
describe('TokenGate', () => {
	const html = renderToStaticMarkup(<TokenGate />)

	test('still takes a pasted token or URL and a scanned QR', () => {
		expect(html).toContain('aria-label="Access token or URL"')
		expect(html).toContain('Scan QR')
	})

	test('offers pairing with a one-time code and says the Mac can revoke it alone', () => {
		expect(html).toContain('aria-label="Pairing code"')
		expect(html).toContain('Pair this phone')
		expect(html).toContain('conductor-remote devices pair')
		expect(html).toContain('revoke')
	})

	test('does not pair before anything is typed', () => {
		// The pair button starts disabled; an empty code must not become a request.
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Pair this phone<\/button>/)
	})
})
