import { record, resolveSettings, type V2Config } from './config.ts'
import { SESSION_MODEL_ID } from './catalog.ts'
import { configVersion, CURRENT_CONFIG_VERSION, LEGACY_FIELDS } from './config-version.ts'
export { LEGACY_FIELDS } from './config-version.ts'
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>
// Historical steps have fixed output versions, never CURRENT_CONFIG_VERSION.
const migrations: Readonly<Record<number, Migration>> = {
  1: raw => ({ ...importLegacy(raw) }),
}

/** Pure migration plan. Credentials and CAS persistence belong to the caller. */
export function migrateConfig(value: unknown): V2Config {
  let raw = structuredClone(record(value, 'settings'))
  let version = configVersion(raw)
  while (version < CURRENT_CONFIG_VERSION) {
    const step = migrations[version]
    if (!step) throw new Error('missing settings migration step')
    raw = step(raw)
    if (raw.version !== version + 1) throw new Error('invalid settings migration step')
    version++
  }
  if (raw.apiKey) throw new Error('Move legacy apiKey to DSH Credentials; V2 never reads literal keys')
  resolveSettings(raw as V2Config)
  return raw as V2Config
}

export function needsMigration(value: object): boolean {
  const raw = value as Record<string, unknown>
  return configVersion(raw) < CURRENT_CONFIG_VERSION
}
/** Explicit, secret-free legacy import; never writes settings or enables fallback. */
export function importLegacy(raw: Record<string, unknown>): V2Config {
  if (raw.version !== undefined && configVersion(raw) !== 1) throw new Error('legacy import requires version 1')
  if (raw.connections !== undefined) record(raw.connections, 'connections')
  if (raw.apiKey) throw new Error('Move legacy apiKey to DSH Credentials before importing V2')
  const preserved = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'version' && !LEGACY_FIELDS.includes(key as typeof LEGACY_FIELDS[number])))
  if (raw.modelMode === 'current-session') return { ...structuredClone(preserved), version: 2, defaultConnection: raw.defaultConnection as string | undefined ?? SESSION_MODEL_ID }
  // Imported custom IDs must never overwrite an existing user's connection.
  const existing = raw.connections && typeof raw.connections === 'object' && !Array.isArray(raw.connections) ? raw.connections as NonNullable<V2Config['connections']> : {}
  if (Object.hasOwn(existing, 'custom:legacy')) throw new Error('custom:legacy already exists; rename it before importing')
  const options = Object.fromEntries(['apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize'].filter(k => raw[k] !== undefined).map(k => [k, raw[k]]))
  return { ...structuredClone(preserved), version: 2, defaultConnection: raw.defaultConnection as string | undefined ?? 'custom:legacy', connections: { ...structuredClone(existing), 'custom:legacy': {
    kind: 'model', label: 'Imported search model', trustedEndpoint: true,
    binding: { mode: 'fixed', protocol: raw.protocol ?? 'anthropic-messages', model: raw.model ?? 'deepseek-flash', baseURL: raw.baseURL ?? 'https://api.deepseek.com/anthropic/v1', credentialRef: raw.apiKeyEnv ?? 'WEB_SEARCH_ENHANCED_API' }, options,
  } } }
}
