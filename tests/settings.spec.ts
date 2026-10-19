/**
 * Settings: sparse resolution over the catalog, catalog-driven option rules,
 * version-1 migration, and the live migrator in a real Loader/profile boot.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADAPTER_IDS, builtinConnectionId, SESSION_MODEL_ID } from '../src/catalog.ts'
import * as plugin from '../src/index.ts'
import { importLegacy, migrateConfig, needsMigration } from '../src/settings/legacy.ts'
import { validateOptions } from '../src/settings/options.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { V2Config } from '../src/settings/types.ts'

const custom = { kind: 'structured', label: 'Work', adapter: 'exa', credentialRef: 'WORK_EXA' } as const
const fixedModel = {
  kind: 'model', label: 'Fixed', trustedEndpoint: true,
  binding: { mode: 'fixed', protocol: 'openai-responses', model: 'search', baseURL: 'https://gateway.test/v1', credentialRef: 'SEARCH_API' },
} as const

describe('resolveSettings', () => {
  it('derives every built-in from the catalog without materializing anything', () => {
    const config = {}
    const settings = resolveSettings(config)
    expect(config).toEqual({})
    expect([...settings.connections.keys()]).toEqual([...ADAPTER_IDS.map(builtinConnectionId), SESSION_MODEL_ID])
    expect(settings).toMatchObject({ freshness: 'auto', defaultConnection: undefined, showSelector: true })
    const access = Object.fromEntries([...settings.connections.values()].flatMap(c => c.kind === 'structured' ? [[c.adapter, c.access]] : []))
    expect(access).toEqual({ exa: 'keyless', firecrawl: 'keyless', tavily: 'keyless', tinyfish: 'keyless', deepseek: 'api-key', openalex: 'keyless', semanticscholar: 'api-key' })
    expect(settings.connections.get('builtin:deepseek')).toMatchObject({ endpoint: 'https://api.deepseek.com/v1/tools/search', credentialRef: 'DEEPSEEK_API_KEY' })
    expect(settings.connections.get(SESSION_MODEL_ID)).toMatchObject({ kind: 'model', route: 'session', disabled: false })
  })

  it('applies sparse overrides and resolves custom connections', () => {
    const settings = resolveSettings({
      version: 2, defaultConnection: 'custom:deleted', freshness: 'realtime', showSelector: false,
      connections: {
        'builtin:exa': { label: 'Exa (work)', access: 'api-key', credentialRef: 'WORK_EXA', options: { type: 'fast' } },
        'builtin:session-model': { optionsByProtocol: { 'anthropic-messages': { maxUses: 2 } } },
        'custom:proxy': { ...custom, endpoint: 'https://proxy.test/search', trustedEndpoint: true },
        'custom:model': fixedModel,
      },
    })
    expect(settings).toMatchObject({ defaultConnection: 'custom:deleted', freshness: 'realtime', showSelector: false })
    expect(settings.connections.get('builtin:exa')).toMatchObject({ label: 'Exa (work)', access: 'api-key', credentialRef: 'WORK_EXA', options: { type: 'fast' }, endpoint: 'https://api.exa.ai/search' })
    expect(settings.connections.get(SESSION_MODEL_ID)).toMatchObject({ options: { 'anthropic-messages': { maxUses: 2 } } })
    expect(settings.connections.get('custom:proxy')).toMatchObject({ kind: 'structured', access: 'api-key', endpoint: 'https://proxy.test/search' })
    expect(settings.connections.get('custom:model')).toMatchObject({ kind: 'model', route: fixedModel.binding, options: { 'openai-responses': {} } })
    expect(resolveSettings().connections.get('builtin:exa')?.label).toBe('Exa')
  })

  it.each<[string, V2Config]>([
    ['a literal key on a built-in', { connections: { 'builtin:exa': { apiKey: 'not-a-key' } as never } }],
    ['an endpoint override on a built-in', { connections: { 'builtin:exa': { endpoint: 'https://other.test' } as never } }],
    ['keyless access without an anonymous route', { connections: { 'builtin:deepseek': { access: 'keyless' } } }],
    ['an unknown access mode', { connections: { 'builtin:exa': { access: 'auto' } as never } }],
    ['an unknown connection id', { connections: { 'other:x': custom } }],
    ['a custom endpoint without explicit trust', { connections: { 'custom:proxy': { ...custom, endpoint: 'https://proxy.test/search' } } }],
    ['a custom model without explicit trust', { connections: { 'custom:model': { ...fixedModel, trustedEndpoint: false } as never } }],
    ['an endpoint carrying a query', { connections: { 'custom:proxy': { ...custom, endpoint: 'https://proxy.test/search?key=x', trustedEndpoint: true } } }],
    ['an invalid credential reference', { connections: { 'custom:proxy': { ...custom, credentialRef: 'not a ref' } } }],
    ['an invalid freshness', { freshness: 'hourly' as never }],
    ['a non-boolean selector switch', { showSelector: 'no' as never }],
  ])('rejects %s', (_case, config) => {
    expect(() => resolveSettings(config)).toThrow(/invalid search settings/)
  })
})

describe('validateOptions', () => {
  it('accepts catalog options and reports each invalid one', () => {
    expect(validateOptions('tinyfish', { purpose: 'Explicit purpose', location: 'US', domain_type: 'news' }, 'keyless')).toEqual([])
    expect(validateOptions('openalex', { sort: 'publication_year:desc,cited_by_count:desc', is_oa: true, mailto: 'a@b.org' }, 'keyless')).toEqual([])
    expect(validateOptions('firecrawl', { limit: 3, safe: 'yes' }, 'api-key')).toEqual(['Firecrawl has no option "limit"', 'Firecrawl option "safe" has an invalid value'])
    expect(validateOptions('deepseek', { query: 'override' }, 'api-key')).toHaveLength(1)
  })

  it('applies keyless restrictions from the catalog', () => {
    expect(validateOptions('exa', { type: 'fast' }, 'api-key')).toEqual([])
    expect(validateOptions('exa', { type: 'fast' }, 'keyless')).toEqual(['Exa option "type" = "fast" needs API-key access'])
    expect(validateOptions('tinyfish', { domain_type: 'research_paper' }, 'keyless')).toHaveLength(1)
    expect(validateOptions('tinyfish', { domain_type: 'research_paper' }, 'api-key')).toEqual([])
    expect(() => resolveSettings({ connections: { 'builtin:exa': { options: { type: 'fast' } } } })).toThrow('needs API-key access')
  })
})

describe('version-1 migration', () => {
  it('turns a fixed route into custom:legacy and keeps the other preferences', () => {
    const input = { version: 1, model: 'search', apiKeyEnv: 'MY_KEY', maxTokens: 100, fallbackModel: 'dropped', freshness: 'fresh', connections: { 'builtin:tavily': { disabled: true } } }
    const original = structuredClone(input)
    const migrated = migrateConfig(input)
    expect(migrated).toEqual({
      version: 2, freshness: 'fresh', defaultConnection: 'custom:legacy',
      connections: {
        'builtin:tavily': { disabled: true },
        'custom:legacy': {
          kind: 'model', label: 'Imported search model', trustedEndpoint: true, options: { maxTokens: 100 },
          binding: { mode: 'fixed', protocol: 'anthropic-messages', model: 'search', baseURL: 'https://api.deepseek.com/anthropic/v1', credentialRef: 'MY_KEY' },
        },
      },
    })
    expect(input).toEqual(original)
    expect(migrateConfig(migrated)).toEqual(migrated)
  })

  it('maps current-session mode to the session model connection', () => {
    expect(migrateConfig({ modelMode: 'current-session', freshness: 'realtime' })).toEqual({ version: 2, freshness: 'realtime', defaultConnection: SESSION_MODEL_ID })
  })

  it('detects versions and refuses what it cannot migrate', () => {
    expect(needsMigration({})).toBe(false)
    expect(needsMigration({ model: 'legacy' } as object)).toBe(true)
    expect(needsMigration({ version: 2, model: 'ignored' } as object)).toBe(false)
    expect(migrateConfig({ connections: { 'builtin:exa': { label: 'Work' } } })).toEqual({ connections: { 'builtin:exa': { label: 'Work' } } })
    for (const version of [0, 1.5, '2', 3]) expect(() => migrateConfig({ version, model: 'x' })).toThrow(/version/)
    expect(() => migrateConfig({ version: 1, apiKey: 'fixture-key' })).toThrow('DSH Credentials')
    expect(() => migrateConfig({ version: 1, maxTokens: -1 })).toThrow('invalid search settings')
    expect(() => importLegacy({ version: 1, connections: { 'custom:legacy': custom } })).toThrow('already exists')
    expect(() => importLegacy({ version: 2 })).toThrow('version-1')
  })
})

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})

/** A real profile boot with Loader, ConfigEditor, Settings and this plugin under `entryId`. */
async function profile(options: { legacy?: Record<string, unknown>; entryId?: string; credentials?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'search-profile-')))
  cleanups.push(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), JSON.stringify({ name: 'test-installation' }))
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const ns = options.entryId ?? plugin.name
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'web', name: 'cordis:web', config: { searchProvider: 'enhanced-search' } },
    { id: ns, name: 'cordis:search' },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), JSON.stringify([]))
  if (options.legacy) writeFileSync(join(home, 'settings.yaml'), JSON.stringify({ [ns]: options.legacy }))
  const context: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const secrets = new Map<string, string>()
  const credentials = {
    resolve: vi.fn(async (ref: string) => secrets.has(ref) ? { value: secrets.get(ref)! } : undefined),
    set: vi.fn(async (ref: string, value: string) => { secrets.set(ref, value) }),
  }
  const start = async (withCredentials = options.credentials !== false): Promise<Context> => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', context), ctx => {
      ctx.provide('profileContext', context)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      if (withCredentials) ctx.provide('credentials', credentials as never)
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, web: WebRuntime, search: plugin })
    })
    cleanups.push(() => ctx.fiber.dispose())
    return ctx
  }
  const ctx = await start()
  const form = (context = ctx) => context.settings.describe().find(row => row.ns === ns)!
  return { ctx, ns, home, patchPath: context.patchPath, start, form, credentials, secrets }
}

describe('settings in a real profile', () => {
  it('applies live edits without remounting and persists them across restart', async () => {
    const h = await profile({ entryId: 'search-alias' })
    const fiber = () => [...h.ctx.loader.entries()].find(entry => entry.options.id === h.ns)!.fiber
    const mounted = fiber()
    expect(h.form().autoGenerate).toBe(false)
    await h.ctx.settings.update(h.ns, { version: 2, freshness: 'realtime' }, h.form().revision)
    expect(fiber()).toBe(mounted)
    expect(h.form().value).toMatchObject({ version: 2, freshness: 'realtime' })
    await expect(h.ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_SEARCH_CONTEXT_UNAVAILABLE' })
    await h.ctx.fiber.dispose()
    expect(h.form(await h.start()).value).toMatchObject({ version: 2, freshness: 'realtime' })
  })

  it('rejects unsafe edits before they reach the profile', async () => {
    const h = await profile()
    const before = readFileSync(h.patchPath, 'utf8')
    await expect(h.ctx.settings.update(h.ns, { connections: { 'custom:x': { ...custom, endpoint: 'https://untrusted.test' } } })).rejects.toThrow('trustedEndpoint')
    await expect(h.ctx.settings.update(h.ns, { version: 2, apiKey: 'fixture-not-real' })).rejects.toThrow('DSH Credentials')
    await expect(h.ctx.settings.update(h.ns, { version: 3, model: 'future' })).rejects.toThrow('newer plugin version')
    expect(readFileSync(h.patchPath, 'utf8')).toBe(before)
  })

  it.each([{ model: 'search', maxTokens: 2048 }, { modelMode: 'current-session' }])('migrates the imported settings.yaml section %j', async legacy => {
    const h = await profile({ legacy })
    await vi.waitFor(() => expect(h.form().value).toHaveProperty('version', 2))
    expect(existsSync(join(h.home, 'settings.yaml.imported'))).toBe(true)
    expect(h.form().value).not.toHaveProperty('model')
    expect(h.form().value).not.toHaveProperty('modelMode')
    expect(h.credentials.set).not.toHaveBeenCalled()
  })

  it('moves a literal key into DSH Credentials and never writes it to the profile', async () => {
    const h = await profile({ legacy: { model: 'search', apiKey: 'fixture-legacy-key', apiKeyEnv: 'LEGACY_SEARCH' } })
    await vi.waitFor(() => expect(h.form().value).toMatchObject({ version: 2, defaultConnection: 'custom:legacy' }))
    expect(h.secrets.get('LEGACY_SEARCH')).toBe('fixture-legacy-key')
    expect(h.form().value).not.toHaveProperty('apiKey')
    expect(readFileSync(h.patchPath, 'utf8')).not.toContain('fixture-legacy-key')
  })

  it('keeps a failed migration in place and retries once Credentials is available', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = await profile({ credentials: false, legacy: { apiKey: 'fixture-retry-key' } })
    await vi.waitFor(() => expect(h.form().value).toHaveProperty('apiKey', 'fixture-retry-key'))
    expect(h.form().value).not.toHaveProperty('version')
    await h.ctx.fiber.dispose()
    const restored = await h.start(true)
    await vi.waitFor(() => expect(h.form(restored).value).toHaveProperty('version', 2))
    expect(h.secrets.get('WEB_SEARCH_ENHANCED_API')).toBe('fixture-retry-key')
  })

  it('replans when the document changes while the key is being stored', async () => {
    const h = await profile()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const resolve = h.credentials.resolve.getMockImplementation()!
    h.credentials.resolve.mockImplementationOnce(async ref => { await gate; return resolve(ref) })
    await h.ctx.settings.update(h.ns, { version: 1, model: 'search', apiKey: 'fixture-race-key', maxTokens: 100 })
    await vi.waitFor(() => expect(h.credentials.resolve).toHaveBeenCalled())
    await h.ctx.settings.update(h.ns, { maxTokens: 200 }, h.form().revision)
    release()
    await vi.waitFor(() => expect(h.form().value).toMatchObject({ version: 2, connections: { 'custom:legacy': { options: { maxTokens: 200 } } } }))
    expect(h.credentials.set).toHaveBeenCalledTimes(1)
    expect(readFileSync(h.patchPath, 'utf8')).not.toContain('fixture-race-key')
  })
})
