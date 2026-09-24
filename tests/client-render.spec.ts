import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { V2Config } from '../src/config.ts'
import { SearchConnectionSelector, SearchSelectorControl, type SearchConnectionSelectorProps, type SearchSelectionResponse } from '../src/client/SearchConnectionSelector.tsx'
import { V2Settings, type V2SettingsProps } from '../src/client/V2Settings.tsx'
import { zh, type LocaleKey } from '../src/client/locales.ts'

const renderers: ReactTestRenderer[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('window', {
    setInterval, clearInterval, setTimeout, clearTimeout,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })
})
afterEach(async () => {
  await act(async () => { for (const renderer of renderers.splice(0)) renderer.unmount() })
  vi.useRealTimers(); vi.unstubAllGlobals()
})
async function mount(element: ReturnType<typeof createElement>) {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(element) })
  renderers.push(renderer)
  return renderer
}
const response = (id: string, revision = 0): SearchSelectionResponse => ({
  selection: { connectionId: id, revision }, freshness: 'auto',
  connections: [{ id, label: id, kind: 'structured', configured: true }],
})
const ok = (value: SearchSelectionResponse) => ({ ok: true as const, value })
function selectorProps(extra: Partial<SearchConnectionSelectorProps> = {}): SearchConnectionSelectorProps {
  // Only seats this entry consumes are needed; the production renderer supplies the full standard kit.
  return {
    sessionId: 'first', getSelection: vi.fn(async () => ok(response('builtin:exa'))),
    setSelection: vi.fn(async () => ok(response('builtin:exa', 1))),
    useProjection: vi.fn(() => undefined), t: key => zh[key as LocaleKey] ?? key, ...extra,
  } as SearchConnectionSelectorProps
}

describe('framework-bound session projection', () => {
  it('refreshes on typed projection changes and absence, but not unrelated rerenders', async () => {
    let projection: ModelSelectionProjection | undefined
    const useProjection = vi.fn(() => projection)
    const props = selectorProps({ useProjection: useProjection as SearchConnectionSelectorProps['useProjection'] })
    const renderer = await mount(createElement(SearchConnectionSelector, props))
    expect(useProjection).toHaveBeenCalledWith('modelSelection')
    expect(props.getSelection).toHaveBeenCalledTimes(1)
    projection = { lastUsed: null, next: { provider: 'test', model: 'next-model' } }
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, props)) })
    expect(props.getSelection).toHaveBeenCalledTimes(2)
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, props)) })
    expect(props.getSelection).toHaveBeenCalledTimes(2)
    projection = undefined
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, props)) })
    expect(props.getSelection).toHaveBeenCalledTimes(3)
  })

  it('fences a delayed response when the framework switches Session binding', async () => {
    let resolve!: (value: ReturnType<typeof ok>) => void
    const first = selectorProps({ getSelection: vi.fn(() => new Promise<ReturnType<typeof ok>>(r => { resolve = r })) })
    const renderer = await mount(createElement(SearchConnectionSelector, first))
    const second = selectorProps({ sessionId: 'second' as SearchConnectionSelectorProps['sessionId'], getSelection: vi.fn(async () => ok(response('second-choice'))) })
    await act(async () => { renderer.update(createElement(SearchConnectionSelector, second)) })
    await act(async () => { resolve(ok(response('stale-first-choice'))) })
    expect(renderer.root.findByType(SearchSelectorControl).props.value.selection.connectionId).toBe('second-choice')
    await act(async () => { renderer.unmount() })
    expect(window.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a confirmed write when an older polling response arrives later', async () => {
    const props = selectorProps()
    const renderer = await mount(createElement(SearchConnectionSelector, props))
    let resolve!: (value: ReturnType<typeof ok>) => void
    vi.mocked(props.getSelection).mockImplementationOnce(() => new Promise(r => { resolve = r }))
    await act(async () => { renderer.root.findByType(SearchSelectorControl).props.onRefresh() })
    await act(async () => { renderer.root.findByType(SearchSelectorControl).props.onSelect('builtin:exa') })
    expect(props.setSelection).toHaveBeenCalledWith({ connectionId: 'builtin:exa', expectedRevision: 0 })
    await act(async () => { resolve(ok(response('stale-poll'))) })
    const control = renderer.root.findByType(SearchSelectorControl)
    expect(control.props.value.selection.revision).toBe(1)
    expect(control.props.notice).toBe(zh.selectionSaved)
  })
})

function settingsProps(mutateSettings = vi.fn(async () => false)): V2SettingsProps {
  const snapshot: ConfigFormSnapshot<V2Config> = {
    status: 'ready', writable: true, revision: 8, mode: 'host',
    base: {}, user: { version: 2 }, value: { version: 2 },
  }
  return {
    useSettings: selector => selector(snapshot), mutateSettings,
    describeCredentials: vi.fn(async () => ({ ok: true as const, value: {} })),
    setCredential: vi.fn(), t: key => zh[key as LocaleKey] ?? key, defaultOpen: true,
  }
}

describe('ConfigForm writes', () => {
  it('passes the observed revision and never announces success after Host refusal', async () => {
    const props = settingsProps()
    const renderer = await mount(createElement(V2Settings, props))
    const select = renderer.root.findAllByType('select').find(node => String(node.props.id).endsWith('-freshness'))!
    await act(async () => { select.props.onChange({ target: { value: 'realtime' } }) })
    expect(props.mutateSettings).toHaveBeenCalledWith([{ op: 'set', path: ['freshness'], value: 'realtime' }], 8)
    expect(renderer.root.findByProps({ role: 'alert' }).children).toContain(zh.failed)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('已保存新会话默认实时性')
    expect(renderer.root.findAllByProps({ className: 'v2s-badge v2s-badge-notice' })).toHaveLength(0)
  })

  it('retains a custom connection draft after refusal and closes it after acceptance', async () => {
    const mutate = vi.fn(async () => false)
    const renderer = await mount(createElement(V2Settings, settingsProps(mutate)))
    const button = (text: string) => renderer.root.findAllByType('button').find(node => node.children.join('') === text)!
    await act(async () => { button('+ 添加自定义结构化连接').props.onClick() })
    await act(async () => { renderer.root.findAllByType('input').find(node => String(node.props.id).endsWith('-conn-id'))!.props.onChange({ target: { value: 'custom:research' } }) })
    await act(async () => { renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    const draft = renderer.root.findByType('textarea').props.value
    await act(async () => { button('保存连接').props.onClick() })
    expect(renderer.root.findByType('textarea').props.value).toBe(draft)
    expect(renderer.root.findByProps({ role: 'alert' }).children).toContain(zh.failed)
    expect(mutate).toHaveBeenLastCalledWith(expect.any(Array), 8)
    mutate.mockResolvedValue(true)
    await act(async () => { button('保存连接').props.onClick() })
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('连接已保存')
  })
})
