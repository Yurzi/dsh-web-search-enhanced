/** V2 session-scoped search connections for DSH's native web_search tool. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { parseDocument } from 'yaml'
import { resolveSettings, importLegacy, type V2Config } from './config.ts'
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
    // Auto-detect and migrate legacy v1 user configuration on startup / upgrade
    const descriptor = settingsCtx.settings.describe().find(d => d.ns === SETTINGS_NAMESPACE)
    const user = descriptor?.user as Record<string, unknown> | undefined
    if (user && user.version !== 2 && ['modelMode', 'protocol', 'baseURL', 'model', 'apiKeyEnv'].some(k => user[k] !== undefined)) {
      try {
        const raw = { ...user }
        if (typeof raw.apiKey === 'string' && raw.apiKey.trim() && ctx.get('credentials')) {
          const targetRef = (typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv.trim()) || 'WEB_SEARCH_ENHANCED_API'
          void ctx.credentials.set(credentialRef(targetRef), raw.apiKey.trim()).catch(() => {})
          delete raw.apiKey
        }
        const migrated = importLegacy(raw)
        void settingsCtx.settings.replace(SETTINGS_NAMESPACE as never, migrated).catch(() => {})
      } catch {
        // Fall back gracefully to manual import in settings UI
      }
    }

    // Auto-correct flow-style inline JSON formatting in settings.yaml if present
    const docPath = (settingsCtx.settings as unknown as { documentPath?: string })?.documentPath
    if (typeof docPath === 'string' && existsSync(docPath)) {
      try {
        const text = readFileSync(docPath, 'utf8')
        const doc = parseDocument(text)
        const node = doc.get(SETTINGS_NAMESPACE, true) as { flow?: boolean; items?: unknown[] } | undefined
        if (node && node.flow) {
          const toBlock = (n: unknown): void => {
            if (!n || typeof n !== 'object') return
            const m = n as { flow?: boolean; items?: unknown[] }
            if (Array.isArray(m.items)) {
              if (m.items.length === 0) m.flow = true
              else {
                m.flow = false
                for (const item of m.items) {
                  const pair = item as { key?: unknown; value?: unknown }
                  if (pair && typeof pair === 'object' && ('key' in pair || 'value' in pair)) {
                    toBlock(pair.key); toBlock(pair.value)
                  } else toBlock(item)
                }
              }
            }
          }
          toBlock(node)
          writeFileSync(docPath, doc.toString(), 'utf8')
        }
      } catch {
        // Non-fatal: ignored under locked or read-only filesystems
      }
    }
  })
  installBridge(ctx, () => {
    const value = current()
    // Old global routes must be imported deliberately rather than silently defaulted.
    if (value.version !== 2 && ['modelMode', 'protocol', 'baseURL', 'model', 'apiKeyEnv'].some(k => (value as Record<string, unknown>)[k] !== undefined)) throw searchError('请在搜索连接设置中导入旧版配置', 'WEB_SEARCH_MIGRATION_REQUIRED')
    return resolveSettings(value)
  })
}
export { resolveSettings, importLegacy }
export type { V2Config, Connection, FixedBinding } from './config.ts'
// Fixed-config helper compatibility only; the installed provider always uses the V2 bridge.
export { resolveConfig, createProvider, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_MODEL } from './model-config.ts'
export { EnhancedSearchProvider } from './provider.ts'
export type { SearchProtocol, ResolvedConfig } from './protocols.ts'