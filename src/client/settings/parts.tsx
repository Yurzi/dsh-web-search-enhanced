/** Building blocks shared by the settings sections. */
import { useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { V2Config } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import type { SettingsLayers } from './sparse.ts'
import css from './Settings.module.css'

/** The accepted document a section edits. */
export interface SettingsDoc {
  readonly config: V2Config
  readonly layers: SettingsLayers
  readonly revision: number
  /** Writable and in the current schema version. */
  readonly editable: boolean
}

/**
 * Submit operations fenced by a revision (default: the one the page shows);
 * resolves whether the Host accepted them. No operations is a no-op success.
 */
export type WriteSettings = (ops: readonly SettingsPathOpView[], revision?: number) => Promise<boolean>

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <h4 className={css.sectionTitle}>{title}</h4>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Title and hint on the left, one control on the right; wraps under the text on narrow pages. */
export function SettingRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className={css.settingRow}>
      <div className={css.settingText}>
        <div className={css.settingTitle}>{title}</div>
        <div className={css.hint}>{hint}</div>
      </div>
      <div className={css.settingControl}>{children}</div>
    </div>
  )
}

export interface SelectOption { readonly id: string; readonly label: string }

/** A dropdown in the settings pill style, built on the shared Menu. */
export function SelectMenu({ label, title, value, options, disabled, onChange, compact = false }: {
  label: string
  /** Hover text, e.g. the upstream name of an option. */
  title?: string
  value: string
  options: readonly SelectOption[]
  disabled: boolean
  onChange: (id: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.id === value)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={options.map(option => ({ id: option.id, label: option.label }))}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        if (id !== value) onChange(id)
      }}
      align="end"
      portal
      className={css.selectAnchor}
      anchor={(
        <button
          type="button"
          className={compact ? css.selectCompact : css.select}
          aria-label={label}
          title={title}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.selectValue}>{current?.label ?? value}</span>
          <IconChevronDownOutlineRegular className={css.selectChevron} />
        </button>
      )}
    />
  )
}

export interface WriteState {
  readonly busy: boolean
  readonly error: string | undefined
  /** Run one write, recording a refusal or a transport failure as this section's error. */
  run(work: () => Promise<boolean>): Promise<boolean>
}

/** Pending state and the last failure of one section's writes. */
export function useWrite(t: Translate): WriteState {
  const [state, setState] = useState<{ busy: boolean; error: string | undefined }>({ busy: false, error: undefined })
  const run = async (work: () => Promise<boolean>): Promise<boolean> => {
    setState({ busy: true, error: undefined })
    try {
      const accepted = await work()
      setState({ busy: false, error: accepted ? undefined : t('settings.refused') })
      return accepted
    } catch (error) {
      setState({ busy: false, error: t('settings.failed', { message: error instanceof Error ? error.message : String(error) }) })
      return false
    }
  }
  return { ...state, run }
}

export function ErrorText({ children }: { children: string | undefined }) {
  return children === undefined ? null : <p className={css.error} role="alert">{children}</p>
}
/** Inline confirmation of a destructive action: the question beside cancel and confirm. */
export function ConfirmRow({ message, confirmLabel, cancelLabel, disabled, onConfirm, onCancel }: {
  message: string
  confirmLabel: string
  cancelLabel: string
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className={css.confirmRow} role="group" aria-label={message}>
      <span className={css.confirmText}>{message}</span>
      <div className={css.actions}>
        <Button variant="ghost" size="sm" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant="outline" size="sm" className={css.danger} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  )
}
