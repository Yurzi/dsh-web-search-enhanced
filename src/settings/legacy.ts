/** Pure migration of the version-1 single-route settings (dsh-web-search-enhanced 0.0.x). */
import { SESSION_MODEL_ID } from '../catalog.ts'
import { resolveSettings } from './resolve.ts'
import type { V2Config } from './types.ts'
import { CURRENT_CONFIG_VERSION, LEGACY_FIELDS, configVersion } from './version.ts'

/** Connection a version-1 fixed route becomes. */
export const LEGACY_CONNECTION_ID = 'custom:legacy'
/** Credential reference of a version-1 route that named none. */
export const LEGACY_CREDENTIAL_REF = 'WEB_SEARCH_ENHANCED_API'

const MODEL_OPTION_FIELDS = ['apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize'] as const
const legacyField = (key: string): boolean => key === 'version' || (LEGACY_FIELDS as readonly string[]).includes(key)

export function needsMigration(raw: { readonly version?: unknown }): boolean {
  return configVersion(raw) < CURRENT_CONFIG_VERSION
}

/**
 * Convert version-1 settings. Fields outside the legacy route (connections,
 * preferences) carry over; `fallbackModel` is dropped.
 * @throws on other versions, a literal `apiKey` (move it to DSH Credentials
 * first) or an existing `custom:legacy` connection.
 */
export function importLegacy(raw: Readonly<Record<string, unknown>>): V2Config {
  if (configVersion(raw) !== 1) throw new Error('legacy import needs version-1 settings')
  if (raw.apiKey) throw new Error('move the legacy apiKey to DSH Credentials before migrating')
  // Unvalidated values: migrateConfig resolves the result.
  const kept: Record<string, unknown> = Object.fromEntries(Object.entries(structuredClone(raw)).filter(([key]) => !legacyField(key)))
  if (raw.modelMode === 'current-session') return { ...kept, version: CURRENT_CONFIG_VERSION, defaultConnection: kept.defaultConnection ?? SESSION_MODEL_ID } as V2Config
  const connections = kept.connections ?? {}
  if (typeof connections !== 'object' || Array.isArray(connections)) throw new Error('invalid search settings: connections must be an object')
  if (Object.hasOwn(connections, LEGACY_CONNECTION_ID)) throw new Error(`${LEGACY_CONNECTION_ID} already exists; rename it before migrating`)
  const options = Object.fromEntries(MODEL_OPTION_FIELDS.filter(key => raw[key] !== undefined).map(key => [key, raw[key]]))
  const migrated: Record<string, unknown> = {
    ...kept,
    version: CURRENT_CONFIG_VERSION,
    defaultConnection: kept.defaultConnection ?? LEGACY_CONNECTION_ID,
    connections: {
      ...connections,
      [LEGACY_CONNECTION_ID]: {
        kind: 'model', label: 'Imported search model', trustedEndpoint: true, options,
        binding: {
          mode: 'fixed',
          protocol: raw.protocol ?? 'anthropic-messages',
          model: raw.model ?? 'deepseek-flash',
          baseURL: raw.baseURL ?? 'https://api.deepseek.com/anthropic/v1',
          credentialRef: raw.apiKeyEnv ?? LEGACY_CREDENTIAL_REF,
        },
      },
    },
  }
  return migrated as V2Config
}

/**
 * Bring stored settings to the current version and validate the result.
 * @throws when the result would not resolve, or the version is newer than this plugin.
 */
export function migrateConfig(raw: object): V2Config {
  const migrated = needsMigration(raw) ? importLegacy(raw as Readonly<Record<string, unknown>>) : structuredClone(raw) as V2Config
  resolveSettings(migrated)
  return migrated
}