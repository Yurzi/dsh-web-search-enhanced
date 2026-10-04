/** Plugin configuration format, independent of npm, host and storage versions.
 * Keep this module dependency-free so the client and server share the contract.
 */
export const CURRENT_CONFIG_VERSION = 2 as const
export const LEGACY_FIELDS = ['modelMode', 'protocol', 'baseURL', 'model', 'fallbackModel', 'apiKey', 'apiKeyEnv', 'apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize'] as const

export function configVersion(raw: { version?: unknown }): number {
  const version = raw.version
  if (version === undefined) {
    return LEGACY_FIELDS.some(key => (raw as Record<string, unknown>)[key] !== undefined) ? 1 : 2 // Historical unversioned connection format is always V2.
  }
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new Error('settings version must be a positive safe integer')
  }
  if (version > CURRENT_CONFIG_VERSION) {
    throw new Error('unsupported settings version; upgrade the plugin (automatic downgrade is disabled)')
  }
  return version
}
