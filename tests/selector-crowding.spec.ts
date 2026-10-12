import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchSelectorControl, type SearchSelectionResponse, type SearchSelectorControlProps } from '../src/client/SearchConnectionSelector.tsx'
import { zh, type LocaleKey } from '../src/client/locales.ts'

const crowded = vi.hoisted(() => ({
  handles: [] as { node: unknown; pinned: () => boolean; refresh: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
}))
vi.mock('../src/client/crowded-row.ts', () => ({
  observeCrowdedRow: (node: unknown, options: { pinned(): boolean }) => {
    const handle = { node, pinned: options.pinned, refresh: vi.fn(), dispose: vi.fn() }
    crowded.handles.push(handle)
    return handle
  },
}))

const connections = [
  { id: 'builtin:exa', label: 'Exa', kind: 'structured' as const, configured: true },
  { id: 'builtin:tavily', label: 'Tavily', kind: 'structured' as const, configured: false },
]
const response = (connectionId: string | null): SearchSelectionResponse => ({ selection: { connectionId, revision: 1 }, freshness: 'auto', connections })
const props = (extra: Partial<SearchSelectorControlProps> = {}): SearchSelectorControlProps => ({
  t: key => zh[key as LocaleKey] ?? key, value: response('builtin:exa'), connections,
  pending: false, error: '', notice: '', onSelect: vi.fn(), onFreshness: vi.fn(), onRefresh: vi.fn(), ...extra,
})
const root = { selectorRoot: true }
let renderer: ReactTestRenderer | undefined
async function mount(extra?: Partial<SearchSelectorControlProps>) {
  await act(async () => {
    renderer = create(createElement(SearchSelectorControl, props(extra)), {
      createNodeMock: element => (element.props as { className?: string }).className === 'v2s-selector' ? root : null,
    })
  })
  return crowded.handles.at(-1)!
}
async function update(extra: Partial<SearchSelectorControlProps>) {
  await act(async () => { renderer!.update(createElement(SearchSelectorControl, props(extra))) })
}
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  crowded.handles.length = 0
})

describe('selector crowded-row pinning', () => {
  it('observes the selector root and may collapse in healthy states, including off', async () => {
    const handle = await mount()
    expect(handle.node).toBe(root)
    expect(handle.pinned()).toBe(false)
    await update({ value: response(null) })
    expect(handle.pinned()).toBe(false)
    await update({ value: undefined })
    expect(handle.pinned()).toBe(false)
  })

  it('pins errors, saving and unusable connections, refreshing on each change', async () => {
    const handle = await mount()
    const refreshes = handle.refresh.mock.calls.length
    await update({ error: '保存失败' })
    expect(handle.pinned()).toBe(true)
    expect(handle.refresh.mock.calls.length).toBe(refreshes + 1)
    await update({ error: '' })
    expect(handle.pinned()).toBe(false)
    expect(handle.refresh.mock.calls.length).toBe(refreshes + 2)
    await update({ pending: true })
    expect(handle.pinned()).toBe(true)
    await update({ value: response('builtin:tavily') })
    expect(handle.pinned()).toBe(true)
    await update({ value: response('builtin:removed') })
    expect(handle.pinned()).toBe(true)
  })

  it('disposes the observer on unmount', async () => {
    const handle = await mount()
    await act(async () => { renderer!.unmount() })
    renderer = undefined
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })
})
