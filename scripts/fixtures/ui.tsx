/**
 * Browser fixture for scripts/check-ui.mjs: the composer search seat inside a
 * replica of the DSH composer row, and the settings page inside a Plugins page
 * detail frame, both over in-page fakes of the Host. Never talks to a DSH.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionView, SelectionView } from '../../src/remote-contract.ts'
import type { V2Config } from '../../src/settings/types.ts'
import { zh, en, type LocaleKey } from '../../src/client/locales.ts'
import { SearchSelections, type SearchConnectionsRemote } from '../../src/client/selection.ts'
import { SearchSelector, type Navigation, type SearchSelectorProps } from '../../src/client/selector/SearchSelector.tsx'
import { SettingsPage, type SettingsPageProps } from '../../src/client/settings/SettingsPage.tsx'
import type { CredentialStates } from '../../src/client/settings/credentials.ts'
import type { SearchRoute } from '../../src/client/settings/route.ts'

const params = new URLSearchParams(location.search)
const dictionary: Record<string, string> = params.get('lang') === 'en' ? en : zh
const t = (key: LocaleKey, values?: Record<string, unknown>) =>
  (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] === undefined ? match : String(values[name]))

const bind = <T,>(source: ObservableSnapshot<T>) => <S,>(select: (value: T) => S): S =>
  select(useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot()))

/** Settings document with Host-like sparse path writes and revision fencing. */
function createSettings(user: Record<string, unknown>) {
  const store = createSnapshotStore<ConfigFormSnapshot<V2Config>>({ status: 'ready', value: structuredClone(user) as V2Config, base: {}, user, revision: 1, writable: true })
  const writes: { ops: readonly SettingsPathOpView[]; revision: number }[] = []
  return {
    store, writes,
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener: () => void) => store.subscribe(listener),
    async mutate(ops: readonly SettingsPathOpView[], revision: number): Promise<boolean> {
      writes.push({ ops, revision })
      const current = store.getSnapshot()
      if (revision !== current.revision) return false
      const next = structuredClone(current.user) as Record<string, any>
      for (const op of ops) {
        const parents = op.path.slice(0, -1)
        let node = next
        for (const key of parents) node = node[key] ??= {}
        if (op.op === 'set') node[op.path.at(-1)!] = op.value
        else delete node[op.path.at(-1)!]
      }
      store.set({ ...current, user: next, value: structuredClone(next) as V2Config, revision: revision + 1 })
      return true
    },
  }
}

const connections: ConnectionView[] = [
  { id: 'builtin:exa', label: 'Exa', kind: 'structured', access: 'keyless', status: 'ready', freshness: false },
  { id: 'builtin:firecrawl', label: 'Firecrawl', kind: 'structured', access: 'api-key', status: 'ready', freshness: true, credentialRef: 'FIRECRAWL_API_KEY' },
  { id: 'builtin:tavily', label: 'Tavily', kind: 'structured', access: 'keyless', status: 'ready', freshness: false },
  { id: 'builtin:deepseek', label: 'DeepSeek', kind: 'structured', access: 'account', status: 'ready', freshness: false },
  { id: 'builtin:openalex', label: 'OpenAlex', kind: 'structured', access: 'keyless', status: 'ready', freshness: false },
  { id: 'builtin:semanticscholar', label: 'Semantic Scholar', kind: 'structured', access: 'api-key', status: 'needs-credential', freshness: false, credentialRef: 'SEMANTIC_SCHOLAR_API_KEY' },
  { id: 'builtin:session-model', label: 'Session model', kind: 'model', access: 'api-key', status: 'ready', freshness: false, credentialRef: 'ANTHROPIC_API_KEY' },
]

