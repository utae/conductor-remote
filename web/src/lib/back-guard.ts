/**
 * What Android's back button (and its edge swipe) does here: with the workspace drawer closed it opens the
 * drawer, and with the drawer open it leaves the app.
 *
 * A web page cannot see the button, only the history it pops. So the drawer being closed is what puts one
 * extra history entry of ours on top of the stack, and popping it is the "open the drawer" press. While the
 * drawer is open no entry of ours exists, so the next press has nothing to pop and the OS closes the app.
 * That only holds if the stack below is a single entry, which is why a phone navigates with `replace`
 * (`replaceOnPhone`) instead of piling up one entry per workspace it visited.
 *
 * The drawer can also open without a press (the header toggle, the edge drag, a notification). Then the entry
 * is still on top, and a later press would pop it with the drawer already open and leave the app on screen
 * until a second press. So whenever the drawer is open and an entry is ours, we pop it ourselves and ignore
 * the `popstate` that causes.
 *
 * Kept as a class over a one-method history slice so the state machine can be driven by a fake stack: the
 * browser is the only place the real one runs, and it cannot be unit tested.
 */

/** The part of `window.history` the guard uses. */
export interface GuardHistory {
	pushState(state: unknown, unused: string, url?: string | null): void
	back(): void
}

export class BackGuard {
	private readonly history: GuardHistory
	private readonly currentUrl: () => string
	private readonly onBack: () => void
	/** An entry of ours sits on top of the history stack. Tracked here, not read from `history.state`: a router
	 * `replace` rewrites that state without changing the depth. */
	private armed = false
	/** `popstate` events we caused with our own `back()` and must not read as a press. */
	private ignored = 0

	constructor(history: GuardHistory, currentUrl: () => string, onBack: () => void) {
		this.history = history
		this.currentUrl = currentUrl
		this.onBack = onBack
	}

	/** True when our entry is on top. */
	get isArmed(): boolean {
		return this.armed
	}

	/**
	 * Bring the stack in line with what the screen needs: `wantArmed` is "a phone with the drawer closed".
	 * Idempotent, so it can run on every render of the state it depends on.
	 */
	sync(wantArmed: boolean): void {
		if (wantArmed && !this.armed) {
			// The same URL, so popping it lands on the entry underneath showing the same screen.
			this.history.pushState({ backGuard: true }, '', this.currentUrl())
			this.armed = true
		} else if (!wantArmed && this.armed) {
			this.armed = false
			this.ignored++
			this.history.back()
		}
	}

	/** Wire to `popstate`. A press pops our entry: the drawer opens and nothing is pushed back. */
	onPopState(): void {
		if (this.ignored > 0) {
			this.ignored--
			return
		}
		if (!this.armed) return
		this.armed = false
		this.onBack()
	}
}

/** The drawer is a floating overlay below Tailwind's `md`; from there up the rail is static and back is the browser's. */
export function isPhoneLayout(): boolean {
	return typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches
}

/**
 * Options for every in-app `navigate`: on a phone, replace the entry instead of adding one, so the history
 * below the guard stays a single entry and a press with the drawer open has nothing left to go back to.
 */
export function replaceOnPhone(): { replace: boolean } {
	return { replace: isPhoneLayout() }
}
