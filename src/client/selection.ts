/**
 * Per-session search selection shared by every view of one mounted
 * `searchConnections` Remote: the composer selector and /setup-search read the
 * same observable snapshot, so a write from either surface reaches both.
 */
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import type { SelectionChange, SelectionView } from '../remote-contract.ts'

export type SearchConnectionsRemote = TypertRemoteNamespace<'searchConnections'>

/** What a view of one session renders. */
export interface SelectionState {
  /** Latest Host view; undefined until the first read succeeds. */
  readonly view: SelectionView | undefined
  /** Whether a write is crossing the wire. */
  readonly saving: boolean
  /** Whether the last read failed; cleared by the next successful read or write. */
  readonly readFailed: boolean
}

/** One change to a session's selection; the observed revision is supplied by {@link SearchSelections.set}. */
export type SelectionUpdate = Omit<SelectionChange, 'sessionId' | 'expectedRevision'>

export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly error: RemoteFailure }

interface Entry {
  readonly sessionId: string
  readonly store: SnapshotStore<SelectionState>
  readonly source: ObservableSnapshot<SelectionState>
  observers: number
  /** Whether the stored view may be outdated. */
  stale: boolean
  /** Session model the view was read for. */
  modelKey: string | undefined
  /** Bumped by every event that outdates an in-flight read. */
  epoch: number
  reading: Promise<void> | undefined
}

const INITIAL: SelectionState = { view: undefined, saving: false, readFailed: false }

export class SearchSelections {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly remote: SearchConnectionsRemote) {}

  /** Stable observable of one session; the renderer caches its hook binding per source. */
  source(sessionId: string): ObservableSnapshot<SelectionState> {
    return this.entry(sessionId).source
  }

  /**
   * Make sure the session's view is current, reading only when it is missing,
   * outdated, or was read for another session model.
   */
  load(sessionId: string, modelKey?: string): Promise<void> {
    const entry = this.entry(sessionId)
    if (modelKey !== undefined && modelKey !== entry.modelKey) {
      entry.modelKey = modelKey
      this.outdate(entry)
    }
    return entry.stale ? this.read(entry) : entry.reading ?? Promise.resolve()
  }

  /** Read the session again, joining a read already in flight. */
  refresh(sessionId: string): Promise<void> {
    return this.read(this.entry(sessionId))
  }

  /** The latest view of a session after making sure it is current. */
  async current(sessionId: string): Promise<SelectionState> {
    await this.refresh(sessionId)
    return this.entry(sessionId).store.getSnapshot()
  }

  /**
   * Write a change against the revision the views show. The confirmed view
   * replaces the stored one; a refused write rereads so every view shows what
   * the Host holds now.
   */
  async set(sessionId: string, update: SelectionUpdate): Promise<WriteResult> {
    const entry = this.entry(sessionId)
    const { view } = entry.store.getSnapshot()
    if (view === undefined) throw new Error('search selection has not been read yet')
    this.outdate(entry)
    this.publish(entry, { saving: true })
    const result = await this.remote.set({ sessionId, ...update, expectedRevision: view.selection.revision })
    // A read that started while this write was in flight may predate it.
    this.outdate(entry)
    if (result.ok) {
      entry.stale = false
      this.publish(entry, { view: result.value, saving: false, readFailed: false })
      return { ok: true }
    }
    this.publish(entry, { saving: false })
    void this.read(entry)
    return result
  }

  /**
   * Settings, credentials, or the Host connection changed: observed sessions
   * read again, the others read on their next load.
   */
  invalidate(): void {
    for (const entry of this.entries.values()) {
      this.outdate(entry)
      if (entry.observers > 0) void this.read(entry)
    }
  }

  private entry(sessionId: string): Entry {
    const existing = this.entries.get(sessionId)
    if (existing !== undefined) return existing
    const store = createSnapshotStore(INITIAL)
    const entry: Entry = {
      sessionId, store, observers: 0, stale: true, modelKey: undefined, epoch: 0, reading: undefined,
      source: {
        getSnapshot: () => store.getSnapshot(),
        subscribe: (listener) => {
          entry.observers += 1
          const unsubscribe = store.subscribe(listener)
          return () => {
            entry.observers -= 1
            unsubscribe()
          }
        },
      },
    }
    this.entries.set(sessionId, entry)
    return entry
  }

  private outdate(entry: Entry): void {
    entry.stale = true
    entry.epoch += 1
  }

  private read(entry: Entry): Promise<void> {
    entry.reading ??= this.fetch(entry).finally(() => { entry.reading = undefined })
    return entry.reading
  }

  /** Read until a result arrives that nothing outdated while it was in flight. */
  private async fetch(entry: Entry): Promise<void> {
    for (;;) {
      const epoch = entry.epoch
      const result = await this.remote.get({ sessionId: entry.sessionId })
      if (epoch !== entry.epoch) continue
      entry.stale = false
      this.publish(entry, result.ok ? { view: result.value, readFailed: false } : { readFailed: true })
      return
    }
  }

  private publish(entry: Entry, patch: Partial<SelectionState>): void {
    entry.store.set({ ...entry.store.getSnapshot(), ...patch })
  }
}
