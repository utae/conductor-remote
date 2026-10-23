/**
 * When `service update` may touch a checkout — kept apart from the command that runs git so the rules
 * can be tested without one. Strip-clean (no parameter properties, enums or namespaces) — see AGENTS.md.
 */

export interface UpdateFacts {
	/** The install directory has a `.git`: a source checkout rather than a published package. */
	hasGit: boolean
	branch: string | null
	/** No uncommitted changes, including untracked files. */
	clean: boolean
	/** Commits on origin/main this checkout lacks, or null when the comparison could not be made. */
	behind: number | null
}

/**
 * Why an update must not run, or null if it may. Each refusal is one the service would otherwise pay
 * for later: a published package updates itself from npm (auto-update does nothing for a checkout, and
 * this does nothing for a package); a feature branch must never become what the login service runs; and
 * a dirty tree is what a pull can silently entangle with someone's unsaved work.
 */
export function updateBlocker(facts: UpdateFacts): string | null {
	if (!facts.hasGit) {
		return 'This install is not a git checkout. A published package updates itself from npm (AUTO_UPDATE); there is nothing to pull here.'
	}
	if (facts.branch !== 'main') {
		return `This checkout is on ${facts.branch ? `"${facts.branch}"` : 'a detached HEAD'}, not main. Switch to main first so the login service never runs a feature branch.`
	}
	if (!facts.clean) {
		return 'The working tree has local changes. Commit or stash them first so the update cannot touch them.'
	}
	if (facts.behind === null) {
		return 'Could not compare with origin/main. Check the network and that the "origin" remote exists.'
	}
	return null
}

/** `git rev-list --count` output as a count, or null for anything that is not one. */
export function parseCount(output: string): number | null {
	const text = output.trim()
	return /^\d+$/.test(text) ? Number(text) : null
}
