import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { adaptAutoDefaults, autoModelIssues, DEFAULT_AUTO_MODEL_CONFIG } from '../../src/agents/auto-model/config.ts'
import { readConductorModelSeed } from '../../src/agents/conductor-catalog.ts'
import { ModelCache } from '../../src/agents/model-cache.ts'
import { currentModelCatalog } from '../../src/shared.ts'

const directories: string[] = []
afterEach(() => {
	for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function temp(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-conductor-catalog-'))
	directories.push(directory)
	return directory
}

const model = (id: string, label: string, status = 'picker') => ({ id, label, status })

const catalog = {
	baseUrl: 'https://example.invalid',
	catalog: {
		harnesses: {
			claude: {
				configs: [
					// Older config first on purpose: the newest one (highest minHarnessVersion) is the one the app runs.
					{ minHarnessVersion: '2.1.284', models: [model('sonnet-5-5-1m', 'Sonnet 5.5'), model('old', 'Old One')] },
					{
						minHarnessVersion: '2.1.293',
						models: [
							model('sonnet-5-5-1m', 'Sonnet 5.5'),
							model('sonnet-5-1m', 'Sonnet 5 1M'),
							model('opus-4-8', 'Opus 4.8', 'deprecated'),
							model('opus', 'Opus 4.8 hidden', 'hidden')
						]
					}
				]
			},
			codex: {
				configs: [
					{
						minHarnessVersion: '0.0.0',
						models: [
							model('gpt-5.6-luna', 'GPT-5.6 Luna'),
							model('gpt-5.6-sol', 'GPT-5.6 Sol'),
							model('gpt-5.6-terra', 'GPT-5.6 Terra'),
							model('gpt-6-astra', 'GPT-6 Astra', 'gated')
						]
					}
				]
			}
		}
	}
}

/** Just enough of the app's database: its `settings` rows and starred models. */
function fakeDb(rows: { catalog?: unknown; favorites?: object[] } = {}) {
	return {
		query<T>(sql: string): T[] {
			if (sql.includes('FROM settings')) {
				return (rows.catalog === undefined ? [] : [{ value: JSON.stringify(rows.catalog) }]) as T[]
			}
			if (sql.includes('FROM favorite_models')) {
				return (rows.favorites ?? []).map(configuration => ({ configuration: JSON.stringify(configuration) })) as T[]
			}
			return []
		}
	}
}

function settingsFile(body: string): string {
	const file = path.join(temp(), 'settings.toml')
	fs.writeFileSync(file, body)
	return file
}

describe('the desktop app’s model catalog', () => {
	test('offers the picker rows of the newest config, and a starred model the catalog gates', () => {
		const seed = readConductorModelSeed(
			fakeDb({ catalog, favorites: [{ type: 'built-in', agent: 'codex', model: 'gpt-6-astra' }] }),
			settingsFile('[models]\ndefault = "sonnet-5-1m"\n')
		)
		expect(seed?.groups.map(group => [group.agentType, group.models])).toEqual([
			['claude', ['Sonnet 5 1M', 'Sonnet 5.5']],
			['codex', ['GPT-5.6 Luna', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-6 Astra']]
		])
	})

	test('the default is the first model the user ranked, ahead of the older `[models] default` key', () => {
		const stale = settingsFile('[models]\ndefault = "sonnet-5-1m"\n')
		const seed = readConductorModelSeed(
			fakeDb({
				catalog,
				favorites: [
					{ type: 'built-in', agent: 'claude', model: 'sonnet-5-5-1m' },
					{ type: 'built-in', agent: 'codex', model: 'gpt-5.6-sol' }
				]
			}),
			stale
		)
		expect(seed?.defaultModel).toBe('Sonnet 5.5')
	})

	test('without favorites the default is the label of the id in settings.toml', () => {
		const seed = readConductorModelSeed(fakeDb({ catalog }), settingsFile('[models]\ndefault = "sonnet-5-1m"\n'))
		expect(seed?.defaultModel).toBe('Sonnet 5 1M')
		expect(readConductorModelSeed(fakeDb({ catalog }), settingsFile('[git]\n'))?.defaultModel).toBeUndefined()
	})

	test('says nothing when the app has no catalog yet', () => {
		expect(readConductorModelSeed(fakeDb(), settingsFile(''))).toBeNull()
		expect(readConductorModelSeed(fakeDb({ catalog: { catalog: {} } }), settingsFile(''))).toBeNull()
	})
})

describe('the model cache with the desktop catalog behind it', () => {
	const seed = () => readConductorModelSeed(fakeDb({ catalog }), settingsFile('[models]\ndefault = "sonnet-5-1m"\n'))

	test('serves the catalog and its default before any picker has been read', () => {
		const cache = new ModelCache(path.join(temp(), 'models.json'), seed)
		expect(currentModelCatalog(cache.list())).toContain('Sonnet 5 1M')
		expect(cache.defaultModel()).toBe('Sonnet 5 1M')
	})

	test('a live picker read of a harness replaces the catalog for it, and only for it', () => {
		const cache = new ModelCache(path.join(temp(), 'models.json'), seed)
		cache.remember('claude', ['Opus 5'], 'Opus 5')
		const groups = cache.list()
		expect(groups.find(group => group.agentType === 'claude')?.models).toEqual(['Opus 5'])
		expect(groups.find(group => group.agentType === 'codex')?.models).toContain('GPT-5.6 Luna')
		expect(cache.defaultModel()).toBe('Opus 5')
	})

	test('never writes the desktop’s catalog into the relay’s own file', () => {
		const file = path.join(temp(), 'models.json')
		new ModelCache(file, seed).rememberModel('codex', 'GPT-5.6 Sol')
		const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { agentType: string; defaultModel?: string }[]
		expect(saved.map(entry => entry.agentType)).toEqual(['codex'])
		expect(saved[0].defaultModel).toBeUndefined()
	})
})

describe('Auto’s built-in profiles against that catalog', () => {
	test('use the catalog’s spelling of each model and leave no error behind', () => {
		const groups = new ModelCache(path.join(temp(), 'models.json'), () =>
			readConductorModelSeed(
				fakeDb({
					catalog: {
						catalog: {
							harnesses: {
								codex: {
									configs: [
										{
											models: [
												model('gpt-5.6-luna', 'GPT-5.6 Luna'),
												model('gpt-5.6-terra', 'GPT-5.6 Terra'),
												model('gpt-5.6-sol', 'GPT-5.6 Sol'),
												model('gpt-6-astra', 'GPT-6 Astra')
											]
										}
									]
								},
								claude: { configs: [{ models: [model('fable-5-1', 'Fable 5.1')] }] }
							}
						}
					}
				}),
				settingsFile('')
			)
		).list()
		const adapted = adaptAutoDefaults(structuredClone(DEFAULT_AUTO_MODEL_CONFIG), groups)
		expect(adapted.router.model).toBe('GPT-5.6 Luna')
		// The OpenCode profile is not in this catalog, so it is not offered rather than shown as an error.
		expect(adapted.profiles.map(profile => [profile.id, profile.model])).toEqual([
			['quick', 'GPT-5.6 Luna'],
			['standard', 'GPT-5.6 Terra'],
			['complex', 'GPT-5.6 Sol'],
			['deep', 'GPT-6 Astra'],
			['design', 'Fable 5.1']
		])
		expect(autoModelIssues(adapted, groups)).toEqual([])
	})

	test('are untouched while no catalog is known, so a missing one is never hidden', () => {
		expect(adaptAutoDefaults(structuredClone(DEFAULT_AUTO_MODEL_CONFIG), [])).toEqual(DEFAULT_AUTO_MODEL_CONFIG)
	})
})
