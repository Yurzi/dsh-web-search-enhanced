import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type TestRendererOptions } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SearchConnectionSelector, SearchSelectorControl, type SearchConnectionRemote, type SearchConnectionSelectorProps, type SearchSelectionResponse, type SearchSelectorControlProps } from '../src/client/SearchConnectionSelector.tsx'
import { SelectionClient } from '../src/client/selection-client.ts'
import { selectionInjection } from '../src/client/bindings.ts'
import { zh, type LocaleKey } from '../src/client/locales.ts'

type Result = Awaited<ReturnType<SearchConnectionRemote['get']>>
const TTL = 30_000
const renderers: ReactTestRenderer[] = []
const clients: SelectionClient[] = []
const response = (id: string, revision = 0): SearchSelectionResponse => ({
  selection: { connectionId: id, revision }, freshness: 'auto',
  connections: [{ id, label: id, kind: 'structured', configured: true }],
})
const ok = (id: string, revision = 0): Result => ({ ok: true, value: response(id, revision) })
const model = (name = 'one'): ModelSelectionProjection => ({ lastUsed: null, next: { provider: 'test', model: name, reasoningEffort: 'high' } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function eventTarget() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)!.add(listener)
    }),
    removeEventListener: vi.fn((name: string, listener: () => void) => { listeners.get(name)?.delete(listener) }),
    emit(name: string) { for (const listener of [...(listeners.get(name) ?? [])]) listener() },
    count(name: string) { return listeners.get(name)?.size ?? 0 },
  }
}
let windowEvents: ReturnType<typeof eventTarget>
let documentEvents: ReturnType<typeof eventTarget> & { visibilityState: string }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  windowEvents = eventTarget()
  documentEvents = { ...eventTarget(), visibilityState: 'visible' }
  vi.stubGlobal('window', { ...windowEvents, setTimeout, clearTimeout, setInterval, clearInterval, innerWidth: 1000, innerHeight: 800 })
  vi.stubGlobal('document', documentEvents)
})
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() })
  for (const client of clients.splice(0)) client.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function mount(props: SearchConnectionSelectorProps, options?: TestRendererOptions) {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(createElement(SearchConnectionSelector, props), options) })
  renderers.push(renderer)
  return renderer
}
function fixture() {
  const remote = {
    get: vi.fn<SearchConnectionRemote['get']>(async () => ok('initial')),
    set: vi.fn<SearchConnectionRemote['set']>(async () => ok('saved', 1)),
  }
  const client = new SelectionClient(remote, TTL)
  clients.push(client)
  const reads = vi.spyOn(client, 'get')
  let projection: ModelSelectionProjection | undefined = model()
  const props = (): SearchConnectionSelectorProps => ({
    sessionId: 'session-one', ...selectionInjection(client, 'session-one'),
    useProjection: (() => projection) as SearchConnectionSelectorProps['useProjection'],
    t: (key: LocaleKey) => zh[key] ?? key,
  }) as SearchConnectionSelectorProps
  return { remote, client, reads, props, projection(value: ModelSelectionProjection | undefined) { projection = value } }
}
const control = (renderer: ReactTestRenderer) => renderer.root.findByType(SearchSelectorControl).props as SearchSelectorControlProps
async function expire() { await act(async () => { await vi.advanceTimersByTimeAsync(TTL + 1) }) }

