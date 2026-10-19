/** Defaults for new sessions and the composer button switch. */
import { useId } from 'react'
import { SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { FRESHNESS } from '../../catalog.ts'
import { freshnessLabel, freshnessServices, type Translate } from '../connections.ts'
import { connectionChoices } from './model.ts'
import { ErrorText, Section, SelectMenu, SettingRow, useWrite, type SettingsDoc, type WriteSettings } from './parts.tsx'
import { sparseSettingOperations } from './sparse.ts'

export function DefaultsSection({ doc, write, t }: { doc: SettingsDoc; write: WriteSettings; t: Translate }) {
  const id = useId()
  const action = useWrite(t)
  const disabled = !doc.editable || action.busy
  const save = (path: string[], target: unknown, fallback?: unknown) =>
    void action.run(() => write(sparseSettingOperations(doc.layers, path, target, fallback)))
  const { defaultConnection, freshness = 'auto', showSelector = true } = doc.config
  const choices = connectionChoices(doc.config, t)
  const missing = defaultConnection !== undefined && !choices.some(choice => choice.id === defaultConnection)
  const options = [
    { id: '', label: t('defaults.connectionUnset') },
    ...missing ? [{ id: defaultConnection, label: t('defaults.connectionMissing', { id: defaultConnection }) }] : [],
    ...choices,
  ]
  return (
    <Section title={t('defaults.title')}>
      <SettingRow title={t('defaults.connection')} hint={t('defaults.connectionHint')}>
        <SelectMenu
          label={t('defaults.connection')} value={defaultConnection ?? ''} options={options} disabled={disabled}
          onChange={choice => save(['defaultConnection'], choice === '' ? undefined : choice)}
        />
      </SettingRow>
      <SettingRow
        title={t('defaults.freshness')}
        hint={t('defaults.freshnessHint', { services: freshnessServices(t) })}
      >
        <SegmentedControl
          id={id + '-freshness'} label={t('defaults.freshness')} value={freshness} disabled={disabled}
          options={FRESHNESS.map(mode => ({ value: mode, label: freshnessLabel(mode, t) }))}
          onChange={mode => save(['freshness'], mode, 'auto')}
        />
      </SettingRow>
      <SettingRow title={t('defaults.showSelector')} hint={t('defaults.showSelectorHint')}>
        <Switch
          checked={showSelector} label={t('defaults.showSelector')} disabled={disabled}
          onChange={show => save(['showSelector'], show, true)}
        />
      </SettingRow>
      <ErrorText>{action.error}</ErrorText>
    </Section>
  )
}
