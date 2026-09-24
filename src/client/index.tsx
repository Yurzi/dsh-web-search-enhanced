import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context } from '@deepseek-ai/cordis'
import type { V2Config } from '../config.ts'
import { V2Settings } from './V2Settings.tsx'
import { SearchConnectionSelector, type SearchConnectionRemote } from './SearchConnectionSelector.tsx'
import { selectionInjection, settingsInjection } from './bindings.ts'
import { SelectionClient } from './selection-client.ts'
import { searchContribution } from '../remote-contract.ts'
import { en, zh, type LocaleKey } from './locales.ts'
const NS = 'web-search-enhanced'
const LOCALE = 'settings.webSearchEnhanced'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.webSearchEnhanced': LocaleKey }
}
export const inject = ['connection', 'slots', 'locale', 'configForms', 'remote', 'remote.credentials']
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(LOCALE, { en, zh }), 'search dictionaries')
  const form = ctx.configForms.get<V2Config>(NS)
  let selectionClient: SelectionClient | undefined
  const settings = settingsInjection(form, ctx.remote.credentials, () => selectionClient?.invalidate())
  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: 'dsh-web-search-enhanced', locale: LOCALE,
    inject: () => settings,
  }, V2Settings))), 'search settings page')
  const dispose = await ctx.remote.$mount(searchContribution)
  ctx.effect(() => dispose, 'search selection remote')
  // This namespace is created by $mount above. A top-level dependency would
  // prevent apply from running; access it only from its child injection scope.
  ctx.inject(['remote.searchConnections'], searchCtx => {
    const client = new SelectionClient(
      (searchCtx.remote as unknown as { searchConnections: SearchConnectionRemote }).searchConnections,
    )
    selectionClient = client
    searchCtx.effect(() => () => {
      client.dispose()
      if (selectionClient === client) selectionClient = undefined
    }, 'search selection cache')
    searchCtx.effect(() => form.subscribe(() => client.invalidate()), 'search settings invalidation')
    const connection = searchCtx.get('connection') as ConnectionHandle
    searchCtx.effect(() => connection.generation.subscribe(() => client.reset()), 'search connection invalidation')
    searchCtx.slots.inject('conversation.input.right', () => searchCtx.slots.register({
      name: 'conversation.input.right', id: 'search-connection', order: 20, locale: LOCALE,
      inject: sessionId => selectionInjection(client, sessionId),
    }, SearchConnectionSelector))
  })
}
