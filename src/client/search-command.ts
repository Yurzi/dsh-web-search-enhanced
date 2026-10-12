import type { CommandContribution, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { Freshness } from '../catalog.ts'
import type { LocaleKey } from './locales.ts'
import type { SelectionClient } from './selection-client.ts'
import { discoverableConnections } from './SearchConnectionSelector.tsx'

/**
 * Keyboard and narrow-screen entry for the current session's search settings.
 * It writes through the same session-bound client as the composer selector, so
 * the selector may be hidden (crowded row or `showSelector: false`) without
 * losing access to switching.
 */
export const SEARCH_COMMAND = 'setup-search'
const OFF = 'off'
const CONNECTION = 'connection:'
const FRESHNESS = 'freshness:'
const FRESHNESS_MODES = ['auto', 'fresh', 'realtime'] as const satisfies readonly Freshness[]
const FRESHNESS_LABELS = { auto: 'freshnessAuto', fresh: 'freshnessFresh', realtime: 'freshnessRealtime' } as const satisfies Record<Freshness, LocaleKey>

type Change = { connectionId: string | null } | { freshness: Freshness }
export function parseCommandOption(id: string): Change | undefined {
  if (id === OFF) return { connectionId: null }
  if (id.startsWith(CONNECTION) && id.length > CONNECTION.length) return { connectionId: id.slice(CONNECTION.length) }
  const mode = id.startsWith(FRESHNESS) ? id.slice(FRESHNESS.length) : undefined
  return FRESHNESS_MODES.find(value => value === mode) === undefined ? undefined : { freshness: mode as Freshness }
}

export function searchCommand(client: SelectionClient, t: (key: LocaleKey) => string): CommandContribution {
  const read = async (sessionId: string) => {
    const result = await client.get(sessionId)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  return {
    name: SEARCH_COMMAND,
    label: () => t('commandLabel'),
    description: () => t('commandDescription'),
    available: session => typeof session.sessionId === 'string' && session.sessionId.length > 0,
    ui: {
      kind: 'popupSelect',
      searchLabels: () => ({ placeholder: t('commandPlaceholder'), empty: t('commandEmpty'), noResults: t('commandNoResults') }),
      async options(session) {
        const value = await read(session.sessionId)
        const selected = value.selection.connectionId
        const current = t('commandCurrent')
        const mark = (active: boolean) => active ? { detail: current } : {}
        const options: SelectOption[] = [{ id: OFF, label: t('searchOff'), active: selected === null, ...mark(selected === null) }]
        const configured = discoverableConnections(value.connections).filter(c => c.configured)
        for (const kind of ['model', 'structured'] as const) {
          const group = { name: kind, label: t(kind === 'model' ? 'modelSearch' : 'searchServices') }
          for (const c of configured.filter(c => c.kind === kind)) options.push({ id: CONNECTION + c.id, label: c.label, group, active: c.id === selected, ...mark(c.id === selected) })
        }
        // Freshness has no effect while search is off, matching the selector panel.
        if (selected !== null) {
          const group = { name: 'freshness', label: t('freshness') }
          for (const mode of FRESHNESS_MODES) options.push({ id: FRESHNESS + mode, label: t(FRESHNESS_LABELS[mode]), group, ...mark(value.freshness === mode) })
        }
        return options
      },
      async onSelect(option, session) {
        const change = parseCommandOption(option.id)
        if (!change) return
        const { selection, freshness } = await read(session.sessionId)
        if ('connectionId' in change ? change.connectionId === selection.connectionId : change.freshness === freshness) return
        const result = await client.set(session.sessionId, { ...change, expectedRevision: selection.revision })
        // The popup shell shows a thrown message and stays open for a retry.
        if (!result.ok) throw new Error(result.error.message)
        client.announce(session.sessionId)
      },
    },
  }
}
