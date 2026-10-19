// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionView, SelectionView } from '../src/remote-contract.ts'
import type { V2Config } from '../src/settings/types.ts'
import type { SelectionState, WriteResult } from '../src/client/selection.ts'
import { SearchSelector, type Navigation, type SearchSelectorProps } from '../src/client/selector/SearchSelector.tsx'
import { bindHook, byText, click, flush, observable, render, tZh } from './client-harness.tsx'

const exa: ConnectionView = { id: 'builtin:exa', label: 'Exa', kind: 'structured', access: 'keyless', status: 'ready', freshness: false }
const scholar: ConnectionView = { id: 'builtin:semanticscholar', label: 'Semantic Scholar', kind: 'structured', access: 'api-key', status: 'needs-credential', freshness: false, credentialRef: 'SEMANTIC_SCHOLAR_API_KEY' }
const follow: ConnectionView = { id: 'builtin:session-model', label: 'Session model', kind: 'model', access: 'api-key', status: 'ready', freshness: false, credentialRef: 'OPENAI_API_KEY' }

const viewOf = (connectionId: string | null, connections = [exa, scholar, follow], freshness: 'auto' | 'fresh' | 'realtime' = 'auto'): SelectionView =>
  ({ selection: { connectionId, freshness, revision: 3 }, connections })

function mount(options: { state?: Partial<SelectionState>; writable?: boolean; settings?: V2Config; select?: () => Promise<WriteResult> } = {}) {
  const selection = observable<SelectionState>({ view: viewOf('builtin:exa'), saving: false, readFailed: false, ...options.state })
  const settings = observable({ status: 'ready', value: options.settings ?? {}, base: {}, user: {}, revision: 1, writable: true } as ConfigFormSnapshot<V2Config>)
  const openSettings = vi.fn()
  const navigation = observable<Navigation>({ openSettings })
  const props = {
    useSelection: bindHook(selection),
    useSettings: bindHook(settings),
    useNavigation: bindHook(navigation),
    useProjection: (_key: string, select: (value: undefined) => unknown) => select(undefined),
    useAccess: () => options.writable ?? true,
    load: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    select: vi.fn(options.select ?? (async () => ({ ok: true }) as const)),
    t: tZh,
  } as unknown as SearchSelectorProps
  const { container } = render(<SearchSelector {...props} />)
  const trigger = () => container.querySelector('button[aria-haspopup="menu"]')
  const open = () => { click(trigger()) }
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
  return { props, selection, settings, openSettings, container, trigger, open, rows }
}

describe('composer search selector', () => {
  it('shows the selected connection and loads for the session model', () => {
    const { trigger, props } = mount()
    expect(trigger()?.textContent).toContain('Exa')
    expect(trigger()?.getAttribute('aria-label')).toBe(tZh('selector.aria', { name: 'Exa' }))
    expect(props.load).toHaveBeenCalledWith('')
  })

  it('shows a non-default freshness beside the connection', () => {
    expect(mount({ state: { view: viewOf('builtin:exa', undefined, 'realtime') } }).trigger()?.textContent).toBe('Exa' + tZh('freshness.short.realtime'))
  })

  it('shows search off without a freshness value', () => {
    expect(mount({ state: { view: viewOf(null, undefined, 'realtime') } }).trigger()?.textContent).toBe(tZh('connection.off'))
  })

  it('lists Off and enabled connections by group with access hints, refreshing on open', () => {
    const { open, rows, props } = mount()
    open()
    expect(props.refresh).toHaveBeenCalledOnce()
    expect(rows().map(row => row.textContent)).toEqual([
      tZh('selector.offRow'),
      'Exa' + tZh('access.keyless'),
      'Semantic Scholar' + tZh('status.short.needsCredential'),
      tZh('connection.followModel'),
    ])
    expect(rows()[1]?.getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('[role="separator"]')).not.toBeNull()
    expect(document.body.textContent).toContain(tZh('selector.services'))
    expect(document.body.textContent).toContain(tZh('selector.models'))
  })

  it('writes a choice, then closes and returns focus to the trigger', async () => {
    const { open, rows, props, trigger } = mount()
    open()
    click(rows()[3])
    await flush()
    expect(props.select).toHaveBeenCalledWith({ connectionId: 'builtin:session-model' })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('announces a conflict without closing the menu', async () => {
    const { open, rows } = mount({ select: async () => ({ ok: false, error: new RemoteError('searchConnections/conflict', 'stale', {}) }) })
    open()
    click(rows()[0])
    await flush()
    expect(document.body.textContent).toContain(tZh('write.conflict'))
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('turns a row that needs setup into a way to the settings', () => {
    const { open, rows, openSettings, props } = mount()
    open()
    const scholar = rows()[2]!
    expect(scholar.disabled).toBe(false)
    expect(scholar.getAttribute('aria-label')).toBe(tZh('selector.rowToSettings', { name: 'Semantic Scholar', reason: tZh('status.short.needsCredential') }))
    click(scholar)
    expect(openSettings).toHaveBeenCalledOnce()
    expect(props.select).not.toHaveBeenCalled()
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('explains why the selected connection cannot search and links to the settings', () => {
    const { trigger, open, openSettings } = mount({ state: { view: viewOf('builtin:semanticscholar') } })
    const reason = tZh('status.needsCredential', { name: 'Semantic Scholar' })
    expect(trigger()?.getAttribute('title')).toBe(reason)
    open()
    const strip = document.querySelector('[role="status"]')!
    expect(strip.textContent).toContain(reason)
    click(byText(strip, 'button', tZh('selector.openSettings')))
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('locks freshness and says why when the connection ignores it', () => {
    mount().open()
    expect(document.body.textContent).toContain(tZh('selector.freshnessIgnored', { name: 'Exa' }))
    expect([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].every(tab => tab.disabled)).toBe(true)
  })

  it('writes freshness for a connection that honors it', async () => {
    const personal = { ...exa, access: 'api-key' as const, credentialRef: 'EXA_API_KEY', freshness: true }
    const { open, props } = mount({ state: { view: viewOf('builtin:exa', [personal]) } })
    open()
    expect(document.body.textContent).toContain(tZh('selector.freshnessHint.auto'))
    click(byText(document.body, '[role="tab"]', tZh('freshness.short.fresh')))
    await flush()
    expect(props.select).toHaveBeenCalledWith({ freshness: 'fresh' })
  })

  it('disables freshness while search is off', () => {
    mount({ state: { view: viewOf(null) } }).open()
    expect([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].every(tab => tab.disabled)).toBe(true)
  })

  it('offers a localized retry when the read failed', () => {
    const { open, props, trigger } = mount({ state: { view: undefined, readFailed: true } })
    expect(trigger()?.getAttribute('title')).toBe(tZh('selector.readFailed'))
    open()
    click(byText(document.body, 'button', tZh('selector.readFailed')))
    expect(props.refresh).toHaveBeenCalledTimes(2)
  })

  it('is read-only without access to searchConnections/set', () => {
    const { open, rows } = mount({ writable: false })
    open()
    expect(rows().filter(row => !row.hasAttribute('aria-label')).every(row => row.disabled)).toBe(true)
    expect(document.body.textContent).toContain(tZh('selector.readOnly'))
  })

  it('opens the plugin settings from the menu footer', () => {
    const { open, openSettings } = mount()
    open()
    click(byText(document.body, '[role="menuitem"]', tZh('selector.manage')))
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('renders nothing once settings hide the composer button', () => {
    const { container } = mount({ settings: { showSelector: false } })
    expect(container.innerHTML).toBe('')
  })
})