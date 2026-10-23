import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import type { ConnectionNotice } from '../../lib/connection.ts'
import type { Session } from '../../lib/types.ts'
import { UnlockLink } from '../ui.tsx'

/**
 * Why a message sent now may not reach the Mac, above the composer where the sending happens.
 * Nothing when everything is fine — an always-visible "connected" would be noise a person learns to skip.
 */
export function ConnectionStrip({ notice }: { notice: ConnectionNotice | null }) {
	if (!notice) return null
	return (
		<div
			role="status"
			data-connection-reason={notice.reason}
			className="flex shrink-0 items-start gap-2 border-t border-border-soft bg-surface-2 px-4 py-2 text-xs text-working"
		>
			<AlertTriangle size={13} className="mt-0.5 shrink-0" />
			<span className="min-w-0">
				{notice.text}
				{notice.unlock ? <UnlockLink className="ml-1" /> : null}
			</span>
		</div>
	)
}

/** Native children cannot receive a phone prompt; return to their real parent first. */
export function SubagentReplyNotice({ title, onReturn }: { title?: string | null; onReturn: () => void }) {
	return (
		<div className="pb-safe flex shrink-0 items-center justify-center border-t border-border-soft px-4 py-3">
			<button
				type="button"
				onClick={onReturn}
				className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition active:bg-surface-2"
			>
				<ArrowLeft size={14} className="shrink-0" />
				<span className="truncate">Return to {title || 'parent chat'} to reply</span>
			</button>
		</div>
	)
}

/**
 * How full this chat's context window is, on the tab that owns it.
 *
 * It sits here rather than on the workspace card because a workspace holds several
 * chats and the card could only ever print the *active* one's number, which then read
 * as the workspace's: one workspace here runs four tabs at 28 / 85 / 49 / 29 at once.
 * Amber from 80 on, where compaction is close enough to be worth reading.
 */
export function ContextButton({ session, onOpen }: { session: Session; onOpen: () => void }) {
	const used = session.context_used_percent
	if (typeof used !== 'number' || used <= 0) return null
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label={`Context for ${session.title || 'Untitled'}: ${Math.round(used)}% used`}
			aria-haspopup="dialog"
			className={cn(
				'flex h-7 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-[11px] tabular-nums transition active:bg-bg/70',
				used >= 80 ? 'text-working' : 'text-faint'
			)}
		>
			{Math.round(used)}%
		</button>
	)
}
