/**
 * Add or edit one custom connection with plain fields. The editor keeps the
 * document layers and revision it opened with, so a save never overwrites a
 * change made since. An optional key goes to DSH Credentials once the
 * connection is saved.
 */
import { useId, useState } from 'react'
import clsx from 'clsx'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { ADAPTER_IDS, ADAPTERS, MODEL_PROTOCOLS, type AdapterId, type ModelProtocol } from '../../catalog.ts'
import type { CustomConnection } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import {
  asksTrust, buildConnection, CUSTOM_PREFIX, emptyForm, formFields, formOf, suggestCredentialRef,
  type ConnectionForm, type ConnectionKind, type FormError,
} from './connection-form.ts'
import type { SaveCredential } from './CredentialEditor.tsx'
import { PROTOCOL_LABELS } from './model.ts'
import { OptionFields } from './OptionsEditor.tsx'
import { ErrorText, SelectMenu, useWrite, type SettingsDoc, type WriteSettings } from './parts.tsx'
import { sparseSettingOperations } from './sparse.ts'
import css from './Settings.module.css'

export type EditorTarget = { readonly kind: 'new'; readonly type: ConnectionKind } | { readonly kind: 'edit'; readonly id: string }

export function ConnectionEditor({ target, doc, write, saveCredential, taken, onClose, t }: {
  target: EditorTarget
  doc: SettingsDoc
  write: WriteSettings
  saveCredential: SaveCredential
  /** Ids of every existing connection. */
  taken: readonly string[]
  /** Close the editor, with a problem to report after the connection saved. */
  onClose: (problem?: string) => void
  t: Translate
}) {
  const formId = useId()
  const [opened] = useState(() => ({
    layers: doc.layers,
    revision: doc.revision,
    previous: target.kind === 'edit' ? doc.config.connections?.[target.id] as CustomConnection : undefined,
  }))
  const [form, setForm] = useState<ConnectionForm>(() => target.kind === 'edit' && opened.previous !== undefined
    ? formOf(target.id, opened.previous)
    : emptyForm(target.kind === 'new' ? target.type : 'structured'))
  // The reference follows the id until the user edits it.
  const [refEdited, setRefEdited] = useState(target.kind === 'edit')
  const [apiKey, setApiKey] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<FormError | undefined>(undefined)
  const action = useWrite(t)

  const update = (patch: Partial<ConnectionForm>) => {
    setForm(current => ({ ...current, ...patch }) as ConnectionForm)
    setError(undefined)
  }
  const changeId = (suffix: string) => {
    const id = CUSTOM_PREFIX + suffix
    update(refEdited ? { id } : { id, credentialRef: suggestCredentialRef(id) })
  }
  const askTrust = asksTrust(form)
  const submit = async (): Promise<void> => {
    const others = target.kind === 'edit' ? taken.filter(existing => existing !== target.id) : taken
    const result = buildConnection(form, consent, others, opened.previous)
    if (!result.ok) return setError(result.error)
    const ops = sparseSettingOperations(opened.layers, ['connections', result.id], result.connection)
    // The revision the editor opened with fences the write.
    if (!await action.run(() => write(ops, opened.revision))) return
    const key = apiKey.trim()
    if (key === '') return onClose()
    const stored = await saveCredential(form.credentialRef.trim(), key)
    onClose(stored.ok ? undefined : t('editor.keyFailed'))
  }

  const keyField = (
    <div className={css.formField}>
      <label className={css.fieldLabel} htmlFor={formId + '-key'}>{t('editor.apiKey')}</label>
      <Input id={formId + '-key'} className={css.input as string} type="password" autoComplete="new-password" spellCheck={false}
        placeholder={t('credential.placeholder')} value={apiKey} onChange={(event) => { setApiKey(event.target.value) }} />
      <p className={css.hint}>{t('editor.apiKeyHint')}</p>
    </div>
  )
  const refField = (
    <TextField id={formId + '-ref'} label={t('editor.credentialRef')} hint={t('editor.credentialRefHint')} value={form.credentialRef}
      onChange={(credentialRef) => { setRefEdited(true); update({ credentialRef }) }} />
  )
  return (
    <form className={css.editor} aria-labelledby={formId + '-title'} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <h5 className={css.editorTitle} id={formId + '-title'}>
        {target.kind === 'edit' ? t('editor.titleEdit', { id: target.id }) : t('editor.titleNew')}
      </h5>
      <div className={css.formGrid}>
        <TextField id={formId + '-label'} label={t('editor.label')} value={form.label} onChange={label => update({ label })} />
        <div className={css.formField}>
          <label className={css.fieldLabel} htmlFor={formId + '-id'}>{t('editor.id')}</label>
          <span className={clsx(css.prefixed, target.kind === 'edit' && css.prefixedDisabled)}>
            <span className={css.prefix} aria-hidden="true">{CUSTOM_PREFIX}</span>
            <input
              id={formId + '-id'} className={css.prefixedInput} value={form.id.slice(CUSTOM_PREFIX.length)} disabled={target.kind === 'edit'}
              placeholder={t('editor.idPlaceholder')} autoComplete="off" spellCheck={false} aria-describedby={formId + '-id-hint'}
              onChange={(event) => { changeId(event.target.value) }}
            />
          </span>
          <p className={css.hint} id={formId + '-id-hint'}>{t('editor.idHint')}</p>
        </div>
        {form.kind === 'structured' ? (
          <>
            <SelectField label={t('editor.adapter')} value={form.adapter}
              options={ADAPTER_IDS.map(id => ({ id, label: ADAPTERS[id].label }))}
              onChange={adapter => update({ adapter: adapter as AdapterId, options: {} })} />
            <TextField id={formId + '-endpoint'} label={t('editor.endpoint')} hint={t('editor.endpointHint')} type="url"
              placeholder={ADAPTERS[form.adapter].endpoint} value={form.endpoint} onChange={endpoint => update({ endpoint })} />
          </>
        ) : (
          <>
            <SelectField label={t('editor.protocol')} value={form.protocol}
              options={MODEL_PROTOCOLS.map(protocol => ({ id: protocol, label: PROTOCOL_LABELS[protocol] }))}
              onChange={protocol => update({ protocol: protocol as ModelProtocol })} />
            <TextField id={formId + '-model'} label={t('editor.model')} value={form.model} onChange={model => update({ model })} />
            <TextField id={formId + '-base'} label={t('editor.baseURL')} type="url" placeholder="https://" wide
              value={form.baseURL} onChange={baseURL => update({ baseURL })} />
          </>
        )}
        {refField}
        {keyField}
      </div>
      <div className={css.field}>
        <span className={css.fieldLabel}>{t(form.kind === 'structured' ? 'options.title' : 'editor.searchOptions')}</span>
        <OptionFields id={formId + '-option'} fields={formFields(form)} texts={form.options} disabled={false} t={t}
          onEdit={(name, value) => update({ options: { ...form.options, [name]: value } })} />
        <p className={css.hint}>{t('editor.optionsHint')}</p>
      </div>
      {askTrust ? <Checkbox checked={consent} onChange={setConsent} label={trustLabel(form.credentialRef.trim(), t)} /> : null}
      {doc.revision === opened.revision ? null : <p className={css.warning} role="alert">{t('editor.stale')}</p>}
      <ErrorText>{error === undefined ? action.error : t(FORM_ERRORS[error])}</ErrorText>
      <div className={css.actions}>
        <Button type="button" variant="ghost" onClick={() => { onClose() }}>{t('editor.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={(askTrust && !consent) || !doc.editable || action.busy}>
          {action.busy ? t('saving') : t('editor.save')}
        </Button>
      </div>
    </form>
  )
}

const trustLabel = (ref: string, t: Translate): string => ref === '' ? t('editor.trustUnnamed') : t('editor.trust', { ref })

const FORM_ERRORS = {
  id: 'draft.id', duplicate: 'draft.duplicate', label: 'draft.label', credentialRef: 'draft.credentialRef',
  endpoint: 'draft.endpoint', model: 'draft.model', baseURL: 'draft.baseURL', options: 'draft.options', trust: 'draft.trust',
} as const satisfies Record<FormError, string>

function TextField({ id, label, hint, value, onChange, type = 'text', placeholder, wide = false }: {
  id: string; label: string; hint?: string; value: string; onChange: (value: string) => void
  type?: string; placeholder?: string | undefined; wide?: boolean
}) {
  return (
    <div className={clsx(css.formField, wide && css.formWide)}>
      <label className={css.fieldLabel} htmlFor={id}>{label}</label>
      <Input id={id} className={css.input as string} type={type} value={value} placeholder={placeholder}
        autoComplete="off" spellCheck={false} onChange={(event) => { onChange(event.target.value) }} />
      {hint === undefined ? null : <p className={css.hint}>{hint}</p>}
    </div>
  )
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: readonly { id: string; label: string }[]; onChange: (value: string) => void
}) {
  return (
    <div className={css.formField}>
      <span className={css.fieldLabel}>{label}</span>
      <SelectMenu compact label={label} value={value} options={options} disabled={false} onChange={onChange} />
    </div>
  )
}
