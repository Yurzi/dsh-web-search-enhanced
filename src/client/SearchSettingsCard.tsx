import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
interface CredentialRemoteFailure { ok: false; error: { message: string } }
interface CredentialRemoteSuccess<T> { ok: true; value: T }
type CredentialRemoteResult<T> = CredentialRemoteSuccess<T> | CredentialRemoteFailure
export interface CredentialRemote {
  describe: (refs: string[]) => Promise<CredentialRemoteResult<Record<string, { configured: boolean; writable?: boolean }>>>
  set: (ref: string, value: string) => Promise<CredentialRemoteResult<unknown>>
}
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import type { LocaleKey } from './locales.ts'

export type SearchProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-chat-completions'
export type ModelMode = 'configured' | 'current-session'
export interface SearchSettings {
  modelMode?: ModelMode
  protocol?: SearchProtocol
  baseURL?: string
  model?: string
  fallbackModel?: string
  apiKeyEnv?: string
  apiVersion?: string
  toolIdentifier?: string
  maxTokens?: number
  maxUses?: number
  chatSearchMode?: 'search-model' | 'vendor-options'
  searchContextSize?: 'low' | 'medium' | 'high'
}
export interface SearchSettingsCardProps { scope: SettingsScope<SearchSettings>; credentials: CredentialRemote; t: (key: LocaleKey) => string }
interface Draft {
  modelMode: ModelMode; protocol: SearchProtocol; baseURL: string; model: string; fallbackModel: string; apiKeyEnv: string; apiVersion: string
  toolIdentifier: string; maxTokens: string; maxUses: string; chatSearchMode: 'search-model' | 'vendor-options'; searchContextSize: '' | 'low' | 'medium' | 'high'
}
const editableFields = ['modelMode', 'protocol', 'baseURL', 'model', 'fallbackModel', 'apiKeyEnv', 'apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize'] as const

/** Convert resolved settings into a stable form draft. */
export function draftFrom(value: SearchSettings | undefined): Draft {
  return {
    modelMode: value?.modelMode ?? 'configured',
    protocol: value?.protocol ?? 'anthropic-messages',
    baseURL: value?.baseURL ?? 'https://api.deepseek.com/anthropic/v1',
    model: value?.model ?? 'deepseek-flash',
    fallbackModel: value?.fallbackModel ?? '',
    apiKeyEnv: value?.apiKeyEnv ?? 'WEB_SEARCH_ENHANCED_API',
    apiVersion: value?.apiVersion ?? '2023-06-01',
    toolIdentifier: value?.toolIdentifier ?? '',
    maxTokens: String(value?.maxTokens ?? 4096),
    maxUses: String(value?.maxUses ?? 5),
    chatSearchMode: value?.chatSearchMode ?? 'search-model',
    searchContextSize: value?.searchContextSize ?? '',
  }
}

/** Validate a draft and return field-specific locale keys. */
export async function saveCredential(credentials: CredentialRemote, ref: string, value: string): Promise<boolean> {
  const secret = value.trim()
  if (secret.length === 0) return false
  const result = await credentials.set(ref.trim(), secret)
  if (!result.ok) throw new Error(result.error.message)
  return true
}

