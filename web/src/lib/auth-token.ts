const TOKEN_KEY = 'conductor-remote-token'

/** Pull a `#token=…` out of the URL on first load, persist it, and clean the hash. */
export function bootstrapToken(): string | null {
	const hash = new URLSearchParams(location.hash.slice(1))
	const fromHash = hash.get('token')
	if (fromHash) {
		localStorage.setItem(TOKEN_KEY, fromHash)
		history.replaceState(null, '', location.pathname + location.search)
	}
	return localStorage.getItem(TOKEN_KEY)
}

export function getToken(): string | null {
	return localStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
	localStorage.removeItem(TOKEN_KEY)
}

/** Persist a token that arrived outside the URL flow (e.g. pasted into the TokenGate). */
export function setStoredToken(token: string): void {
	localStorage.setItem(TOKEN_KEY, token)
}

/** Accept a bare token or anything containing `token=…` (a full `/#token=` URL, say); null if neither. */
export function parseTokenInput(raw: string): string | null {
	const s = raw.trim()
	if (!s) return null
	const m = s.match(/token=([^&\s]+)/)
	if (m) return decodeURIComponent(m[1])
	return /\s/.test(s) ? null : s
}

/**
 * The id of the paired device a token belongs to, or null for the shared token. A device token is
 * `<12 hex>.<secret>` (src/auth/devices.ts) and the shared one never contains a dot, so the shape alone
 * tells them apart. The id is not secret — it is what `conductor-remote devices revoke <id>` takes.
 */
export function deviceIdFromToken(token: string | null): string | null {
	const match = token?.match(/^([0-9a-f]{12})\.[A-Za-z0-9_-]+$/)
	return match ? match[1] : null
}

/** A name for this phone in the Mac's device list, from the user agent's model ("SM-S931N") or a plain "Phone". */
export function deviceNameGuess(userAgent: string): string {
	const model = userAgent.match(/Android [\d.]+; ([^;)]+?)(?: Build|[;)])/)?.[1]?.trim()
	return model ? model.slice(0, 40) : 'Phone'
}
