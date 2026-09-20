import { AsyncLocalStorage } from 'node:async_hooks'
import type { Connection, FixedBinding, ResolvedSettings } from '../config.ts'
import type { Freshness } from '../catalog.ts'
import type { Selection } from './session-selection.ts'
export interface SearchSnapshot {
  readonly sessionId: string; readonly turn: number; readonly step: number
  readonly selection: Readonly<Selection>; readonly freshness: Freshness
  readonly connection?: Readonly<Connection>
  readonly error?: string
  readonly errorCode?: string
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
/** One snapshot per Agent + inference step, NOT one mutable global current Session. */
export class ExecutionContexts {
  private snapshots = new WeakMap<object, SearchSnapshot>()
  private execution = new AsyncLocalStorage<{ snapshot: SearchSnapshot; binding?: FixedBinding; bindingError?: string }>()
  capture(agent: object, sessionId: string, turn: number, step: number, selection: Selection, settings: ResolvedSettings, error?: string, errorCode?: string): SearchSnapshot {
    const previous = this.snapshots.get(agent)
    if (previous?.turn === turn && previous.step === step && previous.errorCode !== 'WEB_SEARCH_STORAGE_UNAVAILABLE') return previous
    const connection = selection.connectionId === null ? undefined : settings.connections[selection.connectionId]
    const snapshot: SearchSnapshot = freeze(structuredClone({ sessionId, turn, step, selection: { connectionId: selection.connectionId, revision: selection.revision }, freshness: settings.freshness,
      ...(connection ? { connection } : {}), ...(error ? { error } : {}), ...(errorCode ? { errorCode } : {}) }))
    this.snapshots.set(agent, snapshot)
    return snapshot
  }
  peek(agent: object): SearchSnapshot | undefined { return this.snapshots.get(agent) }
  forget(agent: object): void { this.snapshots.delete(agent) }
  run<T>(snapshot: SearchSnapshot, binding: FixedBinding | undefined, bindingError: string | undefined, next: () => T): T {
    return this.execution.run({ snapshot, ...(binding ? { binding: freeze(structuredClone(binding)) } : {}), ...(bindingError ? { bindingError } : {}) }, next)
  }
  current() { return this.execution.getStore() }
}
