import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ConnectionReason } from '../wire.ts'
import { screenLocked } from '../writes/guards.ts'

const run = promisify(execFile) as (
	command: string,
	args: string[],
	options?: { timeout?: number; maxBuffer?: number }
) => Promise<{ stdout: string; stderr: string }>

/**
 * The app's own executable, as `ps -o comm=` prints it (a full path on macOS), compared
 * lowercase: the bundle is `Conductor.app` but its binary is `conductor` (measured), and
 * a case-sensitive match called a running app dead.
 */
const CONDUCTOR_EXECUTABLE = '/conductor.app/contents/macos/conductor'

/** Is the Conductor app's main process in a `ps -axo comm=` listing. */
export function listsConductorProcess(psComm: string): boolean {
	return psComm.split('\n').some(line => line.trim().toLowerCase().endsWith(CONDUCTOR_EXECUTABLE))
}

/**
 * Why a send cannot be expected to land right now, most fundamental first. A locked Mac
 * outranks everything because the lock screen hides the whole session from Accessibility
 * (a process and even a window can exist behind it), and `null` means a probe could not
 * say — never a verdict. Permissions are deliberately absent: telling "Accessibility
 * revoked" from the rest needs an AX read, and the first send reports it in the phone's
 * own words (src/writes/guards.ts ▸ `retryWontHelp`).
 */
export function connectionReason(probe: {
	locked: boolean | null
	running: boolean | null
	windows: number | null
}): ConnectionReason {
	if (probe.locked === true) return 'locked'
	if (probe.running === false) return 'conductor_not_running'
	if (probe.windows === 0) return 'no_window'
	if (probe.running === null || probe.windows === null || probe.locked === null) return 'unknown'
	return 'ok'
}

async function conductorRunning(): Promise<boolean | null> {
	try {
		const { stdout } = await run('ps', ['-axo', 'comm='], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 })
		return listsConductorProcess(stdout)
	} catch {
		return null
	}
}

/**
 * Windows Conductor owns across every Space, from the window server. Same probe as
 * `serverWindowCount()` in src/writes/applescript/window.applescript, traps included:
 * `$.CFBridgingRelease` segfaults the osascript child, and without the `bindFunction`
 * rebind JXA types the CF array as a bare pointer that `deepUnwrap` reads as undefined.
 * Owner and layer need no Screen Recording grant and no Accessibility, and it draws nothing.
 */
async function conductorWindowCount(): Promise<number | null> {
	const jxa =
		"ObjC.import('CoreGraphics'); ObjC.bindFunction('CGWindowListCopyWindowInfo', ['id', ['unsigned int', 'unsigned int']]); const w = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(0, 0)) || []; w.filter(x => x.kCGWindowOwnerName === 'Conductor' && x.kCGWindowLayer === 0).length"
	try {
		const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', jxa], { timeout: 5_000 })
		const count = Number.parseInt(stdout.trim(), 10)
		return Number.isFinite(count) ? count : null
	} catch {
		return null
	}
}

export interface ConductorStatus {
	running: boolean | null
	/** Windows across every Space; `null` when the probe could not say. */
	windows: number | null
	locked: boolean | null
	reason: ConnectionReason
}

/**
 * Run a probe, and once more if it could not answer (`null`). Each probe takes 30–70ms when it
 * works, so a `null` is a spawn that lost a race with a busy relay and a second try is cheap — and
 * without it one 5s timeout turned a healthy Mac into `unknown` / `sendReady: false` (measured:
 * 4 of 20 calls in the minutes after a deploy). Only a definite answer, `false` included, ends it.
 * It cannot help when the whole event loop is stalled; it only stops one slow probe deciding the verdict.
 */
export async function retryOnce<T>(probe: () => Promise<T | null>): Promise<T | null> {
	const first = await probe()
	return first !== null ? first : probe()
}

/** Read-only: three concurrent probes, none of which focuses, opens or presses anything. */
export async function readConductorStatus(): Promise<ConductorStatus> {
	const [running, windows, locked] = await Promise.all([
		retryOnce(conductorRunning),
		retryOnce(conductorWindowCount),
		retryOnce(screenLocked)
	])
	return { running, windows, locked, reason: connectionReason({ locked, running, windows }) }
}
