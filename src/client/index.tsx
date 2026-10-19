/**
 * Browser half of dsh-web-search-enhanced: the composer search seat, the
 * /setup-search command, the plugin's settings page and its activation
 * guidance. Everything session-scoped reads one shared selection state per
 * mounted `searchConnections` Remote.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { searchConnectionsRemote } from '../remote-contract.ts'
import type { V2Config } from '../settings/types.ts'
import { ActivationPrompt } from './ActivationPrompt.tsx'
import { searchCommand } from './command.ts'
import type { Translate } from './connections.ts'
import { en, NS, zh } from './locales.ts'
import { SearchSelections } from './selection.ts'
import { SearchSelector, type Navigation, type SearchSelectorInjected } from './selector/SearchSelector.tsx'
import { CredentialStatus } from './settings/credentials.ts'
import { SettingsPage, type SettingsPageInjected } from './settings/SettingsPage.tsx'

export const inject = ['connection', 'slots', 'locale', 'configForms', 'remote', 'remote.credentials']

/** The Host plugin entry, whose id is also the settings namespace. */
const ENTRY = 'web-search-enhanced'
/** The bundle's package name, which keys its Plugins page slots. */
const PACKAGE = 'dsh-web-search-enhanced'

export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-search: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = ctx.configForms.get<V2Config>(ENTRY)

  const credentials = new CredentialStatus(() => settings.getSnapshot().value, ctx.remote.credentials)
  ctx.effect(() => settings.subscribe(() => { credentials.refresh() }), 'web-search: credential references')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', () => { credentials.refresh() }), 'web-search: credential states')
  const page: SettingsPageInjected = {
    hooks: { settings, credentials: credentials.source },
    mutate: (ops, revision) => settings.mutate(ops, revision),
    saveCredential: (ref, value) => ctx.remote.credentials.set(ref, value),
  }
  ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: PACKAGE, locale: NS, inject: () => page,
  }, SettingsPage))), 'web-search: settings page')
  ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({
    name: 'plugins.bundle.activation', key: PACKAGE, locale: NS,
  }, ActivationPrompt))

  // The Plugins page is optional for the composer seat: without it the menu has no settings link.
  const navigation = createSnapshotStore<Navigation>({ openSettings: undefined })
  ctx.inject(['pluginNavigation'], (scope) => {
    scope.effect(() => {
      navigation.set({ openSettings: () => { scope.pluginNavigation.openBundle(PACKAGE) } })
      return () => { navigation.set({ openSettings: undefined }) }
    }, 'web-search: settings link')
  })

  const unmount = await ctx.remote.$mount(searchConnectionsRemote)
  ctx.effect(() => unmount, 'web-search: searchConnections remote')
  // The namespace exists only after $mount; reach it from its own injection scope.
  ctx.inject(['remote.searchConnections'], scope => { mountSession(scope, settings, navigation, t) })
}

function mountSession(ctx: Context, settings: ConfigForm<V2Config>, navigation: SnapshotStore<Navigation>, t: Translate): void {
  const selections = new SearchSelections(ctx.remote.searchConnections)
  const invalidate = () => { selections.invalidate() }
  // Connection status depends on settings (including LLM routes), credentials, and the Host process.
  ctx.effect(() => ctx.remote.$on('settings/document-updated', invalidate), 'web-search: settings invalidation')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', invalidate), 'web-search: credential invalidation')
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => connection.generation.subscribe(invalidate), 'web-search: connection invalidation')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'web-search', order: 20, locale: NS,
    inject: (sessionId: SessionId): SearchSelectorInjected => ({
      hooks: { selection: selections.source(sessionId), settings, navigation },
      load: modelKey => selections.load(sessionId, modelKey),
      refresh: () => selections.refresh(sessionId),
      select: update => selections.set(sessionId, update),
    }),
  }, SearchSelector))

  // Optional: the composer seat works on hosts without the command UI.
  ctx.inject(['commandUi'], (scope) => {
    scope.effect(() => scope.commandUi.register(searchCommand(selections, t)), 'web-search: /setup-search')
  })
}
