/**
 * The plugin's page on the Plugins page (`plugins.bundle.config`). Every
 * control writes immediately as a sparse operation against the revision the
 * page shows; keys go to DSH Credentials only.
 */
import { useId, useState } from 'react'
import clsx from 'clsx'
import { Button, IconChevronDownOutlineRegular, SegmentedControl, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { MODEL_PROTOCOLS, SESSION_MODEL_ID, type ModelProtocol } from '../../catalog.ts'
import type { V2Config } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import type { NS } from '../locales.ts'
import type { CredentialStates } from './credentials.ts'
import type { SearchRoute } from './route.ts'
import type { SaveCredential } from './CredentialEditor.tsx'
import { CustomConnectionsSection } from './CustomConnections.tsx'
import { DefaultsSection } from './DefaultsSection.tsx'
import { modelFields, PROTOCOL_LABELS, sessionModelOverride } from './model.ts'
import { OptionsForm } from './OptionsEditor.tsx'
import { ConfirmRow, ErrorText, Section, useWrite, type SettingsDoc, type WriteSettings } from './parts.tsx'
import { ServicesSection } from './ServicesSection.tsx'
import { documentVersion, resetSettingsOperations, sparseSettingOperations } from './sparse.ts'
import css from './Settings.module.css'

/** Business face of the settings page registration. */
export interface SettingsPageInjected {
  hooks: {
    /** The plugin's settings namespace. */
    settings: ConfigForm<V2Config>
    /** Whether each referenced credential is configured. */
    credentials: ObservableSnapshot<CredentialStates>
    /** Whether web_search reaches this plugin. */
    route: ObservableSnapshot<SearchRoute>
  }
  mutate: (ops: readonly SettingsPathOpView[], expectedRevision: number) => Promise<boolean>
  saveCredential: SaveCredential
}

export type SettingsPageProps =
  PropsRuntime<'plugins.bundle.config'> & InjectFace<SettingsPageInjected> & PropsLocale<typeof NS>

export function SettingsPage({ useSettings, useCredentials, useRoute, mutate, saveCredential, t }: SettingsPageProps) {
  const snapshot = useSettings(value => value)
  const credentials = useCredentials(value => value)
  const route = useRoute(value => value)
  if (snapshot.status === 'unavailable') return null
  if (snapshot.value === undefined || snapshot.revision === undefined) {
    return <p className={css.status} role="status"><StateDot state="ongoing" />{t('settings.loading')}</p>
  }
  const layers = { base: snapshot.base, user: snapshot.user }
  const version = documentVersion(layers)
  const doc: SettingsDoc = { config: snapshot.value, layers, revision: snapshot.revision, editable: snapshot.writable && version === 'current' }
  const write: WriteSettings = (ops, revision = doc.revision) => ops.length === 0 ? Promise.resolve(true) : mutate(ops, revision)
  const notice = version === 'legacy' ? t('settings.migration')
    : version === 'unsupported' ? t('settings.unsupported')
      : snapshot.writable ? undefined : t('settings.readOnly')
  const sections = { doc, write, t }
  return (
    <div className={css.page}>
      <p className={css.intro}>{t('settings.intro')}</p>
      {notice === undefined ? null : <p className={css.warning} role="status">{notice}</p>}
      <RouteNotice route={route} t={t} />
      <DefaultsSection {...sections} />
      <ServicesSection {...sections} credentials={credentials} saveCredential={saveCredential} />
      <ModelSection {...sections} />
      <CustomConnectionsSection {...sections} credentials={credentials} saveCredential={saveCredential} />
      <ResetSection {...sections} />
    </div>
  )
}

/** Provider id of the DeepSeek Search API, which the switch on DSH's own Web search page selects. */
const DEEPSEEK_SEARCH_API = 'deepseek-search-api'

/** Says so when web_search does not reach this plugin, so nothing on this page takes effect. */
function RouteNotice({ route, t }: { route: SearchRoute; t: Translate }) {
  const text = routeNotice(route, t)
  return text === undefined ? null : <p className={css.warning} role="status">{text}</p>
}

function routeNotice(route: SearchRoute, t: Translate): string | undefined {
  switch (route.kind) {
    case 'unknown':
    case 'this':
      return undefined
    case 'auto':
      return t('route.auto', { id: route.providerId })
    case 'other':
      if (route.provider === DEEPSEEK_SEARCH_API) return t('route.deepseekApi', { id: route.providerId })
      return t('route.other', { provider: route.provider, id: route.providerId })
  }
}

function ModelSection({ doc, write, t }: { doc: SettingsDoc; write: WriteSettings; t: Translate }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [protocol, setProtocol] = useState<ModelProtocol>('anthropic-messages')
  const action = useWrite(t)
  const override = sessionModelOverride(doc.config)
  const enabled = override.disabled !== true
  const disabled = !doc.editable || action.busy
  const name = t('connection.followModel')
  const save = (path: string[], target: unknown, fallback?: unknown) =>
    action.run(() => write(sparseSettingOperations(doc.layers, ['connections', SESSION_MODEL_ID, ...path], target, fallback)))
  return (
    <Section title={t('models.title')}>
      <ul className={css.list}>
        <li className={css.row}>
          <div className={css.rowLine}>
            <StateDot state={enabled ? 'done' : 'idle'} />
            <div className={css.rowMain}>
              <span className={css.rowTitle}>{name}</span>
              <span className={css.rowMeta}>{t('models.followHint')}</span>
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
              <p className={css.note}>{t('models.limits')}</p>
              <div className={css.field}>
                <span className={css.fieldLabel}>{t('models.options')}</span>
                <SegmentedControl<ModelProtocol>
                  id={id + '-protocol'} className={css.segmented} label={t('models.protocol')} value={protocol}
                  options={MODEL_PROTOCOLS.map(value => ({ value, label: PROTOCOL_LABELS[value] }))} onChange={setProtocol}
                />
              </div>
              <OptionsForm
                key={protocol} id={id + '-' + protocol} title={t('editor.searchOptions')} hint={t('models.optionsHint')}
                fields={modelFields(protocol)} stored={{ ...override.optionsByProtocol?.[protocol] }} disabled={disabled} t={t}
                onCommit={(option, value) => save(['optionsByProtocol', protocol, option], value)}
              />
            </div>
          ) : null}
        </li>
      </ul>
    </Section>
  )
}

function ResetSection({ doc, write, t }: { doc: SettingsDoc; write: WriteSettings; t: Translate }) {
  const [confirming, setConfirming] = useState(false)
  const action = useWrite(t)
  const disabled = !doc.editable || action.busy
  const reset = async () => {
    if (await action.run(() => write(resetSettingsOperations(doc.layers)))) setConfirming(false)
  }
  return (
    <div className={css.reset}>
      {confirming ? (
        <ConfirmRow
          message={t('reset.confirm')} confirmLabel={t('reset.confirmButton')} cancelLabel={t('confirm.cancel')}
          disabled={disabled} onConfirm={() => { void reset() }} onCancel={() => { setConfirming(false) }}
        />
      ) : (
        <div className={css.confirmRow}>
          <span className={css.confirmText}>{t('reset.hint')}</span>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => { setConfirming(true) }}>{t('reset.button')}</Button>
        </div>
      )}
      <ErrorText>{action.error}</ErrorText>
    </div>
  )
}
