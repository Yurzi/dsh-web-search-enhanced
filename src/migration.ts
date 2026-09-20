import type { V2Config } from './config.ts'
import { SESSION_MODEL_ID } from './catalog.ts'
/** Explicit, secret-free legacy import; never writes settings or enables fallback. */
export function importLegacy(raw: Record<string, unknown>): V2Config {
  if (raw.apiKey) throw new Error('Move legacy apiKey to DSH Credentials before importing V2')
  if (raw.modelMode === 'current-session') return { version: 2, defaultConnection: SESSION_MODEL_ID }
  // Imported custom IDs must never overwrite an existing user's connection.
  const existing = raw.connections && typeof raw.connections === 'object' && !Array.isArray(raw.connections) ? raw.connections as NonNullable<V2Config['connections']> : {}
  if (Object.hasOwn(existing, 'custom:legacy')) throw new Error('custom:legacy already exists; rename it before importing')
  const options = Object.fromEntries(['apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize'].filter(k => raw[k] !== undefined).map(k => [k, raw[k]]))
  return { version: 2, defaultConnection: 'custom:legacy', connections: { ...structuredClone(existing), 'custom:legacy': {
    kind: 'model', label: 'Imported search model', trustedEndpoint: true,
    binding: { mode: 'fixed', protocol: raw.protocol ?? 'anthropic-messages', model: raw.model ?? 'deepseek-flash', baseURL: raw.baseURL ?? 'https://api.deepseek.com/anthropic/v1', credentialRef: raw.apiKeyEnv ?? 'WEB_SEARCH_ENHANCED_API' }, options,
  } } }
}
