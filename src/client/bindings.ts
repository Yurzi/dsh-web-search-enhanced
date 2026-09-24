import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CredentialRemote } from './SearchSettingsCard.tsx'
import type { SelectionClient, SelectionReadOptions } from './selection-client.ts'

/** Services stay in the apply world; the renderer binds this bare source to useSettings. */
export function settingsInjection<T>(form: ConfigForm<T>, credentials: CredentialRemote, credentialsChanged?: () => void) {
  return {
    hooks: { settings: form },
    mutateSettings: (operations: Parameters<ConfigForm<T>['mutate']>[0], revision: number) => form.mutate(operations, revision),
    describeCredentials: (refs: string[]): ReturnType<CredentialRemote['describe']> => credentials.describe(refs),
    setCredential: async (ref: string, value: string): ReturnType<CredentialRemote['set']> => {
      const result = await credentials.set(ref, value)
      if (result.ok) credentialsChanged?.()
      return result
    },
  }
}
export type SettingsFace<T> = InjectFace<ReturnType<typeof settingsInjection<T>>>
export type SearchLocaleProps = PropsLocale<'settings.webSearchEnhanced'>

/** Bind each callback to its slot's Session, rather than exposing a remote service. */
export function selectionInjection(client: SelectionClient, sessionId: string) {
  return {
    getSelection: (options?: SelectionReadOptions) => client.get(sessionId, options),
    setSelection: (request: Parameters<SelectionClient['set']>[1]) => client.set(sessionId, request),
  }
}
