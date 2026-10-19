/** Optional request options: labelled inputs over editor text, and a self-saving form around them. */
import { useState, type KeyboardEvent } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../connections.ts'
import { fieldText, fieldValue, isValidText, valueLabel, type FieldSpec, type FieldTexts } from './model.ts'
import { SelectMenu } from './parts.tsx'
import css from './Settings.module.css'

/**
 * A grid of option inputs; empty text means the default. `onSettle` marks
 * a finished edit: a choice from a menu at once, typed text on blur or Enter.
 */
export function OptionFields({ id, fields, texts, disabled, onEdit, onSettle, t }: {
  id: string
  fields: readonly FieldSpec[]
  texts: FieldTexts
  disabled: boolean
  onEdit: (name: string, text: string) => void
  onSettle?: (name: string, text: string) => void
  t: Translate
}) {
  return (
    <div className={css.optionGrid}>
      {fields.map(field => (
        <OptionInput
          key={field.name} id={id + '-' + field.name} field={field} text={texts[field.name] ?? ''} disabled={disabled} t={t}
          onEdit={text => onEdit(field.name, text)} onSettle={text => onSettle?.(field.name, text)}
        />
      ))}
    </div>
  )
}

function OptionInput({ id, field, text, disabled, onEdit, onSettle, t }: {
  id: string; field: FieldSpec; text: string; disabled: boolean
  onEdit: (text: string) => void; onSettle: (text: string) => void; t: Translate
}) {
  // The upstream parameter name stays available to readers of the service's docs.
  const label = t(field.label)
  if (field.kind === 'text' || field.kind === 'integer') {
    const invalid = !isValidText(field, text)
    const settleOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
      event.preventDefault()
      onSettle(text)
    }
    return (
      <div className={css.option}>
        <label className={css.optionName} htmlFor={id}>{label}</label>
        <Input
          id={id} className={css.input as string} value={text} disabled={disabled} aria-invalid={invalid} spellCheck={false}
          title={field.name} inputMode={field.kind === 'integer' ? 'numeric' : undefined}
          placeholder={field.placeholder(t) ?? t('options.default')}
          onChange={(event) => { onEdit(event.target.value.trim() === '' ? '' : event.target.value) }}
          onBlur={() => { onSettle(text) }} onKeyDown={settleOnEnter}
        />
        {invalid ? <span className={css.fieldError}>{t('options.invalid')}</span> : null}
      </div>
    )
  }
  const choices = field.kind === 'boolean'
    ? [{ id: 'true', label: t('options.true') }, { id: 'false', label: t('options.false') }]
    : field.values.map(value => ({ id: value, label: valueLabel(value, t) }))
  return (
    <div className={css.option}>
      <span className={css.optionName}>{label}</span>
      <SelectMenu
        compact label={label} title={field.name} value={text} disabled={disabled}
        options={[{ id: '', label: t('options.default') }, ...choices]}
        onChange={(choice) => { onEdit(choice); onSettle(choice) }}
      />
    </div>
  )
}

/**
 * Options that save themselves, one path per option: a menu choice at once,
 * typed text once it settles and is valid. An invalid draft stays visible with
 * its error; nothing valid is ever held back.
 */
export function OptionsForm({ id, title, hint, fields, stored, disabled, onCommit, t }: {
  id: string
  title: string
  hint: string
  fields: readonly FieldSpec[]
  /** Effective stored options. */
  stored: Readonly<Record<string, unknown>>
  disabled: boolean
  /** Store one option; undefined returns it to its default. Resolves whether the Host accepted it. */
  onCommit: (name: string, value: unknown) => Promise<boolean>
  t: Translate
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  if (fields.length === 0) return null
  const texts: FieldTexts = Object.fromEntries(fields.map(field => [field.name, drafts[field.name] ?? fieldText(stored[field.name])]))
  const forget = (name: string) => { setDrafts(({ [name]: _settled, ...rest }) => rest) }
  const settle = async (name: string, text: string): Promise<void> => {
    const field = fields.find(candidate => candidate.name === name)!
    if (!isValidText(field, text)) return
    if (text === fieldText(stored[name])) return forget(name)
    if (await onCommit(name, fieldValue(field, text))) forget(name)
  }
  return (
    <div className={css.field}>
      <div className={css.fieldHead}><span className={css.fieldLabel}>{title}</span></div>
      <OptionFields
        id={id} fields={fields} texts={texts} disabled={disabled} t={t}
        onEdit={(name, text) => { setDrafts(current => ({ ...current, [name]: text })) }}
        onSettle={(name, text) => { void settle(name, text) }}
      />
      <p className={css.hint}>{hint}</p>
    </div>
  )
}