function selectorFixture(root: HTMLElement) {
  let view: SelectionView = { selection: { connectionId: 'builtin:exa', freshness: 'auto', revision: 0 }, connections }
  const writes: Record<string, unknown>[] = []
  let refuseNext = false
  const remote = {
    get: async () => ({ ok: true as const, value: view }),
    set: async (request: { connectionId?: string | null; freshness?: 'auto' | 'fresh' | 'realtime'; expectedRevision: number }) => {
      writes.push(request)
      if (refuseNext || request.expectedRevision !== view.selection.revision) {
        refuseNext = false
        return { ok: false as const, error: new RemoteError('searchConnections/conflict', 'stale', {}) }
      }
      const { connectionId = view.selection.connectionId, freshness = view.selection.freshness } = request
      view = { ...view, selection: { connectionId, freshness, revision: view.selection.revision + 1 } }
      return { ok: true as const, value: view }
    },
  }
  const selections = new SearchSelections(remote as unknown as SearchConnectionsRemote)
  const settings = createSettings({ version: 2 })
  const navigation = createSnapshotStore<Navigation>({ openSettings: () => { (window as any).openedSettings = true } })
  const props = {
    useSelection: bind(selections.source('fixture')),
    useSettings: bind(settings),
    useNavigation: bind(navigation),
    useProjection: (_key: string, select: (value: undefined) => unknown) => select(undefined),
    useAccess: () => true,
    load: (modelKey: string) => selections.load('fixture', modelKey),
    refresh: () => selections.refresh('fixture'),
    select: (update: Parameters<SearchSelections['set']>[1]) => selections.set('fixture', update),
    t,
  } as unknown as SearchSelectorProps
  const svg = (d: string, size = 16) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="' + d + '"/></svg>'
  root.innerHTML = '<div class="frame" id="frame"><div class="card" data-composer-card>'
    + '<div class="input">' + (dictionary === zh ? '描述你想要构建的内容，/ 调用指令，@ 文件或对话' : 'Describe what to build, / for commands, @ for files') + '</div>'
    + '<div class="row" id="row"><div class="tools">'
    + '<button class="add" aria-label="add">' + svg('M8 3v10M3 8h10', 14) + '</button>'
    + '<div class="modes"><button class="mode" aria-label="mode">' + svg('M8 2 3 4v4c0 3 2 5 5 6 3-1 5-3 5-6V4z') + svg('m4 6 4 4 4-4', 12) + '</button></div></div>'
    + '<div class="trailing"><div class="standardControls"><div data-slot="conversation.input.right" style="display:contents" id="right"></div>'
    + '<div class="modelRoot"><button class="modelTrigger" aria-label="model">' + svg('M3 4h10v8H3zM3 8h10').replace('<svg', '<svg class="modelIcon"') + '<span class="modelLabel">DeepSeek-V4-Pro</span><span class="modelEffort">' + (dictionary === zh ? '高' : 'High') + '</span>' + svg('m4 6 4 4 4-4', 12) + '</button></div></div>'
    + '<button class="primary" aria-label="send">' + svg('M8 13V3M4 7l4-4 4 4') + '</button></div></div></div></div>'
  const right = document.getElementById('right')!
  flushSync(() => createRoot(right).render(<SearchSelector {...props} />))
  const row = document.getElementById('row')!
  // The DSH composer collapses model text when its controls overflow the row.
  const measure = () => {
    row.removeAttribute('data-model-compact')
    const style = getComputedStyle(row)
    const available = row.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const widths = Array.from(row.children, child => child.getBoundingClientRect().width)
    row.toggleAttribute('data-model-compact', widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * parseFloat(style.columnGap) > available)
  }
  new ResizeObserver(measure).observe(row)
  measure()
  return {
    writes,
    refuseNext: () => { refuseNext = true },
    setView: (next: Partial<SelectionView['selection']>) => { view = { ...view, selection: { ...view.selection, ...next, revision: view.selection.revision + 1 } }; return selections.refresh('fixture') },
  }
}

function settingsFixture(root: HTMLElement) {
  const settings = createSettings({ version: 2, defaultConnection: 'builtin:exa', connections: {
    'builtin:firecrawl': { access: 'api-key', options: { country: 'us' } },
    'builtin:tinyfish': { disabled: true },
    'custom:work-search': { kind: 'model', label: dictionary === zh ? '团队搜索模型' : 'Team search model', binding: { mode: 'fixed', protocol: 'openai-responses', model: 'search-1', baseURL: 'https://gateway.example/v1', credentialRef: 'TEAM_SEARCH_KEY' }, trustedEndpoint: true },
  } })
  const credentialStore = createSnapshotStore<CredentialStates>({
    FIRECRAWL_API_KEY: { configured: true, writable: true },
    SEMANTIC_SCHOLAR_API_KEY: { configured: false, writable: true },
    DEEPSEEK_API_KEY: { configured: false, writable: false },
    TEAM_SEARCH_KEY: { configured: true, writable: true },
  })
  const route = createSnapshotStore<SearchRoute>({ kind: 'this' })
  const keys: string[] = []
  const props = {
    view: 'page',
    useSettings: bind(settings),
    useCredentials: bind(credentialStore),
    useRoute: bind(route),
    mutate: settings.mutate,
    saveCredential: async (ref: string) => {
      keys.push(ref)
      credentialStore.set({ ...credentialStore.getSnapshot(), [ref]: { configured: true, writable: true } })
      return { ok: true as const, value: undefined }
    },
    t,
  } as unknown as SettingsPageProps
  const title = dictionary === zh ? '增强网页搜索' : 'Web Search Enhanced'
  const description = dictionary === zh ? '为每个会话选择网页搜索方式。' : 'Choose how each session searches the web.'
  flushSync(() => createRoot(root).render(<DetailFrame title={title} description={description}><SettingsPage {...props} /></DetailFrame>))
  return { writes: settings.writes, keys, settings: () => settings.getSnapshot(), setRoute: (next: SearchRoute) => { route.set(next) } }
}

function DetailFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="page">
      <div className="detail">
        <h3 className="detailTitle">{title}</h3>
        <p className="detailName"><code>dsh-web-search-enhanced</code></p>
        <p className="detailDesc">{description}</p>
        <div className="detailSections"><section className="detailSection" data-plugin-config>{children}</section></div>
      </div>
    </main>
  )
}

const root = document.getElementById('app')!
;(window as any).fixture = params.get('view') === 'settings' ? settingsFixture(root) : selectorFixture(root)
document.getElementById('result')!.textContent = 'ready'