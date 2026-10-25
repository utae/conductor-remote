import type { ChangeEvent, KeyboardEvent, RefObject, SyntheticEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { applySkill, filterSkills, moveActive, slashKeyAction, slashToken } from '../lib/slash.ts'
import type { SkillEntry } from '../lib/types.ts'
import { useSkills } from './skills.ts'

/**
 * The `/` menu's state for one composer: the matches, which row is highlighted, and what a pick does to the draft.
 * The rules themselves are in `lib/slash.ts`; this only holds the caret, the highlight and an Escape.
 *
 * `enabled` is the caller's judgement of whether this composer takes slash commands at all (an agent that reads
 * them, not a Workflow draft, not a chat that cannot be typed into). Off, nothing is fetched and nothing opens.
 */
export function useSlashMenu(options: {
	workspaceId: string
	text: string
	enabled: boolean
	textareaRef: RefObject<HTMLTextAreaElement | null>
	setText: (text: string) => void
}) {
	const { workspaceId, text, enabled, textareaRef, setText } = options
	const [caret, setCaret] = useState(0)
	const [active, setActive] = useState(0)
	/** The draft Escape closed the menu on; any edit makes it a different draft and the menu may open again. */
	const [dismissedText, setDismissedText] = useState<string | null>(null)

	const token = enabled ? slashToken(text, caret) : null
	const skills = useSkills(workspaceId, enabled && text.startsWith('/'))
	const query = token?.query
	const items = useMemo<SkillEntry[]>(
		() => (query !== undefined && skills.data ? filterSkills(skills.data.skills, query) : []),
		[query, skills.data]
	)
	const open = !!token && items.length > 0 && dismissedText !== text

	// A new query is a new list: start at the top rather than on a row that is no longer there.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the highlight resets when the query changes, which the body does not read
	useEffect(() => {
		setActive(0)
	}, [query])

	const pick = (skill: SkillEntry) => {
		if (!token) return
		const next = applySkill(text, token, skill.name)
		setText(next.text)
		setCaret(next.caret)
		// The write lands on the next render; put the caret after the name once it has.
		requestAnimationFrame(() => {
			const textarea = textareaRef.current
			if (!textarea) return
			textarea.focus({ preventScroll: true })
			textarea.setSelectionRange(next.caret, next.caret)
		})
	}

	return {
		open,
		items,
		active: Math.min(active, Math.max(items.length - 1, 0)),
		setActive,
		pick,
		/** Track the caret as the draft is typed into. */
		onTyped: (event: ChangeEvent<HTMLTextAreaElement>) => setCaret(event.target.selectionStart),
		/** …and as it moves without a change: a tap in the text, an arrow key. */
		onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => setCaret(event.currentTarget.selectionStart),
		/** True when the key was the menu's, so the composer should not also act on it. */
		onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
			if (!open || event.nativeEvent.isComposing) return false
			const action = slashKeyAction(event.key, {
				meta: event.metaKey,
				ctrl: event.ctrlKey,
				alt: event.altKey,
				shift: event.shiftKey
			})
			if (!action) return false
			event.preventDefault()
			if (action === 'next') setActive(moveActive(active, 1, items.length))
			else if (action === 'previous') setActive(moveActive(active, -1, items.length))
			else if (action === 'dismiss') setDismissedText(text)
			else pick(items[Math.min(active, items.length - 1)])
			return true
		}
	}
}
