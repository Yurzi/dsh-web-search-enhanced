import { describe, expect, it, vi } from 'vitest'
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SelectionView } from '../src/remote-contract.ts'
import { parseCommandOption, searchCommand, SEARCH_COMMAND } from '../src/client/command.ts'
import { SearchSelections, type SearchConnectionsRemote } from '../src/client/selection.ts'
import { tZh } from './client-t.ts'

const connections: SelectionView['connections'] = [
  { id: 'builtin:exa', label: 'Exa', kind: 'structured', access: 'keyless', status: 'ready', freshness: false },
  { id: 'builtin:tavily', label: 'Tavily', kind: 'structured', access: 'keyless', status: 'disabled', freshness: false },
  { id: 'builtin:semanticscholar', label: 'Semantic Scholar', kind: 'structured', access: 'api-key', status: 'needs-credential', credentialRef: 'S2', freshness: false },
  { id: 'builtin:session-model', label: 'Session model', kind: 'model', access: 'api-key', status: 'ready', freshness: false },
]

function fixture(connectionId: string | null = 'builtin:exa') {
  let current: SelectionView = { selection: { connectionId, freshness: 'realtime', revision: 3 }, connections }
  const remote = {
    get: vi.fn(async () => ({ ok: true as const, value: current })),
    set: vi.fn(async (request: { connectionId?: string | null; freshness?: 'auto' | 'fresh' | 'realtime' }) => {
      current = { ...current, selection: { ...current.selection, ...request, revision: current.selection.revision + 1 } as SelectionView['selection'] }
      return { ok: true as const, value: current }
    }),
  }
  const selections = new SearchSelections(remote as unknown as SearchConnectionsRemote)
  const command = searchCommand(selections, tZh)
  if (command.ui.kind !== 'popupSelect') throw new Error('expected a popup command')
  return { remote, selections, command, ui: command.ui, session: { sessionId: 'session-1' } as never }
}

const ids = (options: readonly SelectOption[]) => options.map(option => option.id)
const signal = new AbortController().signal

describe('/setup-search', () => {
  it('is a localized popup command', () => {
    const { command, ui } = fixture()
    expect(command.name).toBe(SEARCH_COMMAND)
    expect(command.label?.()).toBe(tZh('command.label'))
    expect(ui.searchLabels?.()).toEqual({ placeholder: tZh('command.placeholder'), empty: tZh('command.empty'), noResults: tZh('command.noResults') })
  })

  it('mirrors the composer menu: off, ready connections by group, then freshness', async () => {
    const { ui, session } = fixture()
    const options = await ui.options(session, signal)
    expect(ids(options)).toEqual([
      'off', 'connection:builtin:exa', 'connection:builtin:session-model', 'freshness:auto', 'freshness:fresh', 'freshness:realtime',
    ])
    expect(options[1]).toMatchObject({ label: 'Exa', active: true, detail: tZh('access.keyless') + ' · ' + tZh('command.current'), group: { name: 'services' } })
    expect(options[2]).toMatchObject({ label: tZh('connection.followModel'), group: { name: 'models', label: tZh('selector.models') } })
    expect(options.at(-1)).toMatchObject({ label: tZh('freshness.realtime'), detail: tZh('command.current') })
    expect(options.filter(option => option.active)).toHaveLength(1)
  })

  it('omits freshness while search is off', async () => {
    const { ui, session } = fixture(null)
    expect(ids(await ui.options(session, signal))).toEqual(['off', 'connection:builtin:exa', 'connection:builtin:session-model'])
  })

  it('writes the picked change with the observed revision and skips the current value', async () => {
    const { ui, session, remote } = fixture()
    await ui.onSelect({ id: 'connection:builtin:exa', label: 'Exa' }, session)
    await ui.onSelect({ id: 'freshness:realtime', label: '' }, session)
    expect(remote.set).not.toHaveBeenCalled()
    await ui.onSelect({ id: 'freshness:fresh', label: '' }, session)
    expect(remote.set).toHaveBeenLastCalledWith({ sessionId: 'session-1', freshness: 'fresh', expectedRevision: 3 })
    await ui.onSelect({ id: 'off', label: '' }, session)
    expect(remote.set).toHaveBeenLastCalledWith({ sessionId: 'session-1', connectionId: null, expectedRevision: 4 })
  })

  it('reports a refused write in the popup with localized text', async () => {
    const { ui, session, remote } = fixture()
    remote.set.mockResolvedValueOnce({ ok: false, error: new RemoteError('searchConnections/unavailable', 'gone', { connectionId: 'builtin:exa' }) } as never)
    await expect(ui.onSelect({ id: 'off', label: '' }, session)).rejects.toThrow(tZh('write.unavailable'))
  })

  it('parses only the option ids it issues', () => {
    expect(parseCommandOption('off')).toEqual({ connectionId: null })
    expect(parseCommandOption('connection:custom:a')).toEqual({ connectionId: 'custom:a' })
    expect(parseCommandOption('freshness:fresh')).toEqual({ freshness: 'fresh' })
    for (const id of ['connection:', 'freshness:weekly', 'other']) expect(parseCommandOption(id)).toBeUndefined()
  })
})