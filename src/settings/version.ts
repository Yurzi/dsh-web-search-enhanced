/**
 * Settings schema version, independent of the npm, Host and storage versions.
 * Dependency-free so the client and the Host share one contract.
 */
export const CURRENT_CONFIG_VERSION = 2 as const

/** Fields of the version-1 single-route format (dsh-web-search-enhanced 0.0.x). */
export const LEGACY_FIELDS = ['modelMode', 'protocol', 'baseURL', 'model', 'fallbackModel', 'apiKey', 'apiKeyEnv', 'apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize'] as const

/**
 * Read the schema version of a stored settings value. An unversioned value is
 * version 1 when it carries a legacy field and version 2 otherwise.
 * @throws when `version` is not a positive integer or is newer than this plugin.
 */
export function configVersion(raw: { readonly version?: unknown }): number {
  const { version } = raw
  if (version === undefined) return LEGACY_FIELDS.some(key => (raw as Record<string, unknown>)[key] !== undefined) ? 1 : CURRENT_CONFIG_VERSION
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('settings version must be a positive integer')
  if (version > CURRENT_CONFIG_VERSION) throw new Error('settings were written by a newer plugin version; upgrade the plugin')
  return version
}
