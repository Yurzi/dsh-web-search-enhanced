/**
 * Live migration of the stored settings document. DSH imports a legacy
 * `settings.yaml` only after the Loader activates this plugin, so the migrator
 * reacts to document updates and writes with the revision it read: a
 * concurrent edit is never overwritten, it starts another pass instead.
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { LEGACY_CREDENTIAL_REF, migrateConfig, needsMigration } from './legacy.ts'
import { configVersion } from './version.ts'

/** Install on a context that injects `settings`; `namespace` is the plugin's Loader entry id. */
export function installMigrator(ctx: Context, namespace: string): void {
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'web-search-enhanced settings migrator')
  /** Revision of the last attempt; a failed attempt is retried only on a new revision or new Credentials. */
  let attempted: number | undefined
  let passes = Promise.resolve()
  const schedule = (): void => { passes = passes.then(migrate) }

  async function migrate(): Promise<void> {
    if (lifetime.signal.aborted) return
    const form = ctx.settings.describe().find(descriptor => descriptor.ns === namespace)
    if (form === undefined || form.revision === attempted) return
    attempted = form.revision
    try {
      const stored = form.value as Readonly<Record<string, unknown>>
      if (!needsMigration(stored)) return
      const { apiKey, ...legacy } = stored
      const migrated = migrateConfig({ ...legacy, version: configVersion(stored) })
      if (typeof apiKey === 'string' && apiKey.trim() !== '') {
        const ref = typeof legacy.apiKeyEnv === 'string' && legacy.apiKeyEnv.trim() !== '' ? legacy.apiKeyEnv.trim() : LEGACY_CREDENTIAL_REF
        await moveKey(ctx, ref, apiKey.trim())
      }
      if (lifetime.signal.aborted) return
      await ctx.settings.replace(namespace, migrated, form.revision)
    } catch (error) {
      // A concurrent edit produced a newer revision, which schedules its own pass.
      if (error instanceof SettingsConflictError) return
      ctx.logger.warn('web-search-enhanced: legacy settings were not migrated and stay in place; searches report WEB_SEARCH_MIGRATION_REQUIRED until this succeeds: %s', error instanceof Error ? error.message : String(error))
    }
  }

  ctx.on('settings/document-updated', ns => { if (ns === namespace) schedule() })
  ctx.inject(['credentials'], () => {
    attempted = undefined
    schedule()
  })
  schedule()
}

/** Store a version-1 literal key under `ref`, refusing to replace a different stored value. */
async function moveKey(ctx: Context, ref: string, value: string): Promise<void> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new Error('DSH Credentials is not available, so the legacy apiKey cannot be moved yet')
  const existing = await credentials.resolve(credentialRef(ref))
  if (existing !== undefined && existing.value !== value) throw new Error(`credential ${ref} already holds a different value; remove one of them`)
  if (existing === undefined) await credentials.set(credentialRef(ref), value)
}
