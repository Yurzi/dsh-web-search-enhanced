/** Minimal subset of the real DSH Storage Domain table contract. */
export interface Selection { connectionId: string | null; revision: number }
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
  get(id: string, initial: () => Promise<string | null>): Promise<Selection> {
    return this.serial(id, async () => {
      const stored = this.table.get(id)
      if (stored) return { ...stored }
      const value = { connectionId: await initial(), revision: 0 }
      await this.table.put(id, value)
      return { ...value }
    })
  }
  set(id: string, connectionId: string | null, expectedRevision: number): Promise<Selection> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return Promise.reject(new SelectionConflict())
    return this.serial(id, async () => {
      if (!this.table.get(id)) throw new SelectionConflict()
      return { ...await this.table.update(id, current => {
        if (current.revision !== expectedRevision || current.revision >= Number.MAX_SAFE_INTEGER) throw new SelectionConflict()
        return { connectionId, revision: current.revision + 1 }
      }) }
    })
  }
  async fork(source: string, target: string, initial: () => Promise<string | null>): Promise<Selection> {
    const parent = await this.get(source, initial)
    return this.get(target, async () => parent.connectionId)
  }
  delete(id: string): Promise<boolean> { return this.serial(id, () => this.table.delete(id)) }
}
