/** Built-in search services: switch, access route, key and request options per service. */
import { useId, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconRightUpOutlineRegular, SegmentedControl, StateDot, Switch, Tag,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ADAPTER_IDS, ADAPTERS, builtinConnectionId, type AdapterId } from '../../catalog.ts'
import type { Access } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import type { CredentialStates } from './credentials.ts'
import { CredentialEditor, type SaveCredential } from './CredentialEditor.tsx'
import { adapterFields, builtinAccess, builtinCredentialRef, builtinOverride } from './model.ts'
import { OptionsForm } from './OptionsEditor.tsx'
import { ErrorText, Section, useWrite, type SettingsDoc, type WriteSettings } from './parts.tsx'
import { sparseSettingOperations } from './sparse.ts'
import css from './Settings.module.css'

interface ServiceProps {
  doc: SettingsDoc
  write: WriteSettings
  credentials: CredentialStates
  saveCredential: SaveCredential
  t: Translate
}

export function ServicesSection(props: ServiceProps) {
  return (
    <Section title={props.t('services.title')}>
      <ul className={css.list}>
        {ADAPTER_IDS.map(adapter => <ServiceRow key={adapter} adapter={adapter} {...props} />)}
      </ul>
    </Section>
  )
}

function ServiceRow({ adapter, doc, write, credentials, saveCredential, t }: ServiceProps & { adapter: AdapterId }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const action = useWrite(t)
  const info = ADAPTERS[adapter]
  const connectionId = builtinConnectionId(adapter)
  const override = builtinOverride(doc.config, adapter)
  const name = override.label ?? info.label
  const access = builtinAccess(adapter, override)
  const credentialRef = builtinCredentialRef(adapter, override)
  const credential = credentials[credentialRef]
  const enabled = override.disabled !== true
  const disabled = !doc.editable || action.busy
  const save = (path: string[], target: unknown, fallback?: unknown) =>
    action.run(() => write(sparseSettingOperations(doc.layers, ['connections', connectionId, ...path], target, fallback)))
  const options = adapterFields(adapter, access)
  const optionsHint = t('options.hint') + (options.restricted ? ' ' + t('options.keylessMore') : '')

  return (
    <li className={css.row}>
      <div className={css.rowLine}>
        <StateDot state={dotState(enabled, access, credential?.configured, info.account)} />
        <div className={css.rowMain}>
          <span className={css.rowTitle}>
            {name}
            {enabled ? null : <Tag tone="neutral">{t('services.off')}</Tag>}
          </span>
          <span className={css.rowMeta}>{accessSummary(adapter, access, credentialRef, credential?.configured, t)}</span>
        </div>
        <Button
          variant="ghost" size="sm" className={css.disclosure} aria-expanded={open} aria-controls={id}
          aria-label={t('services.configureLabel', { name })} onClick={() => { setOpen(!open) }}
        >
          {t('services.configure')}
          <IconChevronDownOutlineRegular className={clsx(css.disclosureIcon, open && css.disclosureOpen)} />
        </Button>
        <Switch
          checked={enabled} label={t('services.enable', { name })} disabled={disabled}
          onChange={next => void save(['disabled'], !next, false)}
        />
      </div>
      <ErrorText>{action.error}</ErrorText>
      {open ? (
        <div className={css.panel} id={id}>
          {info.keyless ? (
            <div className={css.field}>
              <span className={css.fieldLabel}>{t('services.access')}</span>
              <SegmentedControl<Access>
                id={id + '-access'} className={css.segmented} label={t('services.access')} value={access} disabled={disabled}
                options={[{ value: 'keyless', label: t('services.accessKeyless') }, { value: 'api-key', label: t('services.accessPersonal') }]}
                onChange={next => void save(['access'], next, 'keyless')}
              />
              <p className={css.hint}>{t(access === 'keyless' ? 'services.accessHint.keyless' : 'services.accessHint.apiKey')}</p>
            </div>
          ) : null}
          {info.account ? <p className={css.note}>{t('services.accountHint')}</p> : null}
          {access === 'api-key' ? (
            <>
              <CredentialEditor credentialRef={credentialRef} info={credential} save={saveCredential} t={t} />
              <a className={css.link} href={info.homepage} target="_blank" rel="noopener noreferrer">
                {t('services.getKey')}
                <IconRightUpOutlineRegular size={12} />
              </a>
            </>
          ) : null}
          <OptionsForm
            key={access} id={id + '-options'} title={t('options.title')} hint={optionsHint} fields={options.fields}
            stored={override.options ?? {}} disabled={disabled} t={t} onCommit={(name, value) => save(['options', name], value)}
          />
        </div>
      ) : null}
    </li>
  )
}

function dotState(enabled: boolean, access: Access, configured: boolean | undefined, account: boolean): StateDotState {
  if (!enabled) return 'idle'
  if (access === 'keyless' || configured === true) return 'done'
  // An account sign-in may still serve sessions on the DeepSeek account route.
  return account ? 'idle' : 'warning'
}

function accessSummary(adapter: AdapterId, access: Access, ref: string, configured: boolean | undefined, t: Translate): string {
  if (access === 'keyless') return t('services.keyless')
  const route = t(ADAPTERS[adapter].account ? 'services.account' : 'services.personalKey', { ref })
  return configured === undefined ? route : route + ' · ' + t(configured ? 'credential.set' : 'credential.unset')
}