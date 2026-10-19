/**
 * Per-session search selection: which connection a session searches with and
 * its freshness, under one compare-and-set revision. Revision 0 means the user
 * never chose, so the session keeps following the computed default.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Freshness } from '../catalog.ts'
import type { ConnectionView } from '../remote-contract.ts'
import type { ResolvedSettings } from '../settings/resolve.ts'
import { describeConnections } from './connections.ts'
import { nextModel } from './follow-model.ts'
import type { Pairings } from './pairings.ts'
import type { SearchRestriction } from './restriction.ts'
import type { SearchStorage, StoredSelection } from './storage.ts'

export interface Selection {
  /** `null` turns web_search off for the session. */
  readonly connectionId: string | null
  readonly freshness: Freshness
  readonly revision: number
}

export interface SelectionChange {
  readonly connectionId?: string | null
  readonly freshness?: Freshness
}

/** The stored revision is not the one the caller read. */
export class SelectionConflict extends Error {
  constructor() {
    super('the search selection changed since it was read')
  }
}

type Table = KvTable<string, StoredSelection>

export class SearchSessions {
  /** Tail of each session's queue: reads and changes of one session never interleave. */
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly ctx: Context,
    readonly settings: () => ResolvedSettings,
    private readonly storage: SearchStorage,
    private readonly pairings: Pairings,
    private readonly restriction: SearchRestriction,
  ) {}

  /** The session's selection, created on first use; also applies it to the Agent's tools. */
  current(agent: Agent): Promise<Selection> {
    return this.exclusive(agent.session.id, async () => {
      const selection = await this.read(agent, await this.table())
      this.restriction.sync(agent, selection.connectionId)
      return selection
    })
  }

  /**
   * Apply a user's change. Choosing a connection also pairs it with the session's model.
   * @throws {@link SelectionConflict} when `expectedRevision` is stale.
   */
  change(agent: Agent, change: SelectionChange, expectedRevision: number): Promise<Selection> {
    return this.exclusive(agent.session.id, async () => {
      const table = await this.table()
      await this.read(agent, table)
      const { connectionId, freshness } = change
      const updated = await table.update(agent.session.id, current => {
        if (current.revision !== expectedRevision) throw new SelectionConflict()
        return {
          ...current,
          ...(connectionId === undefined ? {} : { connectionId }),
          ...(freshness === undefined ? {} : { freshness }),
          revision: current.revision + 1,
        }
      })
      const model = connectionId === undefined ? undefined : nextModel(this.ctx, agent)
      if (model !== undefined) await this.pairings.set(model, updated.connectionId)
      this.restriction.sync(agent, updated.connectionId)
      return selectionOf(updated, this.settings().freshness)
    })
  }

  connections(agent: Agent): Promise<ConnectionView[]> {
    return describeConnections(this.ctx, this.settings(), agent)
  }

  /** Whether a session may choose the connection: it exists and is enabled. */
  selectable(connectionId: string): boolean {
    return this.settings().connections.get(connectionId)?.disabled === false
  }

  private async table(): Promise<Table> {
    return (await this.storage.domain()).table('selections')
  }

  /** Run after the session's previous operation settles, whatever its outcome. */
  private exclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(sessionId) ?? Promise.resolve()).then(work)
    const tail = run.then(() => {}, () => {})
    this.queues.set(sessionId, tail)
    void tail.then(() => { if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId) })
    return run
  }

  /** Read, creating or updating the stored record; callers hold the session's queue. */
  private async read(agent: Agent, table: Table): Promise<Selection> {
    const settings = this.settings()
    const id = agent.session.id
    const stored = table.get(id)
    if (stored === undefined) {
      const selection = await this.initial(agent, settings, table)
      await table.put(id, selection)
      return selection
    }
    const selection = await this.materialize(table, id, stored, settings.freshness)
    if (selection.revision !== 0 || isSeededFork(agent)) return selection
    const expected = await this.defaultFor(agent, settings)
    if (expected === selection.connectionId) return selection
    return selectionOf(await table.update(id, current => current.revision === 0 ? { ...current, connectionId: expected } : current), settings.freshness)
  }

  /** A seeded fork inherits its parent's current selection once; other sessions start at the default. */
  private async initial(agent: Agent, settings: ResolvedSettings, table: Table): Promise<Selection> {
    const { parentSession, isSeeded } = agent.session.header
    const parent = parentSession !== undefined && isSeeded === true ? table.get(parentSession) : undefined
    if (parent !== undefined) return { connectionId: parent.connectionId, freshness: parent.freshness ?? settings.freshness, revision: 0 }
    return { connectionId: await this.defaultFor(agent, settings), freshness: settings.freshness, revision: 0 }
  }

  /** Records written before freshness existed take the current default once. */
  private async materialize(table: Table, id: string, stored: StoredSelection, freshness: Freshness): Promise<Selection> {
    if (stored.freshness !== undefined) return selectionOf(stored, freshness)
    return selectionOf(await table.update(id, current => current.freshness === undefined ? { ...current, freshness } : current), freshness)
  }

  /**
   * The model's paired connection (when it still exists and is enabled, or
   * search off), else the configured default, else the only ready connection.
   */
  private async defaultFor(agent: Agent, settings: ResolvedSettings): Promise<string | null> {
    const model = nextModel(this.ctx, agent)
    const paired = model === undefined ? undefined : await this.pairings.get(model)
    if (paired === null) return null
    if (paired !== undefined && settings.connections.get(paired)?.disabled === false) return paired
    if (settings.defaultConnection !== undefined) return settings.defaultConnection
    const ready = (await describeConnections(this.ctx, settings, agent)).filter(view => view.status === 'ready')
    return ready.length === 1 ? ready[0]!.id : null
  }
}

function isSeededFork(agent: Agent): boolean {
  return agent.session.header.parentSession !== undefined && agent.session.header.isSeeded === true
}

function selectionOf(stored: StoredSelection, freshness: Freshness): Selection {
  return { connectionId: stored.connectionId, freshness: stored.freshness ?? freshness, revision: stored.revision }
}