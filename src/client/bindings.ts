import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CredentialRemote } from './SearchSettingsCard.tsx'
import type { SearchConnectionRemote } from './SearchConnectionSelector.tsx'

/** Services stay in the apply world; the renderer binds this bare source to useSettings. */
export function settingsInjection<T>(form: ConfigForm<T>, credentials: CredentialRemote) {
  return {
    hooks: { settings: form },
    mutateSettings: (operations: Parameters<ConfigForm<T>['mutate']>[0], revision: number) => form.mutate(operations, revision),
    describeCredentials: (refs: string[]): ReturnType<CredentialRemote['describe']> => credentials.describe(refs),
    setCredential: (ref: string, value: string): ReturnType<CredentialRemote['set']> => credentials.set(ref, value),
  }
}
export type SettingsFace<T> = InjectFace<ReturnType<typeof settingsInjection<T>>>
export type SearchLocaleProps = PropsLocale<'settings.webSearchEnhanced'>

/** Bind each callback to its slot's Session, rather than exposing a remote service. */
export function selectionInjection(remote: SearchConnectionRemote, sessionId: string) {
  return {
    getSelection: () => remote.get({ sessionId }),
    setSelection: (request: Omit<Parameters<SearchConnectionRemote['set']>[0], 'sessionId'>) => remote.set({ ...request, sessionId }),
  }
}
