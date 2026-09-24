import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SelectionClient } from '../src/client/selection-client.ts'
import type { SearchConnectionRemote, SearchSelectionResponse } from '../src/client/SearchConnectionSelector.tsx'

type Result = Awaited<ReturnType<SearchConnectionRemote['get']>>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function success(connectionId: string, revision = 0): Result {
  const value: SearchSelectionResponse = {
    selection: { connectionId, revision }, connections: [], freshness: 'auto',
  }
  return { ok: true, value }
}
const failure: Result = { ok: false, error: new RemoteError('gateway/internal', 'unavailable', {}) }
const change = { connectionId: 'saved', expectedRevision: 0 }

function remote() {
  return { get: vi.fn<SearchConnectionRemote['get']>(), set: vi.fn<SearchConnectionRemote['set']>() }
}

// Let already queued promise continuations run; never advance a polling timer.
async function flushPromises() {
  for (let i = 0; i < 10; ++i) await Promise.resolve()
}

describe('SelectionClient', () => {
  const clients: SelectionClient[] = []
  function client(api: SearchConnectionRemote, ttl?: number, capacity?: number) {
    const value = new SelectionClient(api, ttl, capacity)
    clients.push(value)
    return value
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => {
    for (const value of clients.splice(0)) value.dispose()
    vi.useRealTimers()
  })

  it('does not join a settled network result before its cleanup microtask', async () => {
    const api = remote(), old = deferred<Result>(), fresh = deferred<Result>()
    api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const cache = client(api)
    const first = cache.get('a', { modelKey: 'old' })
    old.resolve(success('old'))
    // The read continuation settles before this continuation, but its finally
    // cleanup has not yet run. A new model must not join that accepted result.
    await Promise.resolve()
    const second = cache.get('a', { modelKey: 'new' })
    expect(api.get).toHaveBeenCalledTimes(2)
    await first
    const joined = cache.get('a', { modelKey: 'new' })
    expect(api.get).toHaveBeenCalledTimes(2)
    fresh.resolve(success('new'))
    expect(await Promise.all([second, joined])).toEqual([success('new'), success('new')])
  })

  it('uses the default 30-second TTL without scheduling timer polling', async () => {
    const api = remote()
    api.get.mockResolvedValueOnce(success('first')).mockResolvedValue(success('fresh'))
    const cache = client(api)
    expect(await cache.get('a')).toEqual(success('first'))
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(await cache.get('a')).toEqual(success('first'))
    expect(api.get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(await cache.get('a')).toEqual(success('fresh'))
    expect(api.get).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts a custom TTL when the response settles, not when it starts', async () => {
    const api = remote(), pending = deferred<Result>()
    api.get.mockReturnValueOnce(pending.promise).mockResolvedValue(success('fresh'))
    const cache = client(api, 100)
    const read = cache.get('a')
    await vi.advanceTimersByTimeAsync(1_000)
    pending.resolve(success('slow'))
    await read
    await vi.advanceTimersByTimeAsync(99)
    expect(await cache.get('a')).toEqual(success('slow'))
    expect(api.get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await cache.get('a')).toEqual(success('fresh'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent reads, including a forced retry already in flight', async () => {
    const api = remote(), pending = deferred<Result>()
    api.get.mockReturnValue(pending.promise)
    const cache = client(api)
    const reads = [cache.get('a'), cache.get('a'), cache.get('a', { force: true })]
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledWith({ sessionId: 'a' })
    pending.resolve(success('shared'))
    expect(await Promise.all(reads)).toEqual(Array(3).fill(success('shared')))
    expect(await cache.get('a')).toEqual(success('shared'))
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('isolates pending reads and cached selections by session', async () => {
    const api = remote(), a = deferred<Result>(), b = deferred<Result>()
    api.get.mockImplementation(({ sessionId }) => sessionId === 'a' ? a.promise : b.promise)
    const cache = client(api)
    const readA = cache.get('a'), readB = cache.get('b')
    b.resolve(success('b'))
    expect(await readB).toEqual(success('b'))
    a.resolve(success('a'))
    expect(await readA).toEqual(success('a'))
    expect(await cache.get('a')).toEqual(success('a'))
    expect(await cache.get('b')).toEqual(success('b'))
    expect(api.get.mock.calls).toEqual([[{ sessionId: 'a' }], [{ sessionId: 'b' }]])
  })

  it('does not share cache entries between remote namespaces', async () => {
    const apiA = remote(), apiB = remote()
    apiA.get.mockResolvedValue(success('namespace-a'))
    apiB.get.mockResolvedValue(success('namespace-b'))
    const a = client(apiA), b = client(apiB)
    expect(await a.get('same-session')).toEqual(success('namespace-a'))
    expect(await b.get('same-session')).toEqual(success('namespace-b'))
    expect(apiA.get).toHaveBeenCalledTimes(1)
    expect(apiB.get).toHaveBeenCalledTimes(1)
  })

  it('forces a retry despite a fresh cached value and caches the replacement', async () => {
    const api = remote()
    api.get.mockResolvedValueOnce(success('old')).mockResolvedValueOnce(success('new'))
    const cache = client(api)
    await cache.get('a')
    expect(await cache.get('a', { force: true })).toEqual(success('new'))
    expect(await cache.get('a')).toEqual(success('new'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('does not let a same-turn forced retry join an already resolved cache hit', async () => {
    const api = remote(), fresh = deferred<Result>()
    api.get.mockResolvedValueOnce(success('cached')).mockReturnValueOnce(fresh.promise)
    const cache = client(api)
    await cache.get('a')
    const cached = cache.get('a')
    const forced = cache.get('a', { force: true })
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(await cached).toEqual(success('cached'))
    fresh.resolve(success('updated'))
    expect(await forced).toEqual(success('updated'))
    expect(await cache.get('a')).toEqual(success('updated'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('does not let a same-turn model change join an already resolved cache hit', async () => {
    const api = remote(), fresh = deferred<Result>()
    api.get.mockResolvedValueOnce(success('model-a')).mockReturnValueOnce(fresh.promise)
    const cache = client(api)
    await cache.get('a', { modelKey: 'model-a' })
    const cached = cache.get('a', { modelKey: 'model-a' })
    const changed = cache.get('a', { modelKey: 'model-b' })
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(await cached).toEqual(success('model-a'))
    fresh.resolve(success('model-b'))
    expect(await changed).toEqual(success('model-b'))
    expect(await cache.get('a', { modelKey: 'model-b' })).toEqual(success('model-b'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('does not let a same-turn invalidation join an already resolved cache hit', async () => {
    const api = remote(), fresh = deferred<Result>()
    api.get.mockResolvedValueOnce(success('cached')).mockReturnValueOnce(fresh.promise)
    const cache = client(api)
    await cache.get('a')
    const cached = cache.get('a')
    cache.invalidate()
    const refreshed = cache.get('a')
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(await cached).toEqual(success('cached'))
    fresh.resolve(success('revalidated'))
    expect(await refreshed).toEqual(success('revalidated'))
    expect(await cache.get('a')).toEqual(success('revalidated'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it.each(['result', 'throw'] as const)('does not cache a read error (%s) or resurrect an older cached value', async kind => {
    const api = remote()
    api.get.mockResolvedValueOnce(success('old'))
    if (kind === 'result') api.get.mockResolvedValueOnce(failure)
    else api.get.mockRejectedValueOnce(new Error('transport failed'))
    api.get.mockResolvedValueOnce(success('recovered'))
    const cache = client(api)
    await cache.get('a')
    const retry = cache.get('a', { force: true })
    if (kind === 'result') expect(await retry).toEqual(failure)
    else await expect(retry).rejects.toThrow('transport failed')
    expect(await cache.get('a')).toEqual(success('recovered'))
    expect(await cache.get('a')).toEqual(success('recovered'))
    expect(api.get).toHaveBeenCalledTimes(3)
  })

  it('invalidates a fresh cache on model change but not an unchanged model', async () => {
    const api = remote()
    api.get.mockResolvedValueOnce(success('model-a')).mockResolvedValueOnce(success('model-b'))
    const cache = client(api)
    await cache.get('a', { modelKey: 'a' })
    expect(await cache.get('a', { modelKey: 'a' })).toEqual(success('model-a'))
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(await cache.get('a', { modelKey: 'b' })).toEqual(success('model-b'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'error result', 'rejection'] as const)('discards an old model in-flight %s and shares one trailing read', async outcome => {
    const api = remote(), old = deferred<Result>(), fresh = deferred<Result>()
    api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const cache = client(api)
    const first = cache.get('a', { modelKey: 'old' })
    const second = cache.get('a', { modelKey: 'intermediate' })
    const third = cache.get('a', { modelKey: 'latest' })
    expect(api.get).toHaveBeenCalledTimes(1)
    if (outcome === 'rejection') old.reject(new Error('obsolete error'))
    else old.resolve(outcome === 'error result' ? failure : success('obsolete'))
    await flushPromises()
    expect(api.get).toHaveBeenCalledTimes(2)
    const fourth = cache.get('a', { modelKey: 'latest' })
    expect(api.get).toHaveBeenCalledTimes(2)
    fresh.resolve(success('latest'))
    expect(await Promise.all([first, second, third, fourth])).toEqual(Array(4).fill(success('latest')))
    expect(await cache.get('a', { modelKey: 'latest' })).toEqual(success('latest'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('invalidates all sessions without eagerly fetching or polling', async () => {
    const api = remote()
    api.get.mockImplementation(async ({ sessionId }) => success(sessionId))
    const cache = client(api)
    await cache.get('a'); await cache.get('b')
    cache.invalidate()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.get).toHaveBeenCalledTimes(2)
    await cache.get('a'); await cache.get('b')
    expect(api.get).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['before', 'after'] as const)('never lets a delayed GET overwrite SET when GET settles %s the write', async order => {
    const api = remote(), get = deferred<Result>(), set = deferred<Result>()
    api.get.mockReturnValueOnce(get.promise)
    api.set.mockReturnValueOnce(set.promise)
    const cache = client(api)
    const reading = cache.get('a')
    const writing = cache.set('a', change)
    expect(api.set).toHaveBeenCalledWith({ sessionId: 'a', ...change })
    if (order === 'before') {
      get.resolve(success('obsolete'))
      await flushPromises()
      expect(api.get).toHaveBeenCalledTimes(1)
    }
    set.resolve(success('saved', 1))
    expect(await writing).toEqual(success('saved', 1))
    if (order === 'after') get.resolve(success('obsolete'))
    expect(await reading).toEqual(success('saved', 1))
    expect(await cache.get('a')).toEqual(success('saved', 1))
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('waits for a pending write and serves its confirmed value without a GET', async () => {
    const api = remote(), set = deferred<Result>()
    api.set.mockReturnValueOnce(set.promise)
    const cache = client(api)
    const writing = cache.set('a', change), reading = cache.get('a')
    expect(api.get).not.toHaveBeenCalled()
    set.resolve(success('saved', 1))
    await writing
    expect(await reading).toEqual(success('saved', 1))
    expect(api.get).not.toHaveBeenCalled()
  })

  it('requires the next GET when invalidation occurs during a successful write', async () => {
    const api = remote(), set = deferred<Result>()
    api.set.mockReturnValueOnce(set.promise)
    api.get.mockResolvedValue(success('revalidated', 2))
    const cache = client(api)
    const writing = cache.set('a', change)
    cache.invalidate()
    set.resolve(success('saved', 1))
    expect(await writing).toEqual(success('saved', 1))
    expect(api.get).not.toHaveBeenCalled()
    expect(await cache.get('a')).toEqual(success('revalidated', 2))
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it.each(['result', 'throw'] as const)('allows a waiting read to refresh after a failed write (%s)', async kind => {
    const api = remote(), set = deferred<Result>()
    api.get.mockResolvedValueOnce(success('old')).mockResolvedValueOnce(success('refreshed', 1))
    api.set.mockReturnValueOnce(set.promise)
    const cache = client(api)
    await cache.get('a')
    const writing = cache.set('a', change)
    const writeOutcome = kind === 'throw' ? expect(writing).rejects.toThrow('write failed') : expect(writing).resolves.toEqual(failure)
    const reading = cache.get('a')
    expect(api.get).toHaveBeenCalledTimes(1)
    if (kind === 'throw') set.reject(new Error('write failed'))
    else set.resolve(failure)
    await writeOutcome
    expect(await reading).toEqual(success('refreshed', 1))
    expect(await cache.get('a')).toEqual(success('refreshed', 1))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it.each(['get', 'set'] as const)('rejects a late successful %s result after disposal and prevents new operations', async operation => {
    const api = remote(), pending = deferred<Result>()
    api[operation].mockReturnValueOnce(pending.promise)
    const cache = client(api)
    const running = operation === 'get' ? cache.get('a') : cache.set('a', change)
    const rejected = expect(running).rejects.toThrow(/disposed/i)
    cache.dispose()
    pending.resolve(success('too late'))
    await rejected
    await expect(Promise.resolve().then(() => cache.get('a'))).rejects.toThrow(/disposed/i)
    await expect(Promise.resolve().then(() => cache.set('a', change))).rejects.toThrow(/disposed/i)
    expect(api[operation]).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['success', 'rejection'] as const)('rejects an old transport read (%s) after reset without replaying or disturbing the new read', async outcome => {
    const api = remote(), old = deferred<Result>(), current = deferred<Result>()
    api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const cache = client(api)
    const oldRead = cache.get('a')
    const rejected = expect(oldRead).rejects.toThrow(/connection changed/i)
    cache.reset()
    const newRead = cache.get('a')
    expect(api.get).toHaveBeenCalledTimes(2)
    if (outcome === 'success') old.resolve(success('old-host'))
    else old.reject(new Error('old transport failed'))
    await rejected
    const joinedRead = cache.get('a')
    expect(api.get).toHaveBeenCalledTimes(2)
    current.resolve(success('new-host'))
    expect(await Promise.all([newRead, joinedRead])).toEqual([success('new-host'), success('new-host')])
    expect(await cache.get('a')).toEqual(success('new-host'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('rejects pending and queued writes after reset without replaying them into the new transport', async () => {
    const api = remote(), pending = deferred<Result>()
    api.set.mockReturnValueOnce(pending.promise)
    api.get.mockResolvedValue(success('new-host'))
    const cache = client(api)
    const firstWrite = cache.set('a', change)
    const secondWrite = cache.set('a', { connectionId: 'queued', expectedRevision: 1 })
    const firstRejected = expect(firstWrite).rejects.toThrow(/connection changed/i)
    const secondRejected = expect(secondWrite).rejects.toThrow(/connection changed/i)
    expect(api.set).toHaveBeenCalledTimes(1)
    cache.reset()
    expect(await cache.get('a')).toEqual(success('new-host'))
    pending.resolve(success('old-host', 1))
    await Promise.all([firstRejected, secondRejected])
    expect(api.set).toHaveBeenCalledTimes(1)
    expect(await cache.get('a')).toEqual(success('new-host'))
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it('clears fresh cached values on transport reset', async () => {
    const api = remote()
    api.get.mockResolvedValueOnce(success('old-host')).mockResolvedValueOnce(success('new-host'))
    const cache = client(api)
    await cache.get('a')
    cache.reset()
    expect(await cache.get('a')).toEqual(success('new-host'))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used idle session when capacity is exceeded', async () => {
    const api = remote()
    api.get.mockImplementation(async ({ sessionId }) => success(sessionId))
    const cache = client(api, 30_000, 2)
    await cache.get('a'); await cache.get('b'); await cache.get('a'); await cache.get('c')
    expect(api.get).toHaveBeenCalledTimes(3)
    await cache.get('a')
    expect(api.get).toHaveBeenCalledTimes(3)
    await cache.get('b')
    expect(api.get).toHaveBeenCalledTimes(4)
    expect(api.get).toHaveBeenLastCalledWith({ sessionId: 'b' })
  })

  it('defaults to 64 cached idle sessions', async () => {
    const api = remote()
    api.get.mockImplementation(async ({ sessionId }) => success(sessionId))
    const cache = client(api)
    for (let i = 0; i < 64; ++i) await cache.get(String(i))
    await cache.get('0')
    expect(api.get).toHaveBeenCalledTimes(64)
    await cache.get('64')
    await cache.get('0')
    expect(api.get).toHaveBeenCalledTimes(65)
    await cache.get('1')
    expect(api.get).toHaveBeenCalledTimes(66)
  })

  it('retains in-flight sessions beyond capacity so new concurrent reads still deduplicate', async () => {
    const api = remote(), a = deferred<Result>(), b = deferred<Result>()
    api.get.mockImplementation(({ sessionId }) => sessionId === 'a' ? a.promise : b.promise)
    const cache = client(api, 30_000, 1)
    const firstA = cache.get('a'), firstB = cache.get('b')
    const secondA = cache.get('a'), secondB = cache.get('b')
    expect(api.get).toHaveBeenCalledTimes(2)
    a.resolve(success('a')); b.resolve(success('b'))
    expect(await Promise.all([firstA, firstB, secondA, secondB])).toEqual([
      success('a'), success('b'), success('a'), success('b'),
    ])
    await cache.get('b')
    expect(api.get).toHaveBeenCalledTimes(2)
    await cache.get('a')
    expect(api.get).toHaveBeenCalledTimes(3)
  })
})
