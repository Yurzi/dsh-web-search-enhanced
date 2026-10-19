/** Session selections and model pairings over the real JSON storage-domain backend. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Pairings } from '../src/host/pairings.ts'
import { SearchRestriction } from '../src/host/restriction.ts'
import { SearchSessions, SelectionConflict } from '../src/host/selections.ts'
import { SearchStorage } from '../src/host/storage.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { V2Config } from '../src/settings/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
/** The error a promise rejects with. */
async function rejection(pending: Promise<unknown>): Promise<Error> {
  try {
    await pending
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a rejection')
}

afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

const custom = (label: string) => ({ kind: 'structured', label, adapter: 'exa', credentialRef: 'TEST_KEY' } as const)
const BASE: V2Config = { version: 2, defaultConnection: 'custom:a', connections: { 'custom:a': custom('A'), 'custom:b': custom('B') } }
/** No default and only the API-key built-ins enabled, so readiness decides the default. */
const ONLY_KEYED: V2Config = { version: 2, connections: Object.fromEntries(['exa', 'firecrawl', 'tavily', 'tinyfish', 'openalex', 'session-model'].map(id => [`builtin:${id}`, { disabled: true }])) }

async function world(options: { root?: string; storage?: boolean } = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'search-selections-'))
  if (options.root === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => ctx.fiber.dispose())
  new Storage(ctx)
  StorageJson.apply(ctx, { root })
  if (options.storage !== false) await StorageDomain.apply(ctx, { backend: 'json' })
  const configured = new Set(['TEST_KEY'])
  const describe = vi.fn(async (ref: string) => ({ configured: configured.has(ref) }))
  ctx.provide('credentials', { describe } as never)
  let config = BASE
  const storage = new SearchStorage(ctx)
  const restriction = { sync: vi.fn() }
  const sessions = new SearchSessions(ctx, () => resolveSettings(config), storage, new Pairings(storage), restriction as unknown as SearchRestriction)
  const agent = (id: string, options: { model?: string; parent?: string } = {}) => ({
    options: options.model === undefined ? {} : { provider: 'p', model: options.model },
    session: { id, header: options.parent === undefined ? {} : { parentSession: options.parent, isSeeded: true }, requestHeader: () => undefined },
  }) as unknown as Agent
  return { ctx, root, sessions, agent, configured, describe, restriction, configure: (next: V2Config) => { config = next } }
}

describe('first selection of a session', () => {
  it('starts at the configured default with the default freshness', async () => {
    const w = await world()
    w.configure({ ...BASE, freshness: 'fresh' })
    await expect(w.sessions.current(w.agent('one'))).resolves.toEqual({ connectionId: 'custom:a', freshness: 'fresh', revision: 0 })
  })

  it('without a default, picks the only ready connection, else none', async () => {
    const w = await world()
    w.configure(ONLY_KEYED)
    w.configured.add('DEEPSEEK_API_KEY')
    expect((await w.sessions.current(w.agent('single'))).connectionId).toBe('builtin:deepseek')
    w.configure({ version: 2 })
    expect((await w.sessions.current(w.agent('many'))).connectionId).toBeNull()
  })

  it("starts with the connection last chosen for the session's model", async () => {
    const w = await world()
    await w.sessions.current(w.agent('a1', { model: 'chat' }))
    await w.sessions.change(w.agent('a1', { model: 'chat' }), { connectionId: 'custom:b' }, 0)
    await w.sessions.change(w.agent('a1', { model: 'chat' }), { freshness: 'realtime' }, 1)
    expect(await w.sessions.current(w.agent('a2', { model: 'chat' }))).toMatchObject({ connectionId: 'custom:b', freshness: 'auto', revision: 0 })
    expect((await w.sessions.current(w.agent('other', { model: 'other' }))).connectionId).toBe('custom:a')

    await w.sessions.change(w.agent('o1', { model: 'quiet' }), { connectionId: null }, 0)
    expect((await w.sessions.current(w.agent('o2', { model: 'quiet' }))).connectionId).toBeNull()

    w.configure({ ...BASE, connections: { ...BASE.connections, 'custom:b': { ...custom('B'), disabled: true } } })
    expect((await w.sessions.current(w.agent('a3', { model: 'chat' }))).connectionId).toBe('custom:a')
  })

  it('inherits a seeded fork from its parent once, then keeps both independent', async () => {
    const w = await world()
    await w.sessions.current(w.agent('parent'))
    await w.sessions.change(w.agent('parent'), { connectionId: null, freshness: 'realtime' }, 0)
    const fork = w.agent('fork', { parent: 'parent' })
    expect(await w.sessions.current(fork)).toEqual({ connectionId: null, freshness: 'realtime', revision: 0 })
    await w.sessions.change(fork, { connectionId: 'custom:b', freshness: 'fresh' }, 0)
    await w.sessions.change(w.agent('parent'), { freshness: 'auto' }, 1)
    expect(await w.sessions.current(fork)).toEqual({ connectionId: 'custom:b', freshness: 'fresh', revision: 1 })
    expect(await w.sessions.current(w.agent('parent'))).toEqual({ connectionId: null, freshness: 'auto', revision: 2 })
    expect((await w.sessions.current(w.agent('orphan', { parent: 'missing' }))).connectionId).toBe('custom:a')
  })
})

