/**
 * The model catalog the desktop app already keeps, read without touching its UI.
 *
 * `model-cache.json` only fills when a chat's real picker is opened (`GET …/models`), which drives the Mac's
 * window. Until then the relay knows no model at all, so every Auto profile and role reads as "not in the
 * saved picker catalog" and a new workspace has nothing to choose from. Conductor itself caches the catalog
 * it fetched in `settings.model_catalog_cache` and the user's own default in `~/.conductor/settings.toml`,
 * both readable here, so this is the fallback until a live picker read replaces it.
 *
 * What it cannot give is the badge-free *picker text* of a harness the catalog does not describe (OpenCode),
 * so those stay absent rather than guessed.
 */
import type { ConductorDb } from '../db.ts'
import { conductorSettingsPath, readDefaultModelId } from './conductor-settings.ts'
import type { CachedModelGroup } from './model-cache.ts'

interface CatalogModel {
	id?: unknown
	label?: unknown
	status?: unknown
}

interface CatalogConfig {
	minHarnessVersion?: unknown
	models?: unknown
}

export interface ConductorModelSeed {
	groups: CachedModelGroup[]
	/** The desktop app's own default for new chats, as its picker label. */
	defaultModel?: string
}

type Queryable = Pick<ConductorDb, 'query'>

function versionKey(version: unknown): number[] {
	return typeof version === 'string' ? version.split('.').map(part => Number.parseInt(part, 10) || 0) : []
}

function newerVersion(a: CatalogConfig, b: CatalogConfig): number {
	const left = versionKey(a.minHarnessVersion)
	const right = versionKey(b.minHarnessVersion)
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const diff = (left[i] ?? 0) - (right[i] ?? 0)
		if (diff) return diff
	}
	return 0
}

function setting(db: Queryable, key: string): unknown {
	const row = db.query<{ value: string | null }>('SELECT value FROM settings WHERE key = ? LIMIT 1', [key])[0]
	if (!row?.value) return null
	try {
		return JSON.parse(row.value)
	} catch {
		return null
	}
}

/** The models the user starred in the desktop picker, in the order they ranked them. */
function favorites(db: Queryable): { agent: string; model: string }[] {
	const found: { agent: string; model: string }[] = []
	try {
		for (const row of db.query<{ configuration: string | null }>(
			'SELECT configuration FROM favorite_models ORDER BY position LIMIT 50'
		)) {
			const parsed = JSON.parse(row.configuration ?? '') as { agent?: unknown; model?: unknown }
			if (typeof parsed.agent === 'string' && typeof parsed.model === 'string') {
				found.push({ agent: parsed.agent, model: parsed.model })
			}
		}
	} catch {
		// No favorites table or an unreadable row: the picker rows alone are still a catalog.
	}
	return found
}

export function readConductorModelSeed(
	db: Queryable,
	settingsFile = conductorSettingsPath(),
	now = Date.now()
): ConductorModelSeed | null {
	try {
		const cache = setting(db, 'model_catalog_cache') as { catalog?: { harnesses?: unknown } } | null
		const harnesses = cache?.catalog?.harnesses
		if (!harnesses || typeof harnesses !== 'object') return null
		const starred = favorites(db)
		const labelById = new Map<string, string>()
		const groups: CachedModelGroup[] = []
		for (const [harness, raw] of Object.entries(harnesses as Record<string, { configs?: unknown }>)) {
			const configs = (Array.isArray(raw?.configs) ? (raw.configs as CatalogConfig[]) : []).sort(newerVersion)
			// The newest config describes the newest harness, which is the one the app runs.
			const latest = configs.at(-1)
			const models = Array.isArray(latest?.models) ? (latest.models as CatalogModel[]) : []
			const labels = new Set<string>()
			for (const model of models) {
				if (typeof model.id !== 'string' || typeof model.label !== 'string') continue
				labelById.set(model.id, model.label)
				const isStarred = starred.some(favorite => favorite.agent === harness && favorite.model === model.id)
				if (model.status === 'picker' || (isStarred && model.status !== 'deprecated')) labels.add(model.label)
			}
			if (labels.size) {
				groups.push({
					agentType: harness,
					models: [...labels].sort((a, b) => a.localeCompare(b)),
					snapshotAt: now,
					snapshotModels: [...labels].sort((a, b) => a.localeCompare(b)),
					updatedAt: now
				})
			}
		}
		if (!groups.length) return null
		// What new chats start on is the first model the user ranked, not `[models] default`: that key is only
		// written by an older settings screen (here it still said `sonnet-5-1m` while every new workspace of the
		// last days, phone-created ones included, began on `sonnet-5-5-1m`, the first favorite).
		const defaultId = starred[0]?.model ?? readDefaultModelId(settingsFile)
		const defaultModel = defaultId ? labelById.get(defaultId) : undefined
		return { groups, ...(defaultModel ? { defaultModel } : {}) }
	} catch {
		return null
	}
}
