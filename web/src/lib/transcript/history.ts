import type { ChatHistoryLink, Session } from '../types.ts'

/** Oldest first, excluding the live chat. Tolerate a stale/corrupt link without looping. */
export function previousChats(sessionId: string | null, links: Record<string, ChatHistoryLink>): string[] {
	const result: string[] = []
	const seen = new Set(sessionId ? [sessionId] : [])
	let id = sessionId ? links[sessionId]?.previousSessionId : undefined
	while (id && !seen.has(id)) {
		seen.add(id)
		result.unshift(id)
		id = links[id]?.previousSessionId
	}
	return result
}

/** previous chat → the chat that continued it. */
function successors(links: Record<string, ChatHistoryLink>): Map<string, string> {
	return new Map(Object.entries(links).map(([id, link]) => [link.previousSessionId, id]))
}

/**
 * Links and notifications for an earlier context still open the same conversation.
 *
 * `open` is the ids Conductor still has as tabs. Given it, the answer is the newest context *that is open*,
 * so a link to a successor that was closed (or never got a message) does not send a notification or a pick
 * to a chat nobody can see. Without it, the end of the chain, as before.
 */
export function latestChat(
	sessionId: string | null,
	links: Record<string, ChatHistoryLink>,
	open?: ReadonlySet<string>
): string | null {
	const next = successors(links)
	const seen = new Set<string>()
	let id = sessionId
	let latestOpen = sessionId && open?.has(sessionId) ? sessionId : null
	while (id && next.has(id) && !seen.has(id)) {
		seen.add(id)
		id = next.get(id) ?? id
		if (open?.has(id)) latestOpen = id
	}
	return open ? (latestOpen ?? id) : id
}

/**
 * Only the newest context gets a tab; status and sends still address its real session id.
 *
 * "Newest" means newest *open* one. A context is folded into a later one only while that later context is
 * itself a tab: the link is the phone's own, Conductor knows nothing of it, so a successor closed on the Mac
 * (or created by a handoff whose send failed) must not take the conversation with it. Before, the phone showed
 * "No active session" for a workspace whose earlier chat was still open on the Mac.
 */
export function conversationTabs(sessions: Session[], links: Record<string, ChatHistoryLink>): Session[] {
	const open = new Set(sessions.map(session => session.id))
	const next = successors(links)
	const hasOpenSuccessor = (id: string): boolean => {
		const seen = new Set([id])
		for (let successor = next.get(id); successor && !seen.has(successor); successor = next.get(successor)) {
			if (open.has(successor)) return true
			seen.add(successor)
		}
		return false
	}
	return sessions
		.filter(session => !hasOpenSuccessor(session.id))
		.map(session => {
			const link = links[session.id]
			return link ? { ...session, title: link.title || session.title, created_at: link.createdAt } : session
		})
		.sort((a, b) => a.created_at.localeCompare(b.created_at))
}