describe('selection changes', () => {
  it('follows the default until the user chooses, then keeps the choice', async () => {
    const w = await world()
    const agent = w.agent('one', { model: 'chat' })
    await w.sessions.current(agent)
    w.configure({ ...BASE, defaultConnection: 'custom:b' })
    expect(await w.sessions.current(agent)).toMatchObject({ connectionId: 'custom:b', revision: 0 })
    await w.sessions.change(agent, { connectionId: 'custom:a' }, 0)
    w.configure({ ...BASE, defaultConnection: 'builtin:exa' })
    expect(await w.sessions.current(agent)).toMatchObject({ connectionId: 'custom:a', revision: 1 })
  })

  it('applies one compare-and-set revision to connection and freshness', async () => {
    const w = await world()
    const agent = w.agent('one')
    await w.sessions.current(agent)
    const results = await Promise.allSettled([
      w.sessions.change(agent, { freshness: 'realtime' }, 0),
      w.sessions.change(agent, { connectionId: 'custom:b' }, 0),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.any(SelectionConflict) })
    await expect(w.sessions.change(agent, { freshness: 'fresh' }, 0)).rejects.toBeInstanceOf(SelectionConflict)
    expect((await w.sessions.current(agent)).revision).toBe(1)
  })

  it('never lets a slow read undo a concurrent change', async () => {
    const w = await world()
    w.configure(ONLY_KEYED)
    w.configured.add('DEEPSEEK_API_KEY')
    const agent = w.agent('one')
    expect((await w.sessions.current(agent)).connectionId).toBe('builtin:deepseek')
    // The next read re-evaluates the default and stalls on Credentials.
    const stalled = Promise.withResolvers<void>()
    let gate: Promise<void> | undefined = stalled.promise
    w.describe.mockImplementation(async ref => {
      await gate
      return { configured: w.configured.has(ref) }
    })
    const reading = w.sessions.current(agent)
    await vi.waitFor(() => expect(w.describe).toHaveBeenCalledTimes(4))
    gate = undefined
    const changing = w.sessions.change(agent, { connectionId: null }, 0)
    await new Promise(resolve => setTimeout(resolve, 20)) // room for an unserialized change to commit
    stalled.resolve()
    await Promise.all([reading, changing])
    expect(w.restriction.sync).toHaveBeenLastCalledWith(agent, null)
    expect(await w.sessions.current(agent)).toMatchObject({ connectionId: null, revision: 1 })
  })
})

describe('storage', () => {
  it('persists selections and pairings across a restart', async () => {
    const first = await world()
    await first.sessions.current(first.agent('one', { model: 'chat' }))
    await first.sessions.change(first.agent('one', { model: 'chat' }), { connectionId: 'custom:b', freshness: 'fresh' }, 0)
    await first.ctx.fiber.dispose()
    const second = await world({ root: first.root })
    expect(await second.sessions.current(second.agent('one'))).toEqual({ connectionId: 'custom:b', freshness: 'fresh', revision: 1 })
    expect((await second.sessions.current(second.agent('two', { model: 'chat' }))).connectionId).toBe('custom:b')
  })

  it('gives pre-freshness records the current default once, keeping their choice and revision', async () => {
    const first = await world()
    const legacy = StorageDomain.defineDomain({ name: 'web_search_enhanced', version: 1, tables: {
      selections: StorageDomain.domainTable(z.object({ connectionId: z.string().nullable(), revision: z.number() }).strict()),
    } })
    const old = await first.ctx.storageDomain.open(legacy)
    await old.table('selections').put('one', { connectionId: null, revision: 5 })
    await old.close()
    first.configure({ ...BASE, freshness: 'fresh' })
    expect(await first.sessions.current(first.agent('one'))).toEqual({ connectionId: null, freshness: 'fresh', revision: 5 })
    first.configure({ ...BASE, freshness: 'realtime' })
    expect((await first.sessions.current(first.agent('one'))).freshness).toBe('fresh')
    await expect(first.sessions.change(first.agent('one'), { freshness: 'auto' }, 5)).resolves.toEqual({ connectionId: null, freshness: 'auto', revision: 6 })
  })

  it('reports missing storage and recovers once the storage domain mounts', async () => {
    const w = await world({ storage: false })
    await expect(w.sessions.current(w.agent('one'))).rejects.toMatchObject({ code: 'WEB_SEARCH_STORAGE_UNAVAILABLE' })
    await StorageDomain.apply(w.ctx, { backend: 'json' })
    await expect(w.sessions.current(w.agent('one'))).resolves.toMatchObject({ connectionId: 'custom:a' })
  })

  it('retries a failed open without leaking its error', async () => {
    const w = await world()
    vi.spyOn(w.ctx.storageDomain, 'open').mockRejectedValueOnce(new Error('sensitive backend path'))
    const error = await rejection(w.sessions.current(w.agent('one')))
    expect(error).toMatchObject({ code: 'WEB_SEARCH_STORAGE_UNAVAILABLE' })
    expect(error.message).not.toContain('sensitive')
    await expect(w.sessions.current(w.agent('one'))).resolves.toMatchObject({ revision: 0 })
  })
})