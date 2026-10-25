/**
 * Android back: with the drawer closed it opens the drawer, with the drawer open it leaves the app. A page
 * only sees the history it pops, so the whole feature is a state machine over a stack, and a stack is
 * something a test can model. `FakeStack` is the browser's history as far as the guard uses it: pushing adds
 * an entry, a back press pops one and fires `popstate` — and with nothing below the root entry, the press
 * leaves the app, which is what an installed PWA does.
 */
import { describe, expect, test } from 'vitest'
import { BackGuard } from '../../web/src/lib/back-guard.ts'

class FakeStack {
	entries: unknown[] = [null]
	index = 0
	exited = false
	onPop: () => void = () => {}

	pushState(state: unknown) {
		this.entries = [...this.entries.slice(0, this.index + 1), state]
		this.index++
	}

	/** Both the OS button and `history.back()`: pop one entry and report it, or leave the app. */
	back() {
		if (this.index === 0) {
			this.exited = true
			return
		}
		this.index--
		this.onPop()
	}
}

/** The drawer plus the guard, wired the way `useBackButton` wires them: sync after every change of `open`. */
function app(options: { phone?: boolean; open?: boolean } = {}) {
	const stack = new FakeStack()
	const state = { open: options.open ?? false, phone: options.phone ?? true, presses: 0 }
	const guard = new BackGuard(
		stack,
		() => '/w/abc',
		() => {
			state.presses++
			setOpen(true)
		}
	)
	stack.onPop = () => guard.onPopState()
	const sync = () => guard.sync(state.phone && !state.open)
	function setOpen(open: boolean) {
		state.open = open
		sync()
	}
	sync()
	return {
		stack,
		state,
		guard,
		setOpen,
		setPhone: (phone: boolean) => {
			state.phone = phone
			sync()
		},
		/** The Android back button or swipe. */
		press: () => stack.back()
	}
}

describe('Android back with the workspace drawer', () => {
	test('closed: a press opens the drawer and the app stays', () => {
		const a = app({ open: false })
		a.press()
		expect(a.state.open).toBe(true)
		expect(a.stack.exited).toBe(false)
	})

	test('open: a press leaves the app, and the drawer-opening press is the only one that does not', () => {
		const a = app({ open: false })
		a.press() // opens the drawer
		a.press() // now open → exits
		expect(a.stack.exited).toBe(true)
	})

	test('a launch with the drawer already open leaves on the first press', () => {
		const a = app({ open: true })
		expect(a.stack.entries).toHaveLength(1)
		a.press()
		expect(a.stack.exited).toBe(true)
	})

	test('closing and re-opening any number of times never grows the stack, so one press always suffices', () => {
		const a = app({ open: false })
		for (let i = 0; i < 6; i++) {
			a.press() // closed → open
			expect(a.stack.entries.length).toBeLessThanOrEqual(2)
			a.setOpen(false) // pick a workspace / tap the scrim
		}
		expect(a.stack.entries.length).toBe(2)
		a.press()
		a.press()
		expect(a.stack.exited).toBe(true)
	})

	test('a drawer opened without a press (header toggle, edge drag) still lets the next press exit', () => {
		const a = app({ open: false })
		expect(a.guard.isArmed).toBe(true)
		a.setOpen(true)
		// Our entry was popped by the guard itself, and that pop was not taken for a press.
		expect(a.guard.isArmed).toBe(false)
		expect(a.state.presses).toBe(0)
		expect(a.stack.index).toBe(0)
		a.press()
		expect(a.stack.exited).toBe(true)
	})

	test('syncing the same state repeatedly pushes one entry, not one per call', () => {
		const a = app({ open: false })
		const before = a.stack.entries.length
		a.guard.sync(true)
		a.guard.sync(true)
		expect(a.stack.entries.length).toBe(before)
	})

	test('the entry carries the current URL so popping it shows the same screen', () => {
		const pushed: { state: unknown; url: string | null | undefined }[] = []
		const guard = new BackGuard(
			{ pushState: (state, _unused, url) => pushed.push({ state, url }), back: () => {} },
			() => '/w/abc?session=s1',
			() => {}
		)
		guard.sync(true)
		expect(pushed).toEqual([{ state: { backGuard: true }, url: '/w/abc?session=s1' }])
	})

	test('on a wide screen nothing is pushed, and rotating to wide releases the entry', () => {
		const wide = app({ phone: false, open: false })
		expect(wide.stack.entries).toHaveLength(1)
		wide.press()
		expect(wide.stack.exited).toBe(true)

		const a = app({ phone: true, open: false })
		expect(a.guard.isArmed).toBe(true)
		a.setPhone(false)
		expect(a.guard.isArmed).toBe(false)
		expect(a.stack.index).toBe(0)
		expect(a.state.presses).toBe(0)
	})

	test('a press with no entry of ours is not ours to handle', () => {
		const a = app({ open: true })
		a.guard.onPopState()
		expect(a.state.presses).toBe(0)
	})
})
