/** Host contract tests: real Cordis, Web, JSON Domain, Gateway, SessionController and Tools.
 * No HTTP server or LLM loop: request events are driven explicitly. Credentials,
 * transport, Agent directory/projections and the code execution substrate are fixtures.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WebRuntime from '@deepseek-ai/dsh-web'
import ToolRuntime, { type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CodeRuntime, type CodeRunRequest, type CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBridge } from '../src/dsh/bridge.ts'
import { resolveSettings, type V2Config } from '../src/config.ts'
import type { SelectionView } from '../src/remote-contract.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  try { for (const cleanup of cleanups.reverse()) await cleanup() }
  finally { cleanups.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
const sid = (id: string) => id as SessionId
const config: V2Config = { version: 2, defaultConnection: 'custom:a', connections: {
  'custom:a': { kind: 'structured', label: 'A', adapter: 'exa', credentialRef: 'TEST_A', endpoint: 'https://a.invalid/search', trustedEndpoint: true },
  'custom:b': { kind: 'structured', label: 'B', adapter: 'exa', credentialRef: 'TEST_B', endpoint: 'https://b.invalid/search', trustedEndpoint: true },
} }

// The real PTC transport supplies and schedules the SDK binding. This deliberately
// replaces ONLY the code substrate, not tools.execute or the PTC sub-dispatch path.
class FixtureCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test-fixture'
  requests: CodeRunRequest[] = []
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    this.requests.push(request)
    const tools = request.bindings.find(binding => binding.global === 'tools')!
    return { logs: [], value: await tools.functions.web_search!({ queries: ['ptc one', 'ptc two'] }) }
  }
}
async function host(root?: string, mode: 'native' | 'ptc' = 'native') {
  if (!root) {
    root = await mkdtemp(join(tmpdir(), 'search-host-test-'))
    const dir = root
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
  }
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  new Storage(ctx)
  StorageJson.apply(ctx, { root })
  await StorageDomain.apply(ctx, { backend: 'json' })
  new WebRuntime(ctx, { searchProvider: 'enhanced-search' })
  new TypertRegistry(ctx)
  new Gateway(ctx, {})
  // Real Session objects record PTC events; lightweight Agent identities avoid an LLM.
  const agents = new Map<string, Agent>()
  for (const id of ['one', 'two', 'child']) {
    const base = Session.create(sid(id))
    const session = id === 'child' ? Session.create(sid(id), [], { ...base.header, origin: 'subagent' }) : base
    agents.set(id, { id, ctx, session } as unknown as Agent)
  }
  ctx.provide('agents', { get: (id: string) => agents.get(id), isOwnedBy: () => false } as never)
  ctx.provide('sessions', { get: (id: string) => agents.get(id)?.session } as never)
  ctx.provide('fileUploads', { registerAgentResolver: () => () => {} } as never)
  ctx.provide('sessionProjections', { register: () => () => {}, onChanged: () => () => {} } as never)
  const controller = new SessionController(ctx, { nativeOpen: false })
  const authorize = vi.spyOn(controller, 'resolveAgent') // call-through: host ownership policy remains real
  const credentials = { describe: vi.fn(async () => ({ configured: true })), resolve: vi.fn(async () => ({ value: 'fixture-secret-not-a-key' })) }
  ctx.provide('credentials', credentials as never)
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 } as never)
  const substrate = new FixtureCodeRuntime(ctx)
  new ToolRuntime(ctx, { mode })
  await ctx.plugin(ToolWeb, { search: true, fetch: false }).await()
  let settings = resolveSettings(config)
  const bridge = installBridge(ctx, () => settings)
  await vi.waitFor(() => expect(ctx.get('searchConnections')).toBeDefined())
  await bridge.runtime.selections()
  const invoke = (method: 'get' | 'set', request: Record<string, unknown>) => ctx.typertGateway.invoke({ namespace: 'searchConnections', method, args: { request } }) as Promise<SelectionView>
  const capture = async (id = 'one', step = 0) => {
    const payload = { agent: agents.get(id)!, turn: 1, step, signal: new AbortController().signal }
    const next = vi.fn(async () => ({ marker: 'unchanged inference result' }))
    const result = await ctx.waterfall('agent/request', payload as never, next as never)
    expect(result).toEqual({ marker: 'unchanged inference result' })
    expect(next).toHaveBeenCalledOnce()
  }
  let call = 0
  const execute = (id: string, name = 'web_search', args: unknown = { queries: ['query'] }, signal = new AbortController().signal) => ctx.tools.execute({ callId: String(++call), name, arguments: args, signal, agent: agents.get(id)! } as ToolExecutionInput)
  return { ctx, root, agents, bridge, invoke, capture, execute, authorize, credentials, substrate,
    changeSettings: (value: V2Config) => { settings = resolveSettings(value) } }
}
function successTransport() {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ results: [{ url: 'https://results.invalid/' + encodeURIComponent(body.query), title: body.query, text: 'fixture evidence' }] }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('V2 installed DSH host integration (no network)', () => {
  it('discovers source @Remote methods, delegates authorization, isolates sessions and persists CAS across reopen', async () => {
    successTransport()
    const h = await host()
    expect(h.ctx.typert.local.get('searchConnections/get')).toBeUndefined() // no generated descriptor crutch
    expect(await h.invoke('get', { sessionId: 'one' })).toMatchObject({ selection: { connectionId: 'custom:a', revision: 0 } })
    expect(h.authorize).toHaveBeenCalledWith('one')
    const authorizedCount = h.authorize.mock.calls.length
    await expect(h.invoke('get', { sessionId: 'one', unexpected: true })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', expectedRevision: -1 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(h.authorize).toHaveBeenCalledTimes(authorizedCount)
    await expect(h.invoke('get', { sessionId: 'child' })).rejects.toMatchObject({ code: 'session/agent-busy' })
    await expect(h.invoke('set', { sessionId: 'child', connectionId: 'custom:b', expectedRevision: 0 })).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect(h.authorize).toHaveBeenCalledWith('child')
    const results = await Promise.allSettled([
      h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', expectedRevision: 0 }),
      h.invoke('set', { sessionId: 'one', connectionId: null, expectedRevision: 0 }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    const saved = (await h.invoke('get', { sessionId: 'one' })).selection
    expect(saved.revision).toBe(1)
    expect((await h.invoke('get', { sessionId: 'two' })).selection).toEqual({ connectionId: 'custom:a', revision: 0 })
    h.ctx.emit('session/disposed', h.agents.get('one')!.session)
    expect((await h.invoke('get', { sessionId: 'one' })).selection).toEqual(saved)
    await h.ctx.fiber.dispose()
    const reopened = await host(h.root)
    expect((await reopened.invoke('get', { sessionId: 'one' })).selection).toEqual(saved)
    expect((await reopened.invoke('get', { sessionId: 'two' })).selection).toEqual({ connectionId: 'custom:a', revision: 0 })
    await expect(reopened.invoke('set', { sessionId: 'one', connectionId: 'custom:a', expectedRevision: 0 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('runs real native multiquery dispatch with an immutable same-step route and independent session snapshots', async () => {
    const fetch = successTransport()
    const h = await host()
    await h.capture('one')
    const frozen = h.bridge.contexts.peek(h.agents.get('one')!)!
    expect(Object.isFrozen(frozen.connection?.options)).toBe(true)
    await h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', expectedRevision: 0 })
    h.changeSettings({ ...config, freshness: 'realtime' })
    await h.capture('one') // retry/reassembly of the SAME step must retain the snapshot
    expect(h.bridge.contexts.peek(h.agents.get('one')!)).toBe(frozen)
    const first = await h.execute('one', 'web_search', { queries: ['alpha', 'beta'] })
    expect(first.isError).toBe(false)
    expect(fetch.mock.calls.map(c => String(c[0]))).toEqual(['https://a.invalid/search', 'https://a.invalid/search'])
    expect(fetch.mock.calls.map(c => JSON.parse(String(c[1]?.body)).contents.maxAgeHours)).toEqual([undefined, undefined])
    await h.capture('one', 1)
    await h.capture('two', 1)
    await Promise.all([h.execute('one'), h.execute('two')])
    expect(fetch.mock.calls.slice(2).map(c => String(c[0])).sort()).toEqual(['https://a.invalid/search', 'https://b.invalid/search'])
    expect(fetch.mock.calls.slice(2).map(c => JSON.parse(String(c[1]?.body)).contents.maxAgeHours)).toEqual([0, 0])
    expect(JSON.stringify(first)).not.toContain('fixture-secret-not-a-key')
    expect(h.bridge.diagnostics()).toHaveLength(4)
    expect(h.bridge.diagnostics()[2]).toMatchObject({requested:'realtime',freshnessVerified:false})
    expect(JSON.stringify(h.bridge.diagnostics())).not.toContain('alpha')
    expect(JSON.stringify(h.bridge.diagnostics())).not.toContain('fixture-secret-not-a-key')
    h.ctx.emit('agent/disposed', { agent: h.agents.get('one')! } as never)
    expect(h.bridge.contexts.peek(h.agents.get('one')!)).toBeUndefined()
    expect((await h.execute('one')).isError).toBe(true)
  })

  it('routes real PTC SDK sub-dispatches through the same frozen search snapshot', async () => {
    const fetch = successTransport()
    const h = await host(undefined, 'ptc')
    await h.capture()
    expect((await h.execute('one')).isError).toBe(true) // native surface is collapsed
    expect(fetch).not.toHaveBeenCalled()
    await h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', expectedRevision: 0 })
    const result = await h.execute('one', 'run_code', { code: 'return await tools.web_search({ queries: ["ptc one", "ptc two"] })', description: 'Search fixture queries' })
    expect(result.isError).toBe(false)
    expect(h.substrate.requests).toHaveLength(1)
    expect(fetch.mock.calls.map(c => String(c[0]))).toEqual(['https://a.invalid/search', 'https://a.invalid/search'])
    expect(JSON.stringify(result)).toContain('ptc one')
    const events = h.agents.get('one')!.session.snapshotEvents()
    expect(events.filter(event => event.type === 'tool/ptc-dispatch-start')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool/ptc-dispatch')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('fixture-secret-not-a-key')
  })

  it('propagates cancellation to all in-flight query transports and permits the next request', async () => {
    const h = await host()
    await h.capture()
    const signals: AbortSignal[] = []
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new DOMException('fixture cancelled', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const abort = new AbortController()
    const pending = h.execute('one', 'web_search', { queries: ['first', 'second'] }, abort.signal)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    abort.abort()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('fixture-secret-not-a-key')
    successTransport()
    await h.capture('one', 1)
    expect((await h.execute('one')).isError).toBe(false)
  })
})
