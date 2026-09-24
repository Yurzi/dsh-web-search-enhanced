import type { SearchConnectionRemote, SearchSelectionResponse } from './SearchConnectionSelector.tsx'

type Result = Awaited<ReturnType<SearchConnectionRemote['get']>>
type Change = Omit<Parameters<SearchConnectionRemote['set']>[0], 'sessionId'>
export interface SelectionReadOptions { force?: boolean; modelKey?: string }
interface Entry {
  value?: SearchSelectionResponse
  expires: number
  generation: number
  modelKey?: string
  reading?: Promise<Result> | undefined
  writing?: Promise<Result> | undefined
}

/** One instance per mounted Remote namespace, never a process-global/session-only cache. */
export class SelectionClient {
  private entries = new Map<string, Entry>()
  private disposed = false
  private epoch = 0
  constructor(private remote: SearchConnectionRemote, private ttl = 30_000, private capacity = 64) {}

  private entry(sessionId: string): Entry {
    this.assertActive()
    let entry = this.entries.get(sessionId)
    if (!entry) entry = { expires: 0, generation: 0 }
    this.entries.delete(sessionId)
    this.entries.set(sessionId, entry)
    return entry
  }
  private prune() {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.capacity) break
      // Pending operations must remain shared even when the idle cache is full.
      if (!entry.reading && !entry.writing) this.entries.delete(id)
    }
  }
  private assertActive(epoch = this.epoch) {
    if (this.disposed) throw new Error('Search selection client disposed')
    if (epoch !== this.epoch) throw new Error('Search connection changed')
  }
  invalidate() {
    for (const entry of this.entries.values()) { entry.expires = 0; ++entry.generation }
  }
  /** Transport loss/replacement must not reuse or replay work from the old Host. */
  reset() { ++this.epoch; this.entries.clear() }
  dispose() { this.disposed = true; this.reset() }

  get(sessionId: string, options: SelectionReadOptions = {}): Promise<Result> {
    const entry = this.entry(sessionId)
    const epoch = this.epoch
    if (options.modelKey !== undefined && options.modelKey !== entry.modelKey) {
      entry.modelKey = options.modelKey
      entry.expires = 0
      ++entry.generation
    }
    // Explicit retries bypass the TTL, but still join an already pending read.
    if (options.force) entry.expires = 0
    if (entry.reading) return entry.reading
    // A cache hit is not a network request: do not let a simultaneous forced
    // retry join an already-resolved cached response.
    if (!entry.writing && entry.value && Date.now() < entry.expires) {
      this.prune()
      return Promise.resolve({ ok: true, value: entry.value })
    }
    const read = async (): Promise<Result> => {
      for (;;) {
        this.assertActive(epoch)
        if (entry.writing) { await entry.writing.catch(() => {}); continue }
        if (entry.value && Date.now() < entry.expires) {
          entry.reading = undefined
          return { ok: true, value: entry.value }
        }
        const generation = entry.generation
        let result: Result
        try { result = await this.remote.get({ sessionId }) }
        catch (error) {
          this.assertActive(epoch)
          if (generation !== entry.generation) continue
          entry.reading = undefined
          throw error
        }
        this.assertActive(epoch)
        // Model/config invalidation or a write during this read needs a trailing
        // read (or the confirmed write value), never the obsolete response.
        if (generation !== entry.generation) continue
        if (result.ok) { entry.value = result.value; entry.expires = Date.now() + this.ttl }
        // Stop advertising this settled result before Promise.finally runs: a
        // model change in the next microtask must start/join a fresh request.
        entry.reading = undefined
        return result
      }
    }
    const pending = read().finally(() => {
      if (entry.reading === pending) entry.reading = undefined
      this.prune()
    })
    entry.reading = pending
    this.prune()
    return pending
  }

  set(sessionId: string, request: Change): Promise<Result> {
    const entry = this.entry(sessionId)
    const epoch = this.epoch
    const generation = ++entry.generation
    entry.expires = 0
    const previous = entry.writing
    const write = async (): Promise<Result> => {
      if (previous) await previous.catch(() => {})
      this.assertActive(epoch)
      const result = await this.remote.set({ ...request, sessionId })
      this.assertActive(epoch)
      if (generation === entry.generation && result.ok) {
        entry.value = result.value
        entry.expires = Date.now() + this.ttl
      }
      return result
    }
    const pending = write().finally(() => {
      if (entry.writing === pending) entry.writing = undefined
      this.prune()
    })
    entry.writing = pending
    this.prune()
    return pending
  }
}