describe('mounted selector demand-driven refresh', () => {
  it('does not poll even after multiple idle TTLs expire', async () => {
    const f = fixture()
    await mount(f.props())
    await act(async () => { await vi.advanceTimersByTimeAsync(TTL * 10) })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    expect(f.reads).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not reload for equal recreated projections, injected callbacks, or locale functions', async () => {
    const f = fixture()
    const renderer = await mount(f.props())
    await expire()
    f.projection(model())
    const props = f.props()
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, { ...props, t: key => 'translated:' + key })) })
    expect(f.reads).toHaveBeenCalledTimes(1)
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    expect(control(renderer).value?.selection.connectionId).toBe('initial')
    expect(windowEvents.addEventListener).toHaveBeenCalledTimes(1)
    expect(documentEvents.addEventListener).toHaveBeenCalledTimes(1)
  })

  it('shares TTL and in-flight reads across opening, focus, and visible transitions; ignores hidden events', async () => {
    const f = fixture()
    const renderer = await mount(f.props())
    await act(async () => {
      control(renderer).onOpen!()
      windowEvents.emit('focus')
      documentEvents.emit('visibilitychange')
    })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    await expire()
    documentEvents.visibilityState = 'hidden'
    const readsBeforeHidden = f.reads.mock.calls.length
    await act(async () => { windowEvents.emit('focus'); documentEvents.emit('visibilitychange') })
    expect(f.reads).toHaveBeenCalledTimes(readsBeforeHidden)
    const next = deferred<Result>()
    f.remote.get.mockReturnValueOnce(next.promise)
    documentEvents.visibilityState = 'visible'
    await act(async () => {
      documentEvents.emit('visibilitychange')
      control(renderer).onOpen!()
      windowEvents.emit('focus')
    })
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    await act(async () => { next.resolve(ok('refreshed')) })
    expect(control(renderer).value?.selection.connectionId).toBe('refreshed')
    await act(async () => { control(renderer).onOpen!(); windowEvents.emit('focus'); documentEvents.emit('visibilitychange') })
    expect(f.remote.get).toHaveBeenCalledTimes(2)
  })

  it('reuses the same-session cache across unmount and remount within TTL', async () => {
    const f = fixture()
    const first = await mount(f.props())
    await act(async () => { first.unmount() })
    const second = await mount(f.props())
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    expect(control(second).value?.selection.connectionId).toBe('initial')
  })

  it('runs a trailing GET when the model changes during the initial load', async () => {
    const f = fixture()
    const initial = deferred<Result>(), trailing = deferred<Result>()
    f.remote.get.mockReturnValueOnce(initial.promise).mockReturnValueOnce(trailing.promise)
    const renderer = await mount(f.props())
    f.projection(model('two'))
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, f.props())) })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    await act(async () => { initial.resolve(ok('obsolete')) })
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    expect(control(renderer).value).toBeUndefined()
    await act(async () => { trailing.resolve(ok('latest')) })
    expect(control(renderer).value?.selection.connectionId).toBe('latest')
  })

  it('coalesces repeated model changes during a model-triggered read into a latest trailing GET', async () => {
    const f = fixture()
    const renderer = await mount(f.props())
    const changed = deferred<Result>(), trailing = deferred<Result>()
    f.remote.get.mockReturnValueOnce(changed.promise).mockReturnValueOnce(trailing.promise)
    f.projection(model('two'))
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, f.props())) })
    f.projection(model('three'))
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, f.props())) })
    f.projection(model('four'))
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, f.props())) })
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    await act(async () => { changed.resolve(ok('obsolete')) })
    expect(f.remote.get).toHaveBeenCalledTimes(3)
    expect(control(renderer).value?.selection.connectionId).toBe('initial')
    await act(async () => { trailing.resolve(ok('model-four')) })
    expect(control(renderer).value?.selection.connectionId).toBe('model-four')
  })

  it('uses a successful set result directly without a follow-up GET', async () => {
    const f = fixture()
    const renderer = await mount(f.props())
    await act(async () => { control(renderer).onSelect('saved') })
    expect(f.remote.set).toHaveBeenCalledWith({ sessionId: 'session-one', connectionId: 'saved', expectedRevision: 0 })
    expect(control(renderer).value?.selection).toEqual({ connectionId: 'saved', revision: 1 })
    expect(control(renderer).pending).toBe(false)
    expect(control(renderer).notice).toBe(zh.selectionSaved)
    await act(async () => { control(renderer).onOpen!(); windowEvents.emit('focus') })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
  })

  it('forces a fresh GET after a conflict and keeps its error visible', async () => {
    const f = fixture()
    const renderer = await mount(f.props())
    // The bridge maps revision conflicts to this public Remote failure code.
    f.remote.set.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/bad-request', 'Revision conflict', {}) })
    f.remote.get.mockResolvedValueOnce(ok('other-writer', 2))
    await act(async () => { control(renderer).onSelect('saved') })
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    expect(f.reads.mock.lastCall?.[1]?.force).toBe(true)
    expect(control(renderer).value?.selection).toEqual({ connectionId: 'other-writer', revision: 2 })
    expect(control(renderer).error).toContain('Revision conflict')
    expect(control(renderer).pending).toBe(false)
  })

  it('does not lose a model change during set and clears pending before the trailing read settles', async () => {
    const f = fixture()
    const renderer = await mount(f.props())
    const write = deferred<Result>(), trailing = deferred<Result>()
    f.remote.set.mockReturnValueOnce(write.promise)
    f.remote.get.mockReturnValueOnce(trailing.promise)
    await act(async () => { control(renderer).onSelect('saved') })
    expect(control(renderer).pending).toBe(true)
    f.projection(model('two'))
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, f.props())) })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    await act(async () => { write.resolve(ok('saved', 1)) })
    expect(control(renderer).pending).toBe(false)
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    // The successful write belongs to the old model; only the trailing read may
    // replace the displayed snapshot after the model changes.
    expect(control(renderer).value).toEqual(response('initial'))
    expect(control(renderer).notice).toBe(zh.selectionSaved)
    await act(async () => { trailing.resolve(ok('new-model', 1)) })
    expect(control(renderer).value?.selection.connectionId).toBe('new-model')
    expect(control(renderer).pending).toBe(false)
  })

  it('retains the pre-write snapshot when a model change invalidates set and the trailing GET fails', async () => {
    const f = fixture()
    const renderer = await mount(f.props())
    const write = deferred<Result>(), trailing = deferred<Result>()
    f.remote.set.mockReturnValueOnce(write.promise)
    f.remote.get.mockReturnValueOnce(trailing.promise)
    await act(async () => { control(renderer).onSelect('outdated-write') })
    f.projection(model('two'))
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, f.props())) })
    expect(control(renderer).pending).toBe(true)
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    await act(async () => { write.resolve(ok('outdated-write', 1)) })
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    expect(control(renderer).value).toEqual(response('initial'))
    expect(control(renderer).pending).toBe(false)
    expect(control(renderer).notice).toBe(zh.selectionSaved)
    await act(async () => {
      trailing.resolve({ ok: false, error: new RemoteError('gateway/internal', 'Model refresh failed', {}) })
    })
    expect(control(renderer).value).toEqual(response('initial'))
    expect(control(renderer).error).toBe('Model refresh failed')
    expect(control(renderer).pending).toBe(false)
    expect(f.remote.get).toHaveBeenCalledTimes(2)
  })

  it('opens natively without forcing retry, closes without any refresh, and removes all listeners', async () => {
    const f = fixture()
    let open = false
    const panelEvents = eventTarget()
    const panel = {
      ...panelEvents, style: {}, matches: () => open,
      showPopover: vi.fn(() => { open = true; panelEvents.emit('toggle') }),
      hidePopover: vi.fn(() => { open = false; panelEvents.emit('toggle') }),
      querySelector: () => null,
    }
    const button = { getBoundingClientRect: () => ({ right: 600, top: 600, bottom: 640 }), focus: vi.fn() }
    const renderer = await mount(f.props(), { createNodeMock: element => element.props.className === 'v2s-selector-panel' ? panel : element.props.className === 'v2s-search-trigger' ? button : null })
    const trigger = () => renderer.root.findByProps({ className: 'v2s-search-trigger' })
    await act(async () => { trigger().props.onClick() })
    expect(panel.showPopover).toHaveBeenCalledTimes(1)
    expect(trigger().props['aria-expanded']).toBe(true)
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    expect(f.reads.mock.lastCall?.[1]?.force).toBe(false)
    await expire()
    const beforeClose = f.reads.mock.calls.length
    await act(async () => { trigger().props.onClick() })
    expect(panel.hidePopover).toHaveBeenCalledTimes(1)
    expect(trigger().props['aria-expanded']).toBe(false)
    expect(f.reads).toHaveBeenCalledTimes(beforeClose)
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    await act(async () => { renderer.unmount() })
    expect(windowEvents.count('focus')).toBe(0)
    expect(windowEvents.count('resize')).toBe(0)
    expect(documentEvents.count('visibilitychange')).toBe(0)
    expect(panelEvents.count('toggle')).toBe(0)
    expect(windowEvents.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(documentEvents.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    await act(async () => { windowEvents.emit('focus'); documentEvents.emit('visibilitychange') })
    expect(f.reads).toHaveBeenCalledTimes(beforeClose)
    expect(vi.getTimerCount()).toBe(0)
  })
})
