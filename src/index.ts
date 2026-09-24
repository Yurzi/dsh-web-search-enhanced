/** Session-scoped search connections for DSH's native web_search tool. */
import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { resolveSettings, type V2Config } from './config.ts'
import { importLegacy, needsMigration } from './migration.ts'
import { installBridge } from './dsh/bridge.ts'
import { searchError } from './search/service.ts'
export const name = 'web-search-enhanced'
export const inject = ['web']
export const DEFAULT_PROVIDER_ID = 'enhanced-search'
export const SETTINGS_NAMESPACE = 'web-search-enhanced'
export type ConfigValues = V2Config & { apiKey?: string; modelMode?: string; protocol?: string; baseURL?: string; model?: string; fallbackModel?: string; apiKeyEnv?: string; apiVersion?: string; toolIdentifier?: string; maxTokens?: number; maxUses?: number; chatSearchMode?: string; searchContextSize?: string; providerId?: string }
export type Config = { [K in keyof ConfigValues]-?: Volatile<ConfigValues[K]> }
/** Loader owns live references; SettingsForms projects these fields into the profile editor. */
export const Config: z<ConfigValues, Config> = z.object({
  version: z.const(2).volatile(), defaultConnection: z.string().volatile(), freshness: z.union(['auto', 'fresh', 'realtime'] as const).volatile(), connections: z.dict(z.any()).volatile(),
  apiKey: z.string().role('secret').volatile(), modelMode: z.string().volatile(), protocol: z.string().volatile(), baseURL: z.string().volatile(), model: z.string().volatile(), fallbackModel: z.string().volatile(), apiKeyEnv: z.string().role('credential-ref').volatile(),
  apiVersion: z.string().volatile(), toolIdentifier: z.string().volatile(), maxTokens: z.number().volatile(), maxUses: z.number().volatile(), chatSearchMode: z.string().volatile(), searchContextSize: z.string().volatile(), providerId: z.string().volatile(),
})
export function readConfig(config: Config): ConfigValues {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, value.get()]).filter(([, value]) => value !== undefined)) as ConfigValues
}
export function validateSettings(value: ConfigValues): void {
  if (value.providerId !== undefined && value.providerId !== DEFAULT_PROVIDER_ID) throw new Error('providerId cannot be changed')
  if (value.apiKey) throw new Error('Move legacy apiKey to DSH Credentials; V2 never reads literal keys')
  resolveSettings(value)
}
/** Legacy values may enter the profile for migration, but can never serve a search. */
function validateCandidate(value: ConfigValues): void {
  if (!needsMigration(value)) return validateSettings(value)
  const { apiKey: _secret, ...legacy } = value
  validateSettings({ ...importLegacy(legacy), ...(value.providerId !== undefined ? { providerId: value.providerId } : {}) })
}
export function apply(ctx: Context, config: Config): void {
  const current = () => readConfig(config)
  validateCandidate(current())
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const raw = next()
    if (this === ctx.fiber) validateCandidate(readConfig(Config(raw as ConfigValues)))
    return raw
  })
  const namespace = ctx.fiber.entry?.options.id ?? SETTINGS_NAMESPACE
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    let closed = false
    let running = false
    let attemptedRevision: number | undefined
    settingsCtx.effect(() => () => { closed = true })
    const migrate = async () => {
      if (closed || running) return
      running = true
      try {
        // DSH imports settings.yaml only AFTER Loader activation. Read the live form,
        // not a startup copy, and use CAS so concurrent edits are never overwritten.
        const descriptor = settingsCtx.settings.describe().find(d => d.ns === namespace)
        if (!descriptor || descriptor.revision === attemptedRevision) return
        const raw = descriptor.value as ConfigValues
        if (!needsMigration(raw)) return
        attemptedRevision = descriptor.revision
        const { apiKey, ...legacy } = raw
        const migrated = importLegacy(legacy)
        validateSettings(migrated)
        if (apiKey?.trim()) {
          const credentials = ctx.get('credentials')
          if (!credentials) throw new Error('Credentials unavailable')
          const ref = credentialRef(raw.apiKeyEnv?.trim() || 'WEB_SEARCH_ENHANCED_API')
          const existing = await credentials.resolve(ref)
          if (existing && existing.value !== apiKey.trim()) throw new Error('Credential already exists')
          if (!existing) await credentials.set(ref, apiKey.trim())
        }
        if (closed) return
        await settingsCtx.settings.replace(namespace, migrated, descriptor.revision)
      } catch {
        console.warn('[web-search-enhanced] 自动迁移失败；旧配置已保留在 profile 或 settings.yaml.imported。请检查 Credentials、配置和宿主日志后重启插件。')
      } finally { running = false }
    }
    const schedule = () => { queueMicrotask(() => { void migrate() }) }
    settingsCtx.on('settings/document-updated', ns => { if (ns === namespace) schedule() })
    settingsCtx.on('loader/volatile-update', function (this: Fiber) { if (this === ctx.fiber) schedule() })
    settingsCtx.inject(['credentials'], () => { attemptedRevision = undefined; schedule() })
    // Avoid waiting for the Loader inside apply: that would deadlock its activation.
    if (ctx.get('loader')) void ctx.root.loader.await().then(schedule).catch(() => {})
    schedule()
  })
  installBridge(ctx, () => {
    const value = current()
    if (needsMigration(value)) throw searchError('旧配置自动迁移尚未完成；请检查 profile、宿主日志及 Credentials 权限后重启插件', 'WEB_SEARCH_MIGRATION_REQUIRED')
    return resolveSettings(value)
  })
}
export { resolveSettings, importLegacy }
export type { V2Config, Connection, FixedBinding } from './config.ts'
// Fixed-config helper compatibility only; the installed provider always uses the V2 bridge.
export { resolveConfig, createProvider, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_MODEL } from './model-config.ts'
export { EnhancedSearchProvider } from './provider.ts'
export type { SearchProtocol, ResolvedConfig } from './protocols.ts'
