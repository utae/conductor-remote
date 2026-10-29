/**
 * Keep a brief network handoff, or a Mac too starved to answer for a few seconds, from showing as an outage.
 * The relay's reads are synchronous, so a Mac under memory pressure stalls every answer at once (measured:
 * single queries of 10-58s), and a poll aborted before then is simply asked again.
 */
export const OFFLINE_GRACE_MS = 25_000

/** Milliseconds left before a failed request may show the offline state. */
export function offlineDelay(lastSyncAt: number | null, now = Date.now()): number {
	return Math.max(0, (lastSyncAt ?? now) + OFFLINE_GRACE_MS - now)
}
