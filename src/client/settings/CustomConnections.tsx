/** User-defined connections: list, enable switch, key, edit and removal. */
import { useState, type ReactNode } from 'react'
import { Button, IconPlusOutlineRegular, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CustomConnection } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import { ConnectionEditor, type EditorTarget } from './ConnectionEditor.tsx'
import type { CredentialStates } from './credentials.ts'
import { CredentialEditor, type SaveCredential } from './CredentialEditor.tsx'
import { connectionChoices, customConnections, customCredentialRef } from './model.ts'
import { ConfirmRow, ErrorText, Section, useWrite, type SettingsDoc, type WriteSettings } from './parts.tsx'
import { sparseSettingOperations } from './sparse.ts'
import css from './Settings.module.css'

interface CustomProps {
  doc: SettingsDoc
  write: WriteSettings
  credentials: CredentialStates
  saveCredential: SaveCredential
  t: Translate
}

export function CustomConnectionsSection({ doc, write, credentials, saveCredential, t }: CustomProps) {
  const [editor, setEditor] = useState<EditorTarget | undefined>(undefined)
  // A problem the closed editor leaves behind, such as a key that did not save.
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const connections = customConnections(doc.config)
  const taken = connectionChoices(doc.config, t).map(choice => choice.id)
  const open = (target: EditorTarget | undefined) => {
    setNotice(undefined)
    setEditor(target)
  }
  const editorFor = (target: EditorTarget) => (
    <ConnectionEditor
      key={target.kind === 'edit' ? target.id : 'new'} target={target} doc={doc} write={write} saveCredential={saveCredential}
      taken={taken} t={t} onClose={(problem) => { setEditor(undefined); setNotice(problem) }}
    />
  )
  return (
    <Section
      title={t('custom.title')}
      actions={(
        <div className={css.sectionActions}>
          <Button variant="ghost" size="sm" icon={<IconPlusOutlineRegular size={14} />} disabled={!doc.editable}
            onClick={() => { open({ kind: 'new', type: 'structured' }) }}>{t('custom.addStructured')}</Button>
          <Button variant="ghost" size="sm" icon={<IconPlusOutlineRegular size={14} />} disabled={!doc.editable}
            onClick={() => { open({ kind: 'new', type: 'model' }) }}>{t('custom.addModel')}</Button>
        </div>
      )}
    >
      <ErrorText>{notice}</ErrorText>
      {editor?.kind === 'new' ? editorFor(editor) : null}
      {connections.length === 0 ? <p className={css.empty}>{t('custom.empty')}</p> : (
        <ul className={css.list}>
          {connections.map(([id, connection]) => (
            <CustomRow
              key={id} id={id} connection={connection} doc={doc} write={write} credentials={credentials}
              saveCredential={saveCredential} t={t} editing={editor?.kind === 'edit' && editor.id === id}
              onEdit={() => { open(editor?.kind === 'edit' && editor.id === id ? undefined : { kind: 'edit', id }) }}
              editor={editor?.kind === 'edit' && editor.id === id ? editorFor(editor) : null}
            />
          ))}
        </ul>
      )}
    </Section>
  )
}

function CustomRow({ id, connection, doc, write, credentials, saveCredential, editing, onEdit, editor, t }: CustomProps & {
  id: string
  connection: CustomConnection
  editing: boolean
  onEdit: () => void
  editor: ReactNode
}) {
  const [keyOpen, setKeyOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const action = useWrite(t)
  const credentialRef = customCredentialRef(connection)
  const credential = credentials[credentialRef]
  const enabled = connection.disabled !== true
  const disabled = !doc.editable || action.busy
  // A connection inherited from the composition layer cannot be removed here.
  const removable = Object.hasOwn((doc.layers.user as { connections?: object } | undefined)?.connections ?? {}, id)
  const save = (path: string[], target: unknown, fallback?: unknown) =>
    action.run(() => write(sparseSettingOperations(doc.layers, ['connections', id, ...path], target, fallback)))
  return (
    <li className={css.row}>
      <div className={css.rowLine}>
        <StateDot state={!enabled ? 'idle' : credential?.configured === true ? 'done' : 'warning'} />
        <div className={css.rowMain}>
          <span className={css.rowTitle}>
            {connection.label}
            <Tag tone="neutral">{t(connection.kind === 'model' ? 'custom.kindModel' : 'custom.kindStructured')}</Tag>
          </span>
          <span className={css.rowMeta}>
            <code>{id}</code>
            {' · '}
            <code>{credentialRef}</code>
            {credential === undefined ? null : ' ' + t(credential.configured ? 'credential.set' : 'credential.unset')}
          </span>
        </div>
        <div className={css.rowActions}>
          <Button variant="ghost" size="sm" aria-expanded={keyOpen} onClick={() => { setKeyOpen(!keyOpen) }}>{t('credential.manage')}</Button>
          <Button variant="ghost" size="sm" aria-expanded={editing} disabled={!doc.editable} onClick={onEdit}>{t('custom.edit')}</Button>
          {removable ? (
            <Button variant="ghost" size="sm" className={css.danger} disabled={disabled} aria-expanded={confirming} onClick={() => { setConfirming(true) }}>
              {t('custom.remove')}
            </Button>
          ) : null}
        </div>
        <Switch
          checked={enabled} label={t('services.enable', { name: connection.label })} disabled={disabled}
          onChange={next => void save(['disabled'], !next, false)}
        />
      </div>
      {confirming ? (
        <ConfirmRow
          message={t('custom.removeConfirm', { name: connection.label })} confirmLabel={t('custom.remove')}
          cancelLabel={t('confirm.cancel')} disabled={disabled}
          onConfirm={() => { void save([], undefined) }} onCancel={() => { setConfirming(false) }}
        />
      ) : null}
      <ErrorText>{action.error}</ErrorText>
      {keyOpen ? (
        <div className={css.panel}>
          <CredentialEditor credentialRef={credentialRef} info={credential} save={saveCredential} t={t} />
        </div>
      ) : null}
      {editor}
    </li>
  )
}