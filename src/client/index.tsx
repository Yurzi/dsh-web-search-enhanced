import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { CredentialRemote } from './SearchSettingsCard.tsx'
import type { Context } from '@deepseek-ai/cordis'
import { SearchSettingsCard, type SearchSettings } from './SearchSettingsCard.tsx'
import { en, zh, type LocaleKey } from './locales.ts'

const SETTINGS_NAMESPACE = 'web-search-enhanced'
const LOCALE_NAMESPACE = 'settings.webSearchEnhanced'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.webSearchEnhanced': LocaleKey }
}

/** Browser plugin dependencies. */
export const inject = ['slots', 'locale', 'settingsScope', 'remote', 'remote.credentials']

/** Register the localized card under Settings -> Plugins -> Plugin configuration. */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }), 'web-search-enhanced: settings dictionaries')
  const scope = ctx.settingsScope.bind<SearchSettings>({ namespace: SETTINGS_NAMESPACE })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    locale: LOCALE_NAMESPACE,
    inject: () => ({ scope, credentials: (ctx.remote as unknown as { credentials: CredentialRemote }).credentials, t }),
  }, SearchSettingsCard))

  ctx.inject(['commandUi'], (scope: Context) => {
    const commandUi = (scope as unknown as { commandUi?: { register?: (c: unknown) => () => void } }).commandUi
    if (typeof commandUi?.register === 'function') {
      scope.effect(() => commandUi.register!({
        name: 'search-config',
        label: () => t('commandLabel'),
        description: () => t('commandDescription'),
        available: () => true,
        ui: {
          kind: 'action',
          run: () => {
            const trigger = document.querySelector('[data-slot="sidebar.settings"] button') as HTMLButtonElement | null
            trigger?.click()
            setTimeout(() => {
              const card = document.querySelector('[data-wse-card="true"]')
              card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 200)
          },
        },
      }), 'web-search-enhanced: /search-config action command')
    }
  })
}
