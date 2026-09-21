/** V2 session-scoped search connections for DSH's native web_search tool. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { parseDocument } from 'yaml'
import { resolveSettings, type V2Config } from './config.ts'
import { importLegacy, needsMigration } from './migration.ts'
import { installBridge } from './dsh/bridge.ts'
import { searchError } from './search/service.ts'
export const name = 'web-search-enhanced'
export const inject = ['web']
export const DEFAULT_PROVIDER_ID = 'enhanced-search'
export const SETTINGS_NAMESPACE = 'web-search-enhanced'
export type Config = V2Config & { apiKey?: string; modelMode?: string; protocol?: string; baseURL?: string; model?: string; fallbackModel?: string; apiKeyEnv?: string; apiVersion?: string; toolIdentifier?: string; maxTokens?: number; maxUses?: number; chatSearchMode?: string; searchContextSize?: string; providerId?: string }
/** Legacy fields are readable only for explicit migration; they never select a V2 route. */
export const Config: z<Config> = z.object({
  version: z.const(2), defaultConnection: z.string(), freshness: z.union(['auto', 'fresh', 'realtime'] as const), connections: z.dict(z.any()),
  apiKey: z.string().role('secret'), modelMode: z.string(), protocol: z.string(), baseURL: z.string(), model: z.string(), fallbackModel: z.string(), apiKeyEnv: z.string().role('credential-ref'),
  apiVersion: z.string(), toolIdentifier: z.string(), maxTokens: z.number(), maxUses: z.number(), chatSearchMode: z.string(), searchContextSize: z.string(), providerId: z.string(),
})
export function validateSettings(value: Config): void {
  if (value.providerId !== undefined && value.providerId !== DEFAULT_PROVIDER_ID) throw new Error('providerId cannot be changed')
  if (value.apiKey) throw new Error('Move legacy apiKey to DSH Credentials; V2 never reads literal keys')
  resolveSettings(value)
}
export function apply(ctx: Context, config: Config = {}): void {
  let current = () => config
  validateSettings(config)
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, config, {
      setSource(source) { current = source }, onChange() {}, validate: validateSettings,
    })
    // Auto-detect and migrate every supported legacy v1 field on startup / upgrade.
    const descriptor = settingsCtx.settings.describe().find(d => d.ns === SETTINGS_NAMESPACE)
    const user = descriptor?.user as Record<string, unknown> | undefined
    if (user && needsMigration(user)) {
      void (async () => {
        const raw = { ...user }
        const secret = raw.apiKey
        delete raw.apiKey
        const migrated = importLegacy(raw)
        validateSettings(migrated) // Validate before writing any credential.
        raw.apiKey = secret
        if (secret && !ctx.get('credentials')) throw new Error('Credentials unavailable')
        if (typeof raw.apiKey === 'string' && raw.apiKey.trim() && ctx.get('credentials')) {
          const targetRef = (typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv.trim()) || 'WEB_SEARCH_ENHANCED_API'
          await ctx.credentials.set(credentialRef(targetRef), raw.apiKey.trim())
          delete raw.apiKey
        }
        await settingsCtx.settings.replace(SETTINGS_NAMESPACE as never, migrated)
      })().catch(() => {
        console.warn('[web-search-enhanced] 自动迁移失败；旧配置已保留。请检查 Credentials 写权限与配置后重启插件。')
      })
    }

    // Preserve the existing automatic YAML flow-style normalization.
    const docPath = (settingsCtx.settings as unknown as { documentPath?: string })?.documentPath
    if (typeof docPath === 'string' && existsSync(docPath)) {
      try {
        const doc = parseDocument(readFileSync(docPath, 'utf8'))
        const node = doc.get(SETTINGS_NAMESPACE, true) as { flow?: boolean; items?: unknown[] } | undefined
        const toBlock = (value: unknown): void => {
          if (!value || typeof value !== 'object') return
          const n = value as { flow?: boolean; items?: unknown[] }
          if (!Array.isArray(n.items)) return
          n.flow = n.items.length === 0
          if (!n.flow) for (const item of n.items) {
            const pair = item as { key?: unknown; value?: unknown }
            if ('key' in pair || 'value' in pair) { toBlock(pair.key); toBlock(pair.value) } else toBlock(item)
          }
        }
        if (node?.flow) { toBlock(node); writeFileSync(docPath, doc.toString(), 'utf8') }
      } catch {
        // Non-fatal for locked or read-only settings files.
      }
    }
  })
  installBridge(ctx, () => {
    const value = current()
    // Old global routes must be imported deliberately rather than silently defaulted.
    if (needsMigration(value)) throw searchError('旧配置自动迁移尚未完成；请检查宿主日志、配置及 Credentials 权限后重启插件', 'WEB_SEARCH_MIGRATION_REQUIRED')
    return resolveSettings(value)
  })
}
export { resolveSettings, importLegacy }
export type { V2Config, Connection, FixedBinding } from './config.ts'
// Fixed-config helper compatibility only; the installed provider always uses the V2 bridge.
export { resolveConfig, createProvider, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_MODEL } from './model-config.ts'
export { EnhancedSearchProvider } from './provider.ts'
export type { SearchProtocol, ResolvedConfig } from './protocols.ts'