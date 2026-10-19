/**
 * Whether web_search reaches this plugin, for the settings page. The page reads
 * the shared `web` row the way `ctx.web` selects: its `searchProvider`, else
 * `$DSH_WEB_SEARCH_PROVIDER`, else auto-selection among usable providers. The
 * Host supplies the two facts the browser cannot see: the id this plugin
 * registered (`providerId` is not a settings field) and the environment
 * override. Reads only while the page observes it; later answers win.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ProviderRequest, ProviderView } from '../../remote-contract.ts'

/** The `web` row fields the page reads. */
export interface WebSelection {
  readonly searchProvider?: string
}

/** Where `ctx.web` routes web_search, as far as the page can tell. */
export type SearchRoute =
  /** The `web` row is not served to this client, or the Host has not answered. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'this' }
  /** Nothing pins a provider: the Host auto-selects and fails while several are usable. */
  | { readonly kind: 'auto'; readonly providerId: string }
  /** Another provider serves web_search, so this plugin's settings have no effect. */
  | { readonly kind: 'other'; readonly provider: string; readonly providerId: string }

export interface ProviderReader {
  provider(request: ProviderRequest): Promise<RemoteResult<ProviderView>>
}

export function searchRoute(web: ConfigFormSnapshot<WebSelection>, host: ProviderView | undefined): SearchRoute {
  if (host === undefined || web.status !== 'ready') return { kind: 'unknown' }
  const pinned = web.value?.searchProvider ?? host.envProvider
  if (pinned === null) return { kind: 'auto', providerId: host.providerId }
  return pinned === host.providerId ? { kind: 'this' } : { kind: 'other', provider: pinned, providerId: host.providerId }
}

export class SearchRouteStatus {
  readonly source: ObservableSnapshot<SearchRoute>
  private readonly store = createSnapshotStore<SearchRoute>({ kind: 'unknown' })
  private host: ProviderView | undefined
  private reader: ProviderReader | undefined
  private observers = 0
  private unwatch: (() => void) | undefined
  private epoch = 0

  constructor(private readonly web: ConfigForm<WebSelection>) {
    this.source = {
      getSnapshot: () => this.store.getSnapshot(),
      subscribe: (listener) => {
        const unsubscribe = this.store.subscribe(listener)
        this.observers += 1
        if (this.observers === 1) {
          this.unwatch = web.subscribe(() => { this.publish() })
          this.publish()
          this.refresh()
        }
        return () => {
          this.observers -= 1
          if (this.observers === 0) this.unwatch?.()
          unsubscribe()
        }
      },
    }
  }

  /** Read the Host facts through a mounted Remote until the returned disposer runs. */
  attach(reader: ProviderReader): () => void {
    this.reader = reader
    this.refresh()
    return () => {
      if (this.reader !== reader) return
      this.reader = undefined
      this.host = undefined
      this.epoch += 1
      this.publish()
    }
  }

  /** Ask the Host again when someone is looking. */
  refresh(): void {
    const reader = this.reader
    if (reader === undefined || this.observers === 0) return
    const epoch = ++this.epoch
    void reader.provider({}).then((result) => {
      // A failed read keeps the last answer; without one the page shows no hint.
      if (!result.ok || epoch !== this.epoch) return
      this.host = result.value
      this.publish()
    })
  }

  private publish(): void {
    this.store.set(searchRoute(this.web.getSnapshot(), this.host))
  }
}
