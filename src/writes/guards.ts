import { isLockedError } from '../shared.ts'
import { exec } from './ui-lock.ts'

/**
 * Failures no amount of retrying will fix, so a caller that retries can stop at
 * once instead of spending a whole budget to arrive at the same sentence.
 *
 * Matched on phrases this file writes itself — the first two from `refusalReason`,
 * the rest from the target checks below — never on macOS's own wording, which we
 * quote verbatim precisely because it drifts. The refusals are the ones a node
 * upgrade causes by silently revoking Accessibility: they fail instantly and
 * identically every time, so making the phone sit through a whole retry budget to
 * be told a permission is missing is worse than being told at once. The rest are
 * malformed targets — no session, no branch — which no attempt can turn into one.
 */
const TERMINAL_ERRORS = [
	'not trusted for Accessibility',
	'blocked the relay from controlling the UI',
	'no session id to target',
	'workspace has no branch to focus'
]

export function retryWontHelp(error: string | undefined): boolean {
	return error !== undefined && TERMINAL_ERRORS.some(phrase => error.includes(phrase))
}

/**
 * A send that failed because the Mac's screen is locked. Deliberately *not* in
 * `TERMINAL_ERRORS`: it isn't terminal (an unlock fixes it) but it also isn't a
 * warm-up cost a retry loop should burn budget on — the caller parks the prompt
 * instead (src/delivery/parked.ts) and the queue delivers it when the lock lifts. Matched
 * on the phrase every lock refusal in src/writes/applescript/window.applescript starts with; the
 * words are ours, so they can't drift under us the way macOS's can. The phrase
 * itself lives in src/shared.ts because the phone matches it too — it is what
 * puts the Screen Sharing link beside a refusal nobody else can clear.
 */
export function lockBlocked(error: string | undefined): boolean {
	return isLockedError(error)
}

/**
 * A run that ended with the prompt still sitting in Conductor's composer
 * (`submitComposer`). The draft was never consumed, so this run wrote no row and
 * the caller's confirm window has nothing to wait for — six seconds spent watching
 * for something the run already proved didn't happen. Only the *waiting* is
 * skipped: an earlier attempt's row can still be arriving, so the caller checks
 * once before typing again.
 *
 * Matched on the phrase the send script writes itself, like `lockBlocked` above,
 * so macOS wording can't drift under it.
 */
export function sendNeverStarted(error: string | undefined): boolean {
	return (error ?? '').includes('still sitting in its composer')
}

/**
 * Whether a failed run may nonetheless have put the prompt in Conductor: it finished without error but no
 * row has shown yet (Conductor writes it late when the Mac is starved), or the run was killed at its
 * ceiling, which can be after Enter. Either way "failed" is not a fact, and the phone must let the chat
 * settle it instead of leaving a red bubble beside a prompt that arrived.
 *
 * Matched on the sentence `osaError` writes for a kill, like the predicates above.
 */
export function sendMayHaveLanded(result: { ok: boolean; error?: string }): boolean {
	return result.ok || (result.error ?? '').startsWith('Conductor took too long to respond')
}

/**
 * Node's own read of the lock screen — the same CGSessionCopyCurrentDictionary
 * probe `screenLocked()` in src/writes/applescript/window.applescript makes, minus the AppleScript
 * wrapper, so the parked-prompt queue can poll it without spinning up a whole
 * UI script (and without needing Accessibility at all). `null` means the probe
 * itself failed — callers should treat that as "try the send and let it tell
 * you", not as either lock state.
 */
export async function screenLocked(): Promise<boolean | null> {
	// Keep in lockstep with `screenLocked()` in src/writes/applescript/window.applescript, traps and
	// all: $.CFBridgingRelease segfaults under JXA, and without the bindFunction
	// rebind deepUnwrap reads the CF dictionary as undefined — a silent "unlocked"
	// on a locked Mac.
	const jxa =
		"ObjC.import('CoreGraphics'); ObjC.bindFunction('CGSessionCopyCurrentDictionary', ['id', []]); const d = ObjC.deepUnwrap($.CGSessionCopyCurrentDictionary()) || {}; d.CGSSessionScreenIsLocked ? 'locked' : 'unlocked'"
	try {
		const { stdout } = await exec('osascript', ['-l', 'JavaScript', '-e', jxa], { timeout: 5_000 })
		const out = stdout.trim()
		if (out === 'locked') return true
		if (out === 'unlocked') return false
		return null
	} catch {
		return null
	}
}
