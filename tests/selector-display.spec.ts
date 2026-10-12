import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { V2Config } from '../src/config.ts'
import { SearchConnectionSelector, SearchSelectorControl, selectorDisabled, type SearchConnectionRemote, type SearchConnectionSelectorProps } from '../src/client/SearchConnectionSelector.tsx'
import { SelectionClient } from '../src/client/selection-client.ts'
import { selectionInjection } from '../src/client/bindings.ts'
import { zh, type LocaleKey } from '../src/client/locales.ts'

const renderers: ReactTestRenderer[] = []
beforeEach(() => {
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() })
  vi.unstubAllGlobals()
})
const snapshot = (status: ConfigFormSnapshot<V2Config>['status'], value?: V2Config): ConfigFormSnapshot<V2Config> =>
  ({ status, value, base: {}, user: {}, revision: 1, writable: true, mode: 'host' }) as ConfigFormSnapshot<V2Config>
function fixture(settings?: ConfigFormSnapshot<V2Config>) {
  let state = { selection: { connectionId: 'builtin:exa' as string | null, revision: 1 }, freshness: 'auto' as const, connections: [
    { id: 'builtin:exa', label: 'Exa', kind: 'structured' as const, configured: true },
    { id: 'builtin:tavily', label: 'Tavily', kind: 'structured' as const, configured: true },
  ] }
  const remote = {
    get: vi.fn<SearchConnectionRemote['get']>(async () => ({ ok: true, value: structuredClone(state) })),
    set: vi.fn<SearchConnectionRemote['set']>(async request => {
      state = { ...state, selection: { connectionId: request.connectionId ?? null, revision: state.selection.revision + 1 } }
      return { ok: true, value: structuredClone(state) }
    }),
  }
  const client = new SelectionClient(remote)
  const props = {
    sessionId: 'session-one', ...selectionInjection(client, 'session-one'),
    useProjection: () => undefined, t: (key: LocaleKey) => zh[key] ?? key,
    ...(settings ? { useSettings: (select: (s: ConfigFormSnapshot<V2Config>) => unknown) => select(settings) } : {}),
  } as unknown as SearchConnectionSelectorProps
  return { remote, client, props }
}
async function mount(props: SearchConnectionSelectorProps) {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(SearchConnectionSelector, props)) })
  renderers.push(renderer)
  return renderer
}

describe('composer seat switch (showSelector)', () => {
  it('hides only for an accepted showSelector: false', () => {
    expect(selectorDisabled(snapshot('ready', { version: 2, showSelector: false }))).toBe(true)
    expect(selectorDisabled(snapshot('ready', { version: 2, showSelector: true }))).toBe(false)
    expect(selectorDisabled(snapshot('ready', { version: 2 }))).toBe(false)
    expect(selectorDisabled(snapshot('loading'))).toBe(false)
    expect(selectorDisabled(snapshot('unavailable'))).toBe(false)
  })

  it('renders nothing and reads nothing when switched off', async () => {
    const { props, remote } = fixture(snapshot('ready', { version: 2, showSelector: false }))
    const renderer = await mount(props)
    expect(renderer.toJSON()).toBeNull()
    expect(remote.get).not.toHaveBeenCalled()
  })

  it('keeps the seat without a settings hook or before settings load', async () => {
    for (const settings of [undefined, snapshot('loading')]) {
      const { props } = fixture(settings)
      const renderer = await mount(props)
      expect(renderer.root.findAllByType(SearchSelectorControl)).toHaveLength(1)
    }
  })

  it('rereads after another view of the session announces a write', async () => {
    const { props, client, remote } = fixture(snapshot('ready', { version: 2 }))
    const renderer = await mount(props)
    expect(renderer.root.findByType(SearchSelectorControl).props.value.selection.connectionId).toBe('builtin:exa')
    await act(async () => {
      await client.set('session-one', { connectionId: 'builtin:tavily', expectedRevision: 1 })
      client.announce('session-one')
    })
    expect(renderer.root.findByType(SearchSelectorControl).props.value.selection.connectionId).toBe('builtin:tavily')
    expect(remote.get).toHaveBeenCalledTimes(1) // Served from the cache the write refreshed.
    client.announce('session-two')
    await act(async () => { renderer.unmount() })
    renderers.splice(renderers.indexOf(renderer), 1)
    expect(() => client.announce('session-one')).not.toThrow()
  })
})
