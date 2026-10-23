import { execFileSync } from 'node:child_process'
import { projectDir } from './environment.ts'
import { restart } from './installation.ts'
import { parseCount, updateBlocker } from './update-plan.ts'

function git(args: string[]): string {
	return execFileSync('git', ['-C', projectDir, ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	}).trim()
}

function gitOrNull(args: string[]): string | null {
	try {
		return git(args)
	} catch {
		return null
	}
}

function run(command: string, args: string[]): void {
	try {
		execFileSync(command, args, { cwd: projectDir, stdio: 'inherit' })
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(`${command} was not found on PATH. Run \`corepack enable\` (Node 24 ships it) and try again.`)
		}
		throw err
	}
}

/**
 * Bring a source-checkout install up to date with origin/main: fast-forward, install, build, restart.
 *
 * Auto-update only exists for the published package (it requires there to be no `.git`), so a checkout
 * install — the one a Conductor workspace's login service runs from — never changes on its own and
 * every merged PR otherwise waits for someone to remember the four commands. `--check` changes nothing
 * and only says what is waiting.
 *
 * It restarts only after a clean build. A failed build leaves the running service on the code it already
 * loaded, and the previous commit is printed so going back is one command rather than a hunt.
 */
export function update(check: boolean): void {
	const hasGit = gitOrNull(['rev-parse', '--git-dir']) !== null
	if (hasGit) gitOrNull(['fetch', '--quiet', 'origin', 'main'])
	const behind = hasGit ? parseCount(gitOrNull(['rev-list', '--count', 'HEAD..origin/main']) ?? '') : null
	const blocker = updateBlocker({
		hasGit,
		branch: hasGit ? gitOrNull(['branch', '--show-current']) || null : null,
		clean: hasGit ? gitOrNull(['status', '--porcelain']) === '' : false,
		behind
	})
	if (blocker) {
		console.error(`✗ ${blocker}`)
		process.exit(1)
	}
	if (behind === 0) {
		console.info(`✓ already up to date (${git(['rev-parse', '--short', 'HEAD'])})`)
		return
	}
	console.info(`${behind} commit${behind === 1 ? '' : 's'} waiting on origin/main:`)
	console.info(
		git(['log', '--oneline', '--max-count=20', 'HEAD..origin/main'])
			.split('\n')
			.map(line => `  ${line}`)
			.join('\n')
	)
	if (check) return

	const before = git(['rev-parse', '--short', 'HEAD'])
	try {
		git(['merge', '--ff-only', 'origin/main'])
		run('pnpm', ['install', '--frozen-lockfile'])
		run('pnpm', ['build'])
	} catch (err) {
		console.error(`✗ update failed: ${err instanceof Error ? err.message : String(err)}`)
		console.error(
			`  The service was not restarted and still runs the code it had loaded. The checkout was at ${before}; ` +
				`to go back: git -C ${projectDir} reset --hard ${before}`
		)
		process.exit(1)
	}
	console.info(`✓ updated ${before} → ${git(['rev-parse', '--short', 'HEAD'])}`)
	restart()
}
