/** V2 session-scoped search connections for DSH's native web_search tool. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { resolveSettings, importLegacy, type V2Config } from './config.ts'
import { installBridge } from './dsh/bridge.ts'
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
  })
  installBridge(ctx, () => {
    const value = current()
    // Old global routes must be imported deliberately rather than silently defaulted.
    if (value.version !== 2 && ['modelMode', 'protocol', 'baseURL', 'model', 'apiKeyEnv'].some(k => (value as Record<string, unknown>)[k] !== undefined)) throw new Error('Legacy settings require explicit V2 import')
    return resolveSettings(value)
  })
}
export { resolveSettings, importLegacy }
export type { V2Config, Connection, FixedBinding } from './config.ts'
// Fixed-config helper compatibility only; the installed provider always uses the V2 bridge.
export { resolveConfig, createProvider, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_MODEL } from './model-config.ts'
export { EnhancedSearchProvider } from './provider.ts'
export type { SearchProtocol, ResolvedConfig } from './protocols.ts'
