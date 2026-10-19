/**
 * `/setup-search`: the keyboard entry to the current session's search
 * selection. It mirrors the composer menu and writes through the same
 * per-session state, so it keeps working while the composer button is hidden.
 */
import type { CommandContribution, SelectOption, SelectOptionGroup } from '@deepseek-ai/dsh-client-ui-commands/client'
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { FRESHNESS, type Freshness } from '../catalog.ts'
import type { ConnectionView } from '../remote-contract.ts'
import { connectionLabel, freshnessLabel, pickerGroups, rowCaption, writeFailureText, type Translate } from './connections.ts'
import type { SearchSelections, SelectionUpdate } from './selection.ts'

export const SEARCH_COMMAND = 'setup-search'

const OFF = 'off'
const CONNECTION = 'connection:'
const FRESHNESS_PREFIX = 'freshness:'

/** The selection change an option stands for; undefined for ids this command never issues. */
export function parseCommandOption(id: string): SelectionUpdate | undefined {
  if (id === OFF) return { connectionId: null }
  if (id.startsWith(CONNECTION) && id.length > CONNECTION.length) return { connectionId: id.slice(CONNECTION.length) }
  const freshness = FRESHNESS.find(mode => id === FRESHNESS_PREFIX + mode)
  return freshness === undefined ? undefined : { freshness }
}

export function searchCommand(selections: SearchSelections, t: Translate): CommandContribution {
  const read = async (sessionId: string) => {
    const { view } = await selections.current(sessionId)
    if (view === undefined) throw new Error(t('command.readFailed'))
    return view
  }
  return {
    name: SEARCH_COMMAND,
    label: () => t('command.label'),
    description: () => t('command.description'),
    icon: IconGlobeOutlineRegular,
    available: () => true,
    ui: {
      kind: 'popupSelect',
      searchLabels: () => ({ placeholder: t('command.placeholder'), empty: t('command.empty'), noResults: t('command.noResults') }),
      async options(session) {
        const view = await read(session.sessionId)
        const { connectionId, freshness } = view.selection
        const detail = (hint: string | undefined, current: boolean) => {
          const text = [hint, current ? t('command.current') : undefined].filter(part => part !== undefined).join(' · ')
          return text === '' ? {} : { detail: text }
        }
        const connectionOption = (group: SelectOptionGroup, connection: ConnectionView): SelectOption => ({
          id: CONNECTION + connection.id,
          label: connectionLabel(connection, t),
          group,
          ...detail(rowCaption(connection, t), connection.id === connectionId),
          ...(connection.id === connectionId ? { active: true } : {}),
        })
        const { services, models } = pickerGroups(view)
        const ready = (connection: ConnectionView) => connection.status === 'ready'
        const servicesGroup = { name: 'services', label: t('selector.services') }
        const modelsGroup = { name: 'models', label: t('selector.models') }
        const options: SelectOption[] = [
          { id: OFF, label: t('selector.offRow'), ...detail(undefined, connectionId === null), ...(connectionId === null ? { active: true } : {}) },
          ...services.filter(ready).map(connection => connectionOption(servicesGroup, connection)),
          ...models.filter(ready).map(connection => connectionOption(modelsGroup, connection)),
        ]
        // Freshness has no effect while search is off, matching the composer menu.
        if (connectionId !== null) {
          const group = { name: 'freshness', label: t('selector.freshness') }
          for (const mode of FRESHNESS) {
            options.push({ id: FRESHNESS_PREFIX + mode, label: freshnessLabel(mode, t), group, ...detail(undefined, mode === freshness) })
          }
        }
        return options
      },
      async onSelect(option, session) {
        const update = parseCommandOption(option.id)
        if (update === undefined) return
        const { selection } = await read(session.sessionId)
        if (isCurrent(update, selection)) return
        const result = await selections.set(session.sessionId, update)
        // The popup shell shows a thrown message and stays open for another try.
        if (!result.ok) throw new Error(writeFailureText(result.error, t))
      },
    },
  }
}

function isCurrent(update: SelectionUpdate, selection: { connectionId: string | null; freshness: Freshness }): boolean {
  return update.connectionId !== undefined ? update.connectionId === selection.connectionId : update.freshness === selection.freshness
}