import { describe, expect, it, vi } from 'vitest'
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import { SEARCH_COMMAND, parseCommandOption, searchCommand } from '../src/client/search-command.ts'
import { SelectionClient } from '../src/client/selection-client.ts'
import { selectionInjection } from '../src/client/bindings.ts'
import type { SearchConnectionRemote, SearchSelectionResponse } from '../src/client/SearchConnectionSelector.tsx'
import { zh, type LocaleKey } from '../src/client/locales.ts'

const connections: SearchSelectionResponse['connections'] = [
  { id: 'builtin:session-model', label: '跟随会话模型', kind: 'model', configured: true },
  { id: 'builtin:exa', label: 'Exa', kind: 'structured', configured: true },
  { id: 'builtin:tavily', label: 'Tavily', kind: 'structured', configured: false },
]
function fixture(connectionId: string | null = 'builtin:exa', revision = 3) {
  let state: SearchSelectionResponse = { selection: { connectionId, revision }, freshness: 'realtime', connections }
  const remote = {
    get: vi.fn<SearchConnectionRemote['get']>(async () => ({ ok: true, value: structuredClone(state) })),
    set: vi.fn<SearchConnectionRemote['set']>(async request => {
      state = { ...state, selection: { connectionId: request.connectionId === undefined ? state.selection.connectionId : request.connectionId, revision: state.selection.revision + 1 }, freshness: request.freshness ?? state.freshness }
      return { ok: true, value: structuredClone(state) }
    }),
  }
  const client = new SelectionClient(remote)
  const announced = vi.fn()
  client.subscribe(announced)
  const command = searchCommand(client, key => zh[key as LocaleKey])
  if (command.ui.kind !== 'popupSelect') throw new Error('expected popupSelect')
  return { remote, client, announced, command, ui: command.ui, session: { sessionId: 'session-one' } as never }
}
const pick = (options: readonly SelectOption[], id: string) => options.find(option => option.id === id)!

describe('/setup-search command', () => {
  it('parses only known option identities', () => {
    expect(parseCommandOption('off')).toEqual({ connectionId: null })
    expect(parseCommandOption('connection:builtin:exa')).toEqual({ connectionId: 'builtin:exa' })
    expect(parseCommandOption('freshness:fresh')).toEqual({ freshness: 'fresh' })
    for (const id of ['connection:', 'freshness:weekly', 'other']) expect(parseCommandOption(id)).toBeUndefined()
  })

  it('registers a localized popup for any session', () => {
    const { command, ui } = fixture()
    expect(command.name).toBe(SEARCH_COMMAND)
    expect(SEARCH_COMMAND).toBe('setup-search')
    expect(command.label?.()).toBe(zh.commandLabel)
    expect(command.description?.()).toBe(zh.commandDescription)
    expect(command.available({ sessionId: 'session-one' } as never)).toBe(true)
    expect(ui.searchLabels?.()).toEqual({ placeholder: zh.commandPlaceholder, empty: zh.commandEmpty, noResults: zh.commandNoResults })
  })

  it('mirrors the selector panel: off, configured groups and freshness, marking the current values', async () => {
    const { ui, session } = fixture()
    const options = await ui.options(session, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['off', 'connection:builtin:session-model', 'connection:builtin:exa', 'freshness:auto', 'freshness:fresh', 'freshness:realtime'])
    expect(pick(options, 'off')).toEqual({ id: 'off', label: zh.searchOff, active: false })
    expect(pick(options, 'connection:builtin:exa')).toMatchObject({ label: 'Exa', active: true, detail: zh.commandCurrent, group: { name: 'structured', label: zh.searchServices } })
    expect(pick(options, 'connection:builtin:session-model').group).toEqual({ name: 'model', label: zh.modelSearch })
    expect(pick(options, 'freshness:realtime')).toMatchObject({ label: zh.freshnessRealtime, detail: zh.commandCurrent, group: { name: 'freshness', label: zh.freshness } })
    expect(pick(options, 'freshness:auto').detail).toBeUndefined()
    expect(options.filter(option => option.active)).toHaveLength(1)
  })

  it('omits freshness while search is off', async () => {
    const { ui, session } = fixture(null)
    const options = await ui.options(session, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['off', 'connection:builtin:session-model', 'connection:builtin:exa'])
    expect(pick(options, 'off')).toMatchObject({ active: true, detail: zh.commandCurrent })
  })

  it('writes with the observed revision and announces to other views of the session', async () => {
    const { ui, session, remote, announced, client } = fixture()
    const watcher = vi.fn()
    const unwatch = selectionInjection(client, 'session-one').watchSelection(watcher)
    const other = vi.fn()
    selectionInjection(client, 'session-two').watchSelection(other)
    await ui.onSelect({ id: 'connection:builtin:session-model', label: '' }, session)
    expect(remote.set).toHaveBeenLastCalledWith({ sessionId: 'session-one', connectionId: 'builtin:session-model', expectedRevision: 3 })
    expect(announced).toHaveBeenCalledWith('session-one')
    expect(watcher).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    await ui.onSelect({ id: 'freshness:fresh', label: '' }, session)
    expect(remote.set).toHaveBeenLastCalledWith({ sessionId: 'session-one', freshness: 'fresh', expectedRevision: 4 })
    unwatch()
    await ui.onSelect({ id: 'off', label: '' }, session)
    expect(watcher).toHaveBeenCalledTimes(2)
    expect(remote.get).toHaveBeenCalledTimes(1) // Writes refresh the shared cache.
  })

  it('skips writes for the current value and unknown options', async () => {
    const { ui, session, remote, announced } = fixture()
    await ui.onSelect({ id: 'connection:builtin:exa', label: '' }, session)
    await ui.onSelect({ id: 'freshness:realtime', label: '' }, session)
    await ui.onSelect({ id: 'unknown', label: '' }, session)
    expect(remote.set).not.toHaveBeenCalled()
    expect(announced).not.toHaveBeenCalled()
  })

  it('surfaces refusals to the popup shell without announcing', async () => {
    const { ui, session, remote, announced } = fixture()
    remote.set.mockResolvedValueOnce({ ok: false, error: { message: 'Search selection changed in another window; refresh and retry' } } as never)
    await expect(ui.onSelect({ id: 'off', label: '' }, session)).rejects.toThrow('changed in another window')
    expect(announced).not.toHaveBeenCalled()
    // The refused write expired the cache, so reopening reads again and reports its refusal too.
    remote.get.mockResolvedValueOnce({ ok: false, error: { message: 'read refused' } } as never)
    await expect(ui.options(session, new AbortController().signal)).rejects.toThrow('read refused')
  })

  it('stops announcing after the client is disposed', () => {
    const { client, announced } = fixture()
    client.dispose()
    client.announce('session-one')
    expect(announced).not.toHaveBeenCalled()
  })
})
