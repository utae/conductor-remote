import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile) as (
	command: string,
	args: string[],
	options?: { timeout?: number; maxBuffer?: number }
) => Promise<{ stdout: string; stderr: string }>

/** Both reads together may not outlast a retry: a wedged Conductor hangs AX reads, and this runs mid-send. */
const PROBE_TIMEOUT_MS = 6_000

/**
 * Is this the "Conductor has a window but its content isn't there" failure — an `Invalid index` raised
 * while walking `UI element N of … window 1` (`webArea()` in window.applescript). macOS words it in the
 * user's language (the Korean `유효하지 않은 인덱스` is what reached a phone), so both spellings count, and the
 * `UI element N of` path is required so an unrelated "Invalid index" never starts a diagnosis.
 * Deliberately not the no-window case: that one is named in words by `windowFailure`.
 */
export function isAxTreeFailure(error: string | undefined): boolean {
	if (!error) return false
	return /UI element \d+ of/.test(error) && /Invalid index|유효하지 않은 인덱스/.test(error)
}

/** What the window server and the displays say, as `readWindowServer` reports it. */
export interface WindowServerFacts {
	displays: number | null
	/** Conductor windows taller than a title bar; the app also keeps many 30px-high ones. */
	mainWindows: { x: number; y: number; w: number; h: number; onscreen: boolean; onDisplay: boolean }[]
	thinWindows: number
}

export interface WindowDiagnostics {
	/** `front=… windows=… win1=@x,y WxH tree=1>1>1>1>3`, or null when the AX read could not run. */
	ax: string | null
	server: WindowServerFacts | null
}

/**
 * One log line. `tree` is the child count at each level of the path `webArea()` walks — window 1, then four
 * nested containers, then the web area's own children — so a healthy window reads `1>1>1>1>3` and the
 * failure this exists for reads shorter (`1>1>0`): the level where the numbers stop is the answer.
 * Never prints a window title or any chat text; the frontmost app's name is the only free text.
 */
export function formatWindowDiagnostics(d: WindowDiagnostics): string {
	const parts: string[] = [d.ax ?? 'ax=unreadable']
	const s = d.server
	if (!s) {
		parts.push('server=unreadable')
	} else {
		parts.push(`displays=${s.displays ?? '?'}`)
		if (s.mainWindows.length === 0) parts.push('main=none')
		for (const [i, w] of s.mainWindows.slice(0, 3).entries()) {
			const place = w.onDisplay ? 'on-display' : 'OFF-DISPLAY'
			parts.push(`main${i + 1}=@${w.x},${w.y} ${w.w}x${w.h} ${w.onscreen ? 'onscreen' : 'hidden'} ${place}`)
		}
		parts.push(`thin=${s.thinWindows}`)
	}
	return parts.join(' ')
}

/** Read-only AX walk: nothing is pressed, focused or moved. Strings are built outside names SE reserves. */
const AX_SCRIPT = `
tell application "System Events"
	set frontApp to name of first application process whose frontmost is true
	tell process "Conductor"
		set winCount to count of windows
		set summary to "front=" & frontApp & " windows=" & winCount
		if winCount is 0 then return summary
		set firstWin to window 1
		try
			set winPos to position of firstWin
			set winSize to size of firstWin
			set summary to summary & " win1=@" & (item 1 of winPos) & "," & (item 2 of winPos) & " " & (item 1 of winSize) & "x" & (item 2 of winSize)
		end try
		set cur to firstWin
		set trail to ""
		repeat with depth from 1 to 5
			try
				set kids to count of UI elements of cur
				set trail to trail & kids
				if kids is 0 then exit repeat
				set cur to UI element 1 of cur
				if depth < 5 then set trail to trail & ">"
			on error
				set trail to trail & "?"
				exit repeat
			end try
		end repeat
		return summary & " tree=" & trail
	end tell
end tell
`

/**
 * Same CF-array pattern as `serverWindowCount` (`bindFunction`, never `$.CFBridgingRelease`, which segfaults the
 * osascript child). Display frames come from NSScreen, whose origin is bottom-left; the window server's is
 * top-left, so each frame is flipped against the primary screen's height before a window is tested against it.
 */
const SERVER_SCRIPT = `
ObjC.import('CoreGraphics'); ObjC.import('AppKit');
ObjC.bindFunction('CGWindowListCopyWindowInfo', ['id', ['unsigned int', 'unsigned int']]);
const all = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(0, 0)) || [];
const mine = all.filter(x => x.kCGWindowOwnerName === 'Conductor' && x.kCGWindowLayer === 0);
const screens = ObjC.unwrap($.NSScreen.screens);
const primaryH = screens.length ? screens[0].frame.size.height : 0;
const frames = screens.map(s => ({ x: s.frame.origin.x, y: primaryH - (s.frame.origin.y + s.frame.size.height), w: s.frame.size.width, h: s.frame.size.height }));
const inside = (b) => frames.some(f => b.X + b.Width / 2 >= f.x && b.X + b.Width / 2 <= f.x + f.w && b.Y + b.Height / 2 >= f.y && b.Y + b.Height / 2 <= f.y + f.h);
const big = mine.filter(x => x.kCGWindowBounds && x.kCGWindowBounds.Height > 40);
JSON.stringify({
	displays: screens.length,
	thin: mine.length - big.length,
	main: big.map(x => ({ x: Math.round(x.kCGWindowBounds.X), y: Math.round(x.kCGWindowBounds.Y), w: Math.round(x.kCGWindowBounds.Width), h: Math.round(x.kCGWindowBounds.Height), onscreen: !!x.kCGWindowIsOnscreen, onDisplay: inside(x.kCGWindowBounds) }))
})
`

function parseServerFacts(stdout: string): WindowServerFacts | null {
	try {
		const raw = JSON.parse(stdout.trim()) as {
			displays?: unknown
			thin?: unknown
			main?: { x: number; y: number; w: number; h: number; onscreen: boolean; onDisplay: boolean }[]
		}
		return {
			displays: typeof raw.displays === 'number' ? raw.displays : null,
			thinWindows: typeof raw.thin === 'number' ? raw.thin : 0,
			mainWindows: Array.isArray(raw.main) ? raw.main : []
		}
	} catch {
		return null
	}
}

/** One formatted line, or null when neither probe produced anything (so the caller logs nothing at all). */
export async function readWindowDiagnostics(): Promise<string | null> {
	const [ax, server] = await Promise.all([
		run('osascript', ['-e', AX_SCRIPT], { timeout: PROBE_TIMEOUT_MS })
			.then(r => r.stdout.trim() || null)
			.catch(() => null),
		run('osascript', ['-l', 'JavaScript', '-e', SERVER_SCRIPT], { timeout: PROBE_TIMEOUT_MS })
			.then(r => parseServerFacts(r.stdout))
			.catch(() => null)
	])
	if (!ax && !server) return null
	return formatWindowDiagnostics({ ax, server })
}
