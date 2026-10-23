/**
 * One log line per prompt send, so "did that really come from the phone, and how did it end" has an
 * answer after the fact. Until now a send that simply worked left no trace at all — only a retry or a
 * repeated tap was logged — and the transcript row says *what* arrived but never *who sent it*.
 *
 * It records who, where and how it ended, and never the prompt itself: `/api/logs` serves these lines
 * to whoever holds a token, and a prompt is the one thing in here that may be private.
 */

export type SendOutcome = 'delivered' | 'parked' | 'failed'

export interface SendAudit {
	status: number
	sessionId: string
	/** The workspace's branch, else its id: what a person recognises in the sidebar. */
	workspace: string
	/** `admin` for the shared token, `device:<id>` for a paired phone. */
	by: string
	/** `phone` unless the caller said it is an agent (`x-relay-client: mcp`). */
	via: 'phone' | 'mcp'
	/** The phone's id for this tap, shortened — enough to match a repeat, not enough to replay it. */
	clientId?: string
	/** Answered from the repeat-tap memory rather than sent again. */
	replay: boolean
	ms: number
}

/** 200 is delivered, 202 is parked behind the lock screen, anything else did not land. */
export function sendOutcome(status: number): SendOutcome {
	if (status === 200) return 'delivered'
	if (status === 202) return 'parked'
	return 'failed'
}

/** Safe to print: control characters would let a branch name forge a second log line. */
function oneToken(value: string): string {
	let out = ''
	let inGap = false
	for (const ch of value) {
		const code = ch.charCodeAt(0)
		const unsafe = /\s/.test(ch) || code < 0x20 || code === 0x7f
		if (!unsafe) {
			out += ch
			inGap = false
		} else if (!inGap) {
			// A run of whitespace or control characters becomes one underscore.
			out += '_'
			inGap = true
		}
	}
	return out
}

export function formatSendAudit(a: SendAudit): string {
	const parts = [
		`[send] ${sendOutcome(a.status)}`,
		`session=${a.sessionId.slice(0, 8)}`,
		`workspace=${oneToken(a.workspace)}`,
		`by=${oneToken(a.by)}`,
		`via=${a.via}`,
		a.clientId ? `client=${oneToken(a.clientId.slice(0, 8))}` : 'client=-',
		a.replay ? 'replay=yes' : 'replay=no',
		`status=${a.status}`,
		`ms=${Math.max(0, Math.round(a.ms))}`
	]
	return parts.join(' ')
}
