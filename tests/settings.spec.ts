/** Real 0.1.7 Loader/profile/ConfigEditor integration, not the removed SettingsProvider. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })
async function fixture(options: { legacy?: Record<string, unknown>; entryId?: string; credentials?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'search-profile-')))
  cleanups.push(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), JSON.stringify({ name: 'test-installation' }))
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const ns = options.entryId ?? plugin.SETTINGS_NAMESPACE
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'web', name: 'cordis:web', config: { searchProvider: plugin.DEFAULT_PROVIDER_ID } },
    { id: ns, name: 'cordis:search' },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), JSON.stringify([]))
  if (options.legacy) writeFileSync(join(home, 'settings.yaml'), JSON.stringify({ [ns]: options.legacy }))
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  const secrets = new Map<string, string>()
  const credentials = {
    resolve: vi.fn(async (ref: string) => secrets.has(ref) ? { value: secrets.get(ref)! } : undefined),
    set: vi.fn(async (ref: string, value: string) => { secrets.set(ref, value) }),
  }
  const start = async (withCredentials = options.credentials !== false): Promise<Context> => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      if (withCredentials) ctx.provide('credentials', credentials as never)
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, web: WebRuntime, search: plugin })
    })
    cleanups.push(() => ctx.fiber.dispose())
    return ctx
  }
  const ctx = await start()
  const descriptor = (context = ctx) => context.settings.describe().find(row => row.ns === ns)!
  return { ctx, ns, home, profile, start, descriptor, credentials, secrets }
}

describe('profile-backed volatile search settings', () => {
  it('updates live references without remounting and restores sparse preferences on restart', async () => {
    const h = await fixture({ entryId: 'search-alias' })
    const fiber = [...h.ctx.loader.entries()].find(e => e.options.id === h.ns)!.fiber!
    expect(h.descriptor().value).toEqual({ connections: {} })
    expect(h.descriptor().autoGenerate).toBe(false)
    await h.ctx.settings.update(h.ns, { version: 2, freshness: 'realtime' }, h.descriptor().revision)
    expect([...h.ctx.loader.entries()].find(e => e.options.id === h.ns)!.fiber).toBe(fiber)
    expect(plugin.readConfig(fiber.config as plugin.Config).freshness).toBe('realtime')
    expect(h.descriptor().user).toEqual({ version: 2, freshness: 'realtime' })
    await expect(h.ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_SEARCH_CONTEXT_UNAVAILABLE' })
    await h.ctx.fiber.dispose()
    const restored = await h.start()
    expect(h.descriptor(restored).value).toMatchObject({ version: 2, freshness: 'realtime' })
  })
  it('rejects unsafe live edits before persistence and refuses stale revisions', async () => {
    const h = await fixture()
    const before = readFileSync(h.profile.patchPath, 'utf8')
    await expect(h.ctx.settings.update(h.ns, { providerId: 'other' })).rejects.toThrow('providerId cannot be changed')
    await expect(h.ctx.settings.update(h.ns, { connections: { 'builtin:exa': { endpoint: 'https://untrusted.test' } } })).rejects.toThrow()
    await expect(h.ctx.settings.update(h.ns, { version: 2, apiKey: 'fixture-not-real' })).rejects.toThrow('DSH Credentials')
    expect(readFileSync(h.profile.patchPath, 'utf8')).toBe(before)
    const revision = h.descriptor().revision
    await h.ctx.settings.update(h.ns, { freshness: 'fresh' }, revision)
    await expect(h.ctx.settings.update(h.ns, { freshness: 'realtime' }, revision)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  })
  it.each([{ modelMode: 'configured', model: 'deepseek-flash', apiKeyEnv: 'MY_SEARCH_KEY', maxTokens: 2048 }, { maxTokens: 2048 }, { fallbackModel: 'obsolete' }, { searchContextSize: 'high' }])('migrates the host-imported legacy document %j', async legacy => {
    const h = await fixture({ legacy })
    await vi.waitFor(() => expect(h.descriptor().value).toMatchObject({ version: 2, defaultConnection: 'custom:legacy' }))
    expect(existsSync(join(h.home, 'settings.yaml.imported'))).toBe(true)
    expect(h.descriptor().value).not.toHaveProperty('modelMode')
    expect(h.descriptor().value).not.toHaveProperty('maxTokens')
  })
  it('moves literal credentials before removing legacy values from the active profile', async () => {
    const h = await fixture({ legacy: { model: 'search', apiKey: 'fixture-legacy-key', apiKeyEnv: 'LEGACY_SEARCH' } })
    await vi.waitFor(() => expect(h.descriptor().value).toHaveProperty('version', 2))
    expect(h.secrets.get('LEGACY_SEARCH')).toBe('fixture-legacy-key')
    expect(readFileSync(h.profile.patchPath, 'utf8')).not.toContain('fixture-legacy-key')
    expect(h.credentials.set).toHaveBeenCalledTimes(1)
  })
  it('preserves failed migration in the profile and retries when credentials become available', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = await fixture({ credentials: false, legacy: { model: 'search', apiKey: 'fixture-retry-key' } })
    await vi.waitFor(() => expect(h.descriptor().value).toHaveProperty('apiKey', 'fixture-retry-key'))
    expect(h.descriptor().value).not.toHaveProperty('version')
    await h.ctx.fiber.dispose()
    const restored = await h.start(true)
    await vi.waitFor(() => expect(h.descriptor(restored).value).toHaveProperty('version', 2))
    expect(h.secrets.get('WEB_SEARCH_ENHANCED_API')).toBe('fixture-retry-key')
  })
})
