/** Whether web_search reaches this plugin, judged the way ctx.web selects a provider. */
import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ProviderView } from '../src/remote-contract.ts'
import { SearchRouteStatus, type WebSelection } from '../src/client/settings/route.ts'

function fixture(web: Partial<ConfigFormSnapshot<WebSelection>>, host: ProviderView = { providerId: 'deepseek-official', envProvider: null }) {
  let snapshot = { status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true, ...web } as ConfigFormSnapshot<WebSelection>
  const listeners = new Set<() => void>()
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  } as unknown as ConfigForm<WebSelection>
  const answer = { current: host }
  const reader = { provider: vi.fn(async () => ({ ok: true as const, value: answer.current })) }
  const status = new SearchRouteStatus(form)
  const detach = status.attach(reader)
  const editWeb = (value: WebSelection) => { snapshot = { ...snapshot, value }; for (const listener of [...listeners]) listener() }
  const observe = () => status.source.subscribe(() => {})
  const route = () => status.source.getSnapshot()
  return { status, reader, answer, detach, editWeb, observe, route, listeners }
}

describe('search route on the settings page', () => {
  it('asks the Host only while the page observes it and follows web row edits', async () => {
    const h = fixture({ value: { searchProvider: 'deepseek-official' } })
    expect(h.reader.provider).not.toHaveBeenCalled()
    const stop = h.observe()
    await vi.waitFor(() => expect(h.route()).toEqual({ kind: 'this' }))
    h.editWeb({ searchProvider: 'deepseek-search-api' })
    expect(h.route()).toEqual({ kind: 'other', provider: 'deepseek-search-api', providerId: 'deepseek-official' })
    h.editWeb({})
    expect(h.route()).toEqual({ kind: 'auto', providerId: 'deepseek-official' })
    stop()
    expect(h.listeners.size).toBe(0)
    h.status.refresh()
    expect(h.reader.provider).toHaveBeenCalledTimes(1)
  })

  it('lets the environment pick the provider only while the web row names none', async () => {
    const h = fixture({ value: {} }, { providerId: 'enhanced-search', envProvider: 'enhanced-search' })
    h.observe()
    await vi.waitFor(() => expect(h.route()).toEqual({ kind: 'this' }))
    h.editWeb({ searchProvider: 'deepseek-official' })
    expect(h.route()).toEqual({ kind: 'other', provider: 'deepseek-official', providerId: 'enhanced-search' })
  })

  it('rereads the Host after a refresh and says nothing it cannot judge', async () => {
    const h = fixture({ value: { searchProvider: 'enhanced-search' } })
    h.observe()
    await vi.waitFor(() => expect(h.route()).toMatchObject({ kind: 'other' }))
    h.answer.current = { providerId: 'enhanced-search', envProvider: null }
    h.status.refresh()
    await vi.waitFor(() => expect(h.route()).toEqual({ kind: 'this' }))
    h.detach()
    expect(h.route()).toEqual({ kind: 'unknown' })
    const unserved = fixture({ status: 'unavailable', value: undefined })
    unserved.observe()
    await vi.waitFor(() => expect(unserved.reader.provider).toHaveBeenCalled())
    expect(unserved.route()).toEqual({ kind: 'unknown' })
  })
})
