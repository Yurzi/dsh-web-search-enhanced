/** Write-only key entry: the value goes to DSH Credentials and never into settings. */
import { useId, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CredentialInfo, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '../connections.ts'
import css from './Settings.module.css'

export type SaveCredential = (ref: string, value: string) => Promise<RemoteResult<unknown>>

type Outcome = { readonly kind: 'saved' } | { readonly kind: 'failed'; readonly message: string } | undefined

export function CredentialEditor({ credentialRef, info, save, t }: {
  credentialRef: string
  /** Undefined until the Host describes the reference. */
  info: CredentialInfo | undefined
  save: SaveCredential
  t: Translate
}) {
  const id = useId()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(undefined)
  const readOnly = info?.writable === false
  const submit = async (): Promise<void> => {
    setBusy(true)
    setOutcome(undefined)
    const result = await save(credentialRef, value.trim())
    setBusy(false)
    if (result.ok) setValue('')
    setOutcome(result.ok ? { kind: 'saved' } : { kind: 'failed', message: result.error.message })
  }
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.fieldLabel} htmlFor={id}>{t('credential.label')}</label>
        {info === undefined ? null : <span className={css.fieldState}>{t(info.configured ? 'credential.set' : 'credential.unset')}</span>}
      </div>
      <form className={css.inline} onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <Input
          id={id} className={css.input as string} type="password" autoComplete="new-password" spellCheck={false}
          placeholder={t('credential.placeholder')} value={value} disabled={readOnly || busy}
          onChange={(event) => { setValue(event.target.value); setOutcome(undefined) }}
        />
        <Button type="submit" variant="outline" disabled={readOnly || busy || value.trim() === ''}>
          {busy ? t('saving') : t('credential.save')}
        </Button>
      </form>
      <p className={css.hint}>{t(readOnly ? 'credential.readOnly' : 'credential.hint', { ref: credentialRef })}</p>
      {outcome?.kind === 'saved' ? <p className={css.success} role="status">{t('credential.saved')}</p> : null}
      {outcome?.kind === 'failed' ? <p className={css.error} role="alert">{t('credential.failed', { message: outcome.message })}</p> : null}
    </div>
  )
}
