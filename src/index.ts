/** Session-scoped search connections for DSH's native web_search tool. */
import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { FRESHNESS } from './catalog.ts'
import { installSearch } from './host/runtime.ts'
import { searchError } from './search/errors.ts'
import { migrateConfig, needsMigration } from './settings/legacy.ts'
import { installMigrator } from './settings/migrator.ts'
import { resolveSettings, type ResolvedSettings } from './settings/resolve.ts'
import type { V2Config } from './settings/types.ts'
import { configVersion } from './settings/version.ts'

export const name = 'web-search-enhanced'
export const inject = ['web']

/** Stored values: the version-2 document, plus version-1 fields kept only until the migrator converts them. */
export interface ConfigValues extends Omit<V2Config, 'version'> {
  version?: number
  modelMode?: string
  protocol?: string
  baseURL?: string
  model?: string
  fallbackModel?: string
  apiKey?: string
  apiKeyEnv?: string
  apiVersion?: string
  toolIdentifier?: string
  maxTokens?: number
  maxUses?: number
  chatSearchMode?: string
  searchContextSize?: string
}

export type Config = { [K in keyof ConfigValues]-?: Volatile<ConfigValues[K]> }

/** Every field is live: the settings page edits it without remounting the plugin. */
export const Config: z<ConfigValues, Config> = z.object({
  version: z.number().volatile(),
  defaultConnection: z.string().volatile(),
  freshness: z.union(FRESHNESS).volatile(),
  showSelector: z.boolean().volatile(),
  connections: z.dict(z.any()).volatile(),
  modelMode: z.string().volatile(),
  protocol: z.string().volatile(),
  baseURL: z.string().volatile(),
  model: z.string().volatile(),
  fallbackModel: z.string().volatile(),
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').volatile(),
  apiVersion: z.string().volatile(),
  toolIdentifier: z.string().volatile(),
  maxTokens: z.number().volatile(),
  maxUses: z.number().volatile(),
  chatSearchMode: z.string().volatile(),
  searchContextSize: z.string().volatile(),
})

export function apply(ctx: Context, config: Config): void {
  const values = (): ConfigValues => readConfig(config)
  validate(values())
  // Reject an invalid edit before the Loader persists it.
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const raw = next()
    if (this === ctx.fiber) validate(readConfig(Config(raw as ConfigValues)))
    return raw
  })
  const namespace = ctx.fiber.entry?.options.id ?? name
  ctx.inject(['settings'], settingsCtx => {
    // The client contributes the settings page.
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    installMigrator(settingsCtx, namespace)
  })
  installSearch(ctx, () => currentSettings(values()))
}

function readConfig(config: Config): ConfigValues {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, value.get()]).filter(([, value]) => value !== undefined)) as ConfigValues
}

/** Legacy fields may be stored while migration is pending, but must migrate to a valid document. */
function validate(values: ConfigValues): void {
  const { apiKey, ...rest } = values
  if (apiKey && !needsMigration(values)) throw new Error('web-search-enhanced never stores literal API keys; store the key in DSH Credentials and reference it with credentialRef')
  migrateConfig({ ...rest, version: configVersion(values) })
}

function currentSettings(values: ConfigValues): ResolvedSettings {
  if (needsMigration(values)) {
    throw searchError('WEB_SEARCH_MIGRATION_REQUIRED', 'the legacy search settings are not migrated yet; ask the user to check the host log and DSH Credentials, then restart the plugin')
  }
  try {
    return resolveSettings(values as V2Config)
  } catch (error) {
    throw searchError('WEB_SEARCH_CONFIG_INVALID', `${error instanceof Error ? error.message : String(error)}; ask the user to fix the search connection settings`)
  }
}

export { migrateConfig, resolveSettings }
export type { ResolvedSettings, V2Config }
