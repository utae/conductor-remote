import { useEffect, useRef } from 'react'
import { cn } from '../../lib/cn.ts'
import type { SkillEntry } from '../../lib/types.ts'

/** Where a skill comes from, in a word: the plugin's name, or who owns the folder. */
function origin(skill: SkillEntry): string {
	if (skill.source === 'plugin') return skill.plugin ?? 'plugin'
	if (skill.source === 'conductor') return 'Conductor'
	return skill.source
}

/**
 * The skills a `/` can name, above the composer. It does not own the highlight or the pick: the composer's
 * textarea keeps focus (arrow keys and Enter go through it), so the list is only drawn here and a tap picks.
 *
 * Mouse-down is cancelled on the list because it would otherwise blur the textarea, which on a phone drops the
 * keyboard — and the next thing someone types is the arguments to the skill they just chose.
 */
export function SlashMenu({
	items,
	active,
	onPick,
	onHover
}: {
	items: SkillEntry[]
	active: number
	onPick: (skill: SkillEntry) => void
	onHover: (index: number) => void
}) {
	const activeRow = useRef<HTMLButtonElement>(null)
	// Keep the highlighted row on screen as the arrow keys walk a list longer than the box.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when the highlight moves
	useEffect(() => {
		activeRow.current?.scrollIntoView({ block: 'nearest' })
	}, [active, items])

	return (
		<div
			role="listbox"
			aria-label="Skills"
			data-slash-menu
			onMouseDown={event => event.preventDefault()}
			className="absolute inset-x-0 bottom-full z-30 mb-1 max-h-[min(50vh,22rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface py-1 shadow-lg"
		>
			{items.map((skill, index) => (
				<button
					type="button"
					role="option"
					aria-selected={index === active}
					key={`${skill.kind}:${skill.name}`}
					ref={index === active ? activeRow : undefined}
					onClick={() => onPick(skill)}
					onMouseEnter={() => onHover(index)}
					className={cn(
						'flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left',
						index === active ? 'bg-accent-soft' : 'active:bg-surface-2'
					)}
				>
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="truncate font-mono text-sm font-medium text-text">/{skill.name}</span>
						<span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
							{skill.kind === 'command' ? 'command · ' : ''}
							{origin(skill)}
						</span>
					</span>
					{skill.description ? <span className="line-clamp-2 text-xs text-muted">{skill.description}</span> : null}
				</button>
			))}
		</div>
	)
}
