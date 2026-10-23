import type { ConnectionResponse } from './types.ts'

/** What the strip above the composer says, and whether the lock hand-off belongs beside it. */
export interface ConnectionNotice {
	reason: 'locked' | 'conductor_not_running' | 'no_window'
	text: string
	/** The lock is the one cause the phone can act on, by linking to the Mac's screen sharing. */
	unlock: boolean
}

/**
 * The strip is for the Mac, not for the phone: a phone that cannot reach the relay never gets an
 * answer to show (`RelayUnreachable` in components/ui.tsx covers that), so this only names what
 * `GET /api/connection` found *behind* a reachable relay.
 *
 * `ok` says nothing, and so does `unknown` — a probe that could not answer is not a verdict, and
 * one that flickers would put a warning over a healthy Mac. An unavailable write strategy is
 * a different problem that the Connect sheet already shows, so it is not repeated here either.
 */
export function connectionNotice(connection: ConnectionResponse | undefined): ConnectionNotice | null {
	switch (connection?.reason) {
		case 'locked':
			return { reason: 'locked', text: 'The Mac is locked, so messages wait until it is unlocked.', unlock: true }
		case 'conductor_not_running':
			return {
				reason: 'conductor_not_running',
				text: 'Conductor isn’t running on the Mac, so a message can’t be delivered until it is open.',
				unlock: false
			}
		case 'no_window':
			return {
				reason: 'no_window',
				text: 'Conductor has no open window on the Mac, so a message may not be delivered. Open it there.',
				unlock: false
			}
		default:
			return null
	}
}
