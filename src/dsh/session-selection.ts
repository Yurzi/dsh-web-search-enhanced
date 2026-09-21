import type { Freshness } from '../catalog.ts'
/** Optional only for backward-readable persisted records. Reads materialize it once. */
export interface Selection { connectionId: string | null; revision: number; freshness?: Freshness | undefined }
export interface SelectionChanges { connectionId?: string | null; freshness?: Freshness | undefined }
type InitialSelection = string | null | { connectionId: string | null; freshness: Freshness }
/** Minimal subset of the real DSH Storage Domain table contract. */
export interface SelectionTable {
  get(key: string): Selection | undefined
  put(key: string, value: Selection): Promise<void>
  update(key: string, fn: (current: Selection) => Selection): Promise<Selection>
  delete(key: string): Promise<boolean>
}
export class SelectionConflict extends Error { readonly code = 'SEARCH_SELECTION_CONFLICT'; constructor() { super('Search selection changed in another window; refresh and retry') } }
/** Initialization and lifecycle writes serialize locally; update is storage-atomic. */
export class SessionSelections {
  private tails = new Map<string, Promise<unknown>>()
  constructor(private table: SelectionTable) {}
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(work)
    this.tails.set(id, task)
    void task.finally(() => { if (this.tails.get(id) === task) this.tails.delete(id) }).catch(() => {})
    return task
  }
  get(id: string, initial: () => Promise<InitialSelection>, defaultFreshness: Freshness = 'auto'): Promise<Selection> {
    return this.serial(id, async () => {
      const stored = this.table.get(id)
      if (stored) {
        if (stored.freshness !== undefined) return { ...stored }
        // Additive lazy materialization, not a domain migration. Preserve null and CAS
        // revision; an atomic update must not overwrite concurrent connection edits.
        return { ...await this.table.update(id, current => current.freshness !== undefined
          ? current : { ...current, freshness: defaultFreshness }) }
      }
      const defaults = await initial()
      const value = { ...(typeof defaults === 'object' && defaults !== null
        ? defaults : { connectionId: defaults, freshness: defaultFreshness }), revision: 0 }
      await this.table.put(id, value)
      return { ...value }
    })
  }
  set(id: string, change: string | null | SelectionChanges, expectedRevision: number): Promise<Selection> {
    const changes = typeof change === 'object' && change !== null ? change : { connectionId: change }
    if (changes.connectionId === undefined && changes.freshness === undefined) return Promise.reject(new Error('Search selection requires a change'))
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return Promise.reject(new SelectionConflict())
    return this.serial(id, async () => {
      if (!this.table.get(id)) throw new SelectionConflict()
      return { ...await this.table.update(id, current => {
        if (current.revision !== expectedRevision || current.revision >= Number.MAX_SAFE_INTEGER) throw new SelectionConflict()
        return { ...current, ...(changes.connectionId !== undefined ? { connectionId: changes.connectionId } : {}),
          ...(changes.freshness !== undefined ? { freshness: changes.freshness } : {}), revision: current.revision + 1 }
      }) }
    })
  }
  updateDefault(id: string, connectionId: string | null): Promise<Selection> {
    return this.serial(id, async () => {
      const stored = this.table.get(id)
      if (!stored || stored.revision !== 0) return stored ?? { connectionId: null, revision: 0 }
      if (stored.connectionId === connectionId) return { ...stored }
      return { ...await this.table.update(id, current => current.revision === 0
        ? { ...current, connectionId } : current) }
    })
  }
  async fork(source: string, target: string, initial: () => Promise<InitialSelection>, defaultFreshness: Freshness = 'auto'): Promise<Selection> {
    const parent = await this.get(source, initial, defaultFreshness)
    return this.get(target, async () => ({ connectionId: parent.connectionId, freshness: parent.freshness! }), defaultFreshness)
  }
  delete(id: string): Promise<boolean> { return this.serial(id, () => this.table.delete(id)) }
}
