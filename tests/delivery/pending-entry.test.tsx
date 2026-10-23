import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { PendingMessage } from '../../web/src/lib/prompts/pending.ts'

// entries.tsx reaches the app store and API module on import; static rendering needs only
// their boot-time browser globals, not a DOM (same approach as prompt-status-dot.test.tsx).
Object.defineProperty(globalThis, 'location', { configurable: true, value: { hash: '', pathname: '/', search: '' } })
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
})
Object.defineProperty(globalThis, 'history', { configurable: true, value: { replaceState: () => {} } })

const { PendingEntry } = await import('../../web/src/components/transcript/entries.tsx')

const pending = (over: Partial<PendingMessage> = {}): PendingMessage => ({
	id: 'a1',
	sessionId: 's1',
	workspaceId: 'w1',
	text: 'ship the thing',
	status: 'error',
	error: 'Send failed',
	createdAt: 1,
	...over
})

const render = (p: PendingMessage) =>
	renderToStaticMarkup(<PendingEntry p={p} onRetry={() => undefined} onDismiss={() => undefined} />)

/**
 * A prompt that landed while the phone never heard back used to read "Failed to fetch" in red, which
 * is the one thing PRD §5 says the app must not claim before it knows. Pin the three looks apart.
 */
describe('PendingEntry', () => {
	test('a lost answer says it is checking, not that it failed, and still offers Retry', () => {
		const html = render(pending({ unsure: true, error: 'Failed to fetch' }))
		expect(html).toContain('data-msg-state="checking"')
		expect(html).toContain('checking the chat')
		expect(html).toContain('Retry')
		expect(html).not.toContain('Failed to fetch')
		expect(html).not.toContain('border-del')
	})

	test('a restored in-flight send reads the same way', () => {
		expect(render(pending({ interrupted: true }))).toContain('data-msg-state="checking"')
	})

	test('a refusal the relay stood behind stays a red failure with its reason', () => {
		const html = render(pending({ error: 'workspace for session not found' }))
		expect(html).toContain('data-msg-state="failed"')
		expect(html).toContain('workspace for session not found')
		expect(html).toContain('border-del')
		expect(html).toContain('Retry')
	})

	test('a send still in flight shows no actions', () => {
		const html = render(pending({ status: 'sending', error: undefined }))
		expect(html).toContain('data-msg-state="sending"')
		expect(html).not.toContain('Retry')
	})
})
