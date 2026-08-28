import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { Context } from '@deepseek-ai/cordis'
import { SearchSettingsCard, type SearchSettings } from './SearchSettingsCard.tsx'
import { en, zh, type LocaleKey } from './locales.ts'

const SETTINGS_NAMESPACE = 'web-search-enhanced'
const LOCALE_NAMESPACE = 'settings.webSearchEnhanced'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.webSearchEnhanced': LocaleKey }
}

/** Browser plugin dependencies. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Register the localized card under Settings → Plugins → Plugin configuration. */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }), 'web-search-enhanced: settings dictionaries')
  const scope = ctx.settingsScope.bind<SearchSettings>({ namespace: SETTINGS_NAMESPACE })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NAMESPACE,
    locale: LOCALE_NAMESPACE,
    inject: () => ({ scope, t }),
  }, SearchSettingsCard))
}
