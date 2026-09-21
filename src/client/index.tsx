import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRemote } from './SearchSettingsCard.tsx'
import type { V2Config } from '../config.ts'
import { V2Settings } from './V2Settings.tsx'
import { SearchConnectionSelector, type SearchConnectionRemote } from './SearchConnectionSelector.tsx'
import { searchContribution } from '../remote-contract.ts'
import { en, zh, type LocaleKey } from './locales.ts'
const NS = 'web-search-enhanced'
const LOCALE = 'settings.webSearchEnhanced'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.webSearchEnhanced': LocaleKey }
}
export const inject = ['slots', 'locale', 'settingsScope', 'remote', 'remote.credentials']
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(LOCALE, { en, zh }), 'search dictionaries')
  const scope = ctx.settingsScope.bind<V2Config>({ namespace: NS })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: NS, locale: LOCALE,
    inject: () => ({ scope, credentials: (ctx.remote as unknown as { credentials: CredentialRemote }).credentials }),
  }, V2Settings))
  const dispose = await ctx.remote.$mount(searchContribution)
  ctx.effect(() => dispose, 'search selection remote')
  // This namespace is created by $mount above. A top-level dependency would
  // prevent apply from running; access it only from its child injection scope.
  ctx.inject(['remote.searchConnections'], searchCtx => {
    searchCtx.slots.inject('conversation.input.right', () => searchCtx.slots.register({
      name: 'conversation.input.right', id: 'search-connection', order: 20,
      inject: sessionId => ({ sessionId, remote: (searchCtx.remote as unknown as { searchConnections: SearchConnectionRemote }).searchConnections }),
    }, SearchConnectionSelector))
  })
}
