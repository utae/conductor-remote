import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ChatHistoryStore } from '../../src/transcript/chat-history.ts'
import type { Session } from '../../src/wire.ts'
import { conversationTabs, latestChat, previousChats } from '../../web/src/lib/transcript/history.ts'

let directory: string
let file: string
beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), 'chat-history-'))
	file = path.join(directory, 'chat-history.json')
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
const source = { title: 'Original conversation', created_at: '2026-09-01 12:00:00' }
const session = (id: string, created_at: string) => ({ id, created_at, title: id, status: 'idle' }) as Session

describe('stitched chat history', () => {
	test('survives relay restarts and repeated compactions without copying any messages', () => {
		const store = new ChatHistoryStore(file)
		store.join('workspace', 'a', 'b', source)
		store.join('workspace', 'b', 'c', { title: 'Fresh context', created_at: '2026-09-02 12:00:00' })
		const reloaded = new ChatHistoryStore(file)
		const links = reloaded.forWorkspace('workspace')
		expect(previousChats('c', links)).toEqual(['a', 'b'])
		expect(latestChat('a', links)).toBe('c')
		expect(latestChat('b', links)).toBe('c')
		expect(links.c).toEqual({ previousSessionId: 'b', title: source.title, createdAt: source.created_at })
		expect(reloaded.forWorkspace('another-workspace')).toEqual({})
	})

	test('a retry is idempotent; cycles and branching replacements are rejected', () => {
		const store = new ChatHistoryStore(file)
		expect(() => store.join('workspace', 'a', 'a', source)).toThrow('cycle')
		expect(existsSync(file)).toBe(false)
		store.join('workspace', 'a', 'b', source)
		store.join('workspace', 'a', 'b', source)
		expect(() => store.join('workspace', 'b', 'a', source)).toThrow('cycle')
		expect(() => store.join('workspace', 'a', 'c', source)).toThrow('already continues')
		expect(() => store.join('other-workspace', 'b', 'c', source)).toThrow('share a workspace')
		expect(Object.keys(store.forWorkspace('workspace'))).toEqual(['b'])
	})

	test('keeps one tab at the original position, with the newest context status and normal forks alongside', () => {
		const store = new ChatHistoryStore(file)
		store.join('workspace', 'a', 'b', source)
		store.join('workspace', 'b', 'c', source)
		const chats = [
			session('a', source.created_at),
			session('unrelated-fork', '2026-09-01 13:00:00'),
			session('b', '2026-09-02 12:00:00'),
			{ ...session('c', '2026-09-03 12:00:00'), status: 'working' }
		]
		const tabs = conversationTabs(chats, store.forWorkspace('workspace'))
		expect(tabs.map(chat => chat.id)).toEqual(['c', 'unrelated-fork'])
		expect(tabs[0]).toMatchObject({ title: source.title, status: 'working', created_at: source.created_at })
		expect(chats[3].title).toBe('c')
		// Closing the latest real tab used to close the whole conversation on the phone while the earlier
		// contexts were still open on the Mac ("No active session" next to a visible tab). The link is the phone's
		// own, so it only folds a context into a later one while that later one is itself a tab.
		const afterClosingLatest = conversationTabs(chats.slice(0, -1), store.forWorkspace('workspace'))
		expect(afterClosingLatest.map(chat => chat.id)).toEqual(['b', 'unrelated-fork'])
		expect(afterClosingLatest[0]).toMatchObject({ title: source.title, created_at: source.created_at })
	})

	test('a successor closed on the Mac leaves the earlier chat as the tab (measured 2026-10-25, pla-5932)', () => {
		// 98c2f959 "PLA-5932 작업" stayed open; its handoff chat 5b5f0668 was closed after a send to it failed.
		const store = new ChatHistoryStore(file)
		store.join('workspace', 'old', 'handoff', { title: 'PLA-5932 작업', created_at: '2026-10-24T00:58:57.701Z' })
		const links = store.forWorkspace('workspace')
		const open = [session('old', '2026-10-24T00:58:57.701Z')]
		expect(conversationTabs(open, links).map(chat => chat.id)).toEqual(['old'])
		// While the handoff chat *is* open it still takes over the tab, as designed.
		const both = [...open, session('handoff', '2026-10-25T01:02:52.393Z')]
		expect(conversationTabs(both, links).map(chat => chat.id)).toEqual(['handoff'])
	})

	test('a closed middle context does not revive the first one while the newest is open', () => {
		const store = new ChatHistoryStore(file)
		store.join('workspace', 'a', 'b', source)
		store.join('workspace', 'b', 'c', source)
		const links = store.forWorkspace('workspace')
		const tabs = conversationTabs([session('a', source.created_at), session('c', '2026-09-03 12:00:00')], links)
		expect(tabs.map(chat => chat.id)).toEqual(['c'])
	})

	test('latestChat lands on the newest chat that is open, and falls back to the chain end when none is', () => {
		const store = new ChatHistoryStore(file)
		store.join('workspace', 'a', 'b', source)
		store.join('workspace', 'b', 'c', source)
		const links = store.forWorkspace('workspace')
		expect(latestChat('a', links)).toBe('c')
		expect(latestChat('a', links, new Set(['a', 'b', 'c']))).toBe('c')
		expect(latestChat('a', links, new Set(['a', 'b']))).toBe('b')
		expect(latestChat('a', links, new Set(['a']))).toBe('a')
		// Nothing open at all: the old answer, so a caller that checks membership falls through as before.
		expect(latestChat('a', links, new Set())).toBe('c')
		expect(latestChat(null, links, new Set(['a']))).toBeNull()
	})

	test('a corrupt cycle in the links cannot hang either helper', () => {
		const links = {
			a: { previousSessionId: 'b', title: 't', createdAt: '2026-09-01 12:00:00' },
			b: { previousSessionId: 'a', title: 't', createdAt: '2026-09-01 12:00:00' }
		}
		expect(() => conversationTabs([session('a', 'x'), session('b', 'y')], links)).not.toThrow()
		expect(() => latestChat('a', links, new Set(['a']))).not.toThrow()
	})
})