export function validateDraft(draft: Draft): Partial<Record<keyof Draft, LocaleKey>> {
  const errors: Partial<Record<keyof Draft, LocaleKey>> = {}
  try {
    const url = new URL(draft.baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.baseURL = 'invalidURL'
  } catch { errors.baseURL = 'invalidURL' }
  if (draft.model.trim().length === 0) errors.model = 'invalidRequired'
  if (draft.apiKeyEnv.trim().length === 0) errors.apiKeyEnv = 'invalidRequired'
  if (draft.apiKeyEnv.trim().length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(draft.apiKeyEnv.trim())) errors.apiKeyEnv = 'invalidCredentialRef'
  if (draft.apiVersion.trim().length === 0) errors.apiVersion = 'invalidRequired'
  if (draft.toolIdentifier.length > 0 && !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(draft.toolIdentifier)) errors.toolIdentifier = 'invalidIdentifier'
  if (!positiveInteger(draft.maxTokens)) errors.maxTokens = 'invalidInteger'
  if (!positiveInteger(draft.maxUses)) errors.maxUses = 'invalidInteger'
  return errors
}

const cardCss = `
.wse-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  transition: border-color .16s, background .16s;
}
.wse-card:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
.wse-card[data-open='true'] {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.wse-header {
  width: 100%;
  appearance: none;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
}
.wse-header:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
.wse-head {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wse-name {
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.wse-desc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 1.5;
}
.wse-pending {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
}
.wse-chevron {
  box-sizing: border-box;
  flex: none;
  width: 8px;
  height: 8px;
  margin-right: 3px;
  border-right: 1.5px solid var(--dsw-alias-label-tertiary);
  border-bottom: 1.5px solid var(--dsw-alias-label-tertiary);
  transform: rotate(45deg);
  transition: transform .16s;
}
.wse-card[data-open='true'] .wse-chevron {
  transform: rotate(225deg);
}
.wse-body {
  border-top: 1px solid var(--dsw-alias-border-l2);
  margin: 0 16px;
  padding-bottom: 8px;
}
.wse-fields {
  display: flex;
  flex-direction: column;
}
.wse-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.wse-field + .wse-field {
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.wse-label {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}
.wse-input, .wse-select {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 0 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  transition: border-color .16s, background .16s;
}
.wse-input:focus-visible, .wse-select:focus-visible,
.wse-input:focus, .wse-select:focus {
  border-color: var(--dsw-alias-brand-primary);
  outline: none;
}
.wse-input[aria-invalid='true'] {
  border-color: var(--dsw-alias-label-error);
}
.wse-input:disabled, .wse-select:disabled {
  cursor: default;
  color: var(--dsw-alias-label-tertiary);
  opacity: .55;
}
.wse-hint, .wse-error, .wse-readonly, .wse-failed {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.wse-hint {
  color: var(--dsw-alias-label-tertiary);
}
.wse-error, .wse-failed {
  color: var(--dsw-alias-label-error);
}
.wse-readonly {
  margin: 12px 0 0;
  color: var(--dsw-alias-label-tertiary);
}
.wse-footer {
  border-top: 1px solid var(--dsw-alias-border-l2);
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 4px;
}
.wse-failed {
  flex: 1;
  min-width: 0;
  margin: 0;
}
.wse-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.wse-button {
  appearance: none;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 5px 14px;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  transition: color .16s, border-color .16s, background .16s, opacity .16s;
}
.wse-button:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-dimmed);
  background: var(--dsw-alias-bg-layer-4);
}
.wse-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.wse-button:disabled {
  opacity: .4;
  cursor: default;
}
.wse-save {
  border-color: transparent;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-layer-3));
}
.wse-save:hover:not(:disabled) {
  background: var(--dsw-alias-label-primary);
  opacity: .9;
}
`

export function SearchSettingsCard({ scope, credentials, t }: SearchSettingsCardProps) {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope))
  const resolved = useMemo(() => draftFrom(snapshot.value), [snapshot.value])
  const [draft, setDraft] = useState(resolved)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [resetToProfile, setResetToProfile] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [credentialConfigured, setCredentialConfigured] = useState(false)
  const bodyId = useId()
  useEffect(() => { if (!saving && !hasDraft) setDraft(resolved) }, [hasDraft, resolved, saving])
  useEffect(() => {
    const ref = draft.apiKeyEnv.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref)) { setCredentialConfigured(false); return }
    let active = true
    void credentials.describe([ref]).then(result => {
      if (active) setCredentialConfigured(result.ok && result.value[ref]?.configured === true)
    }).catch(() => { if (active) setCredentialConfigured(false) })
    return () => { active = false }
  }, [credentials, draft.apiKeyEnv])
  const errors = useMemo(() => validateDraft(draft), [draft])
  const dirty = resetToProfile || apiKey.length > 0 || JSON.stringify(draft) !== JSON.stringify(resolved)
  const invalid = Object.keys(errors).length > 0
  const disabled = snapshot.status !== 'ready' || !snapshot.writable || saving
  const edit = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft(current => ({ ...current, [field]: value }))
    setResetToProfile(false); setHasDraft(true); setFailed(false)
  }
  const save = async () => {
    if (disabled || !dirty || invalid) return
    setSaving(true); setFailed(false)
    try {
      if (await saveCredential(credentials, draft.apiKeyEnv, apiKey)) setCredentialConfigured(true)
      if (resetToProfile) {
        for (const field of editableFields) await scope.unset(field)
      } else {
        await scope.set('modelMode', draft.modelMode)
        await scope.set('protocol', draft.protocol)
        await scope.set('baseURL', draft.baseURL.trim())
        await scope.set('model', draft.model.trim())
        if (draft.fallbackModel.trim().length === 0) await scope.unset('fallbackModel')
        else await scope.set('fallbackModel', draft.fallbackModel.trim())
        await scope.set('apiKeyEnv', draft.apiKeyEnv.trim())
        await scope.set('apiVersion', draft.apiVersion.trim())
        if (draft.toolIdentifier.trim().length === 0) await scope.unset('toolIdentifier')
        else await scope.set('toolIdentifier', draft.toolIdentifier.trim())
        await scope.set('maxTokens', Number(draft.maxTokens))
        await scope.set('maxUses', Number(draft.maxUses))
        await scope.set('chatSearchMode', draft.chatSearchMode)
        if (draft.searchContextSize === '') await scope.unset('searchContextSize')
        else await scope.set('searchContextSize', draft.searchContextSize)
      }
      setApiKey(''); setHasDraft(false); setResetToProfile(false); setOpen(false)
    } catch { setFailed(true) } finally { setSaving(false) }
  }
  const reset = () => { setApiKey(''); setDraft(draftFrom(asSearchSettings(snapshot.base))); setResetToProfile(true); setHasDraft(true); setFailed(false) }
  const discard = () => { setApiKey(''); setDraft(resolved); setResetToProfile(false); setHasDraft(false); setFailed(false) }
  if (snapshot.status === 'unavailable') return null
  const toolHint: LocaleKey = draft.protocol === 'anthropic-messages' ? 'toolHintAnthropic' : draft.protocol === 'openai-responses' ? 'toolHintResponses' : draft.chatSearchMode === 'search-model' ? 'toolHintChatOfficial' : 'toolHintChatVendor'
  return <li className="wse-card" data-open={open} data-plugin-key="web-search-enhanced" data-wse-card="true">
    <style>{cardCss}</style>
    <button type="button" className="wse-header" aria-expanded={open} aria-controls={bodyId} aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`} onClick={() => { setOpen(value => !value) }}>
      <span className="wse-head"><span className="wse-name">{t('title')}</span><span className="wse-desc">{t('description')}</span></span>
      {dirty ? <span className="wse-pending">{t('unsaved')}</span> : null}<span className="wse-chevron" aria-hidden="true" />
    </button>
    {open ? <div className="wse-body" id={bodyId}>
      {!snapshot.writable && snapshot.status === 'ready' ? <p className="wse-readonly" role="status">{t('readOnly')}</p> : null}
      <div className="wse-fields">
        <SelectField label={t('modelMode')} hint={t('modelModeHint')} value={draft.modelMode} disabled={disabled} onChange={value => { edit('modelMode', value as ModelMode) }} options={[["configured",t('configuredMode')],["current-session",t('currentSessionMode')]]} />
        <SelectField label={t('protocol')} hint={t('protocolHint')} value={draft.protocol} disabled={disabled} onChange={value => { edit('protocol', value as SearchProtocol) }} options={[["anthropic-messages",t('anthropic')],["openai-responses",t('responses')],["openai-chat-completions",t('chat')]]} />
        <TextField label={t('toolIdentifier')} hint={t(toolHint)} value={draft.toolIdentifier} error={errors.toolIdentifier === undefined ? undefined : t(errors.toolIdentifier)} disabled={disabled || (draft.protocol === 'openai-chat-completions' && draft.chatSearchMode === 'search-model')} onChange={value => { edit('toolIdentifier', value) }} />
        <TextField label={t('baseURL')} hint={t('baseURLHint')} value={draft.baseURL} error={errors.baseURL === undefined ? undefined : t(errors.baseURL)} disabled={disabled} onChange={value => { edit('baseURL', value) }} />
        <TextField label={t('model')} hint={t('modelHint')} value={draft.model} error={errors.model === undefined ? undefined : t(errors.model)} disabled={disabled} onChange={value => { edit('model', value) }} />
        <TextField label={t('fallbackModel')} hint={t('fallbackModelHint')} value={draft.fallbackModel} error={errors.fallbackModel === undefined ? undefined : t(errors.fallbackModel)} disabled={disabled} onChange={value => { edit('fallbackModel', value) }} />
        <TextField label={t('apiKeyEnv')} hint={credentialConfigured ? t('credentialConfigured') : t('apiKeyEnvHint')} value={draft.apiKeyEnv} error={errors.apiKeyEnv === undefined ? undefined : t(errors.apiKeyEnv)} disabled={disabled} onChange={value => { edit('apiKeyEnv', value) }} />
        <TextField type="password" label={t('apiKey')} hint={t('apiKeyHint')} value={apiKey} disabled={disabled} onChange={value => { setApiKey(value); setHasDraft(true); setFailed(false) }} />
        <TextField inputMode="numeric" label={t('maxTokens')} hint={t('maxTokensHint')} value={draft.maxTokens} error={errors.maxTokens === undefined ? undefined : t(errors.maxTokens)} disabled={disabled} onChange={value => { edit('maxTokens', value) }} />
        {draft.modelMode === 'current-session' ? (
          <>
            <TextField inputMode="numeric" label={t('maxUses')} hint={t('maxUsesHint')} value={draft.maxUses} error={errors.maxUses === undefined ? undefined : t(errors.maxUses)} disabled={disabled} onChange={value => { edit('maxUses', value) }} />
            <TextField label={t('apiVersion')} hint={t('apiVersionHint')} value={draft.apiVersion} error={errors.apiVersion === undefined ? undefined : t(errors.apiVersion)} disabled={disabled} onChange={value => { edit('apiVersion', value) }} />
            <SelectField label={t('chatSearchMode')} hint={t('chatSearchModeHint')} value={draft.chatSearchMode} disabled={disabled} onChange={value => { edit('chatSearchMode', value as Draft['chatSearchMode']) }} options={[["search-model",t('chatOfficial')],["vendor-options",t('chatVendor')]]} />
            <SelectField label={t('searchContextSize')} hint={t('searchContextSizeHint')} value={draft.searchContextSize} disabled={disabled} onChange={value => { edit('searchContextSize', value as Draft['searchContextSize']) }} options={[["",t('contextDefault')],["low",t('contextLow')],["medium",t('contextMedium')],["high",t('contextHigh')]]} />
          </>
        ) : draft.protocol === 'anthropic-messages' ? (
          <>
            <TextField inputMode="numeric" label={t('maxUses')} hint={t('maxUsesHint')} value={draft.maxUses} error={errors.maxUses === undefined ? undefined : t(errors.maxUses)} disabled={disabled} onChange={value => { edit('maxUses', value) }} />
            <TextField label={t('apiVersion')} hint={t('apiVersionHint')} value={draft.apiVersion} error={errors.apiVersion === undefined ? undefined : t(errors.apiVersion)} disabled={disabled} onChange={value => { edit('apiVersion', value) }} />
          </>
        ) : (
          <>
            {draft.protocol === 'openai-chat-completions' ? (
              <SelectField label={t('chatSearchMode')} hint={t('chatSearchModeHint')} value={draft.chatSearchMode} disabled={disabled} onChange={value => { edit('chatSearchMode', value as Draft['chatSearchMode']) }} options={[["search-model",t('chatOfficial')],["vendor-options",t('chatVendor')]]} />
            ) : null}
            <SelectField label={t('searchContextSize')} hint={t('searchContextSizeHint')} value={draft.searchContextSize} disabled={disabled} onChange={value => { edit('searchContextSize', value as Draft['searchContextSize']) }} options={[["",t('contextDefault')],["low",t('contextLow')],["medium",t('contextMedium')],["high",t('contextHigh')]]} />
          </>
        )}
      </div>
      <div className="wse-footer">
        {failed ? <p className="wse-failed" role="alert">{t('failed')}</p> : null}
        <div className="wse-actions">
          <button type="button" className="wse-button" disabled={disabled || resetToProfile} onClick={reset}>{t('reset')}</button>
          <button type="button" className="wse-button" disabled={disabled || !dirty} onClick={discard}>{t('discard')}</button>
          <button type="button" className="wse-button wse-save" disabled={disabled || !dirty || invalid} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</button>
        </div>
      </div>
    </div> : null}
  </li>
}

interface TextFieldProps { label: string; hint: string; value: string; error?: string | undefined; disabled: boolean; inputMode?: 'text' | 'numeric' | undefined; type?: 'text' | 'password' | undefined; onChange: (value: string) => void }
function TextField(props: TextFieldProps) {
  const id = useId(); const describedBy = useId()
  return <div className="wse-field"><label className="wse-label" htmlFor={id}>{props.label}</label><input id={id} className="wse-input" type={props.type ?? 'text'} value={props.value} disabled={props.disabled} inputMode={props.inputMode} aria-invalid={props.error === undefined ? undefined : true} aria-describedby={describedBy} spellCheck={false} onChange={event => { props.onChange(event.target.value) }} /><p id={describedBy} className={props.error === undefined ? 'wse-hint' : 'wse-error'}>{props.error ?? props.hint}</p></div>
}
interface SelectFieldProps { label: string; hint: string; value: string; disabled: boolean; options: readonly (readonly [string,string])[]; onChange: (value: string) => void }
function SelectField(props: SelectFieldProps) {
  const id = useId(); const describedBy = useId()
  return <div className="wse-field"><label className="wse-label" htmlFor={id}>{props.label}</label><select id={id} className="wse-select" value={props.value} disabled={props.disabled} aria-describedby={describedBy} onChange={event => { props.onChange(event.target.value) }}>{props.options.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><p id={describedBy} className="wse-hint">{props.hint}</p></div>
}
function asSearchSettings(value: unknown): SearchSettings | undefined { return typeof value === 'object' && value !== null ? value as SearchSettings : undefined }
function positiveInteger(value: string): boolean { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 }
