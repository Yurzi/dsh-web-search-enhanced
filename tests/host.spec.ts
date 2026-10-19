/**
 * The plugin inside a real DSH composition: Cordis, WebRuntime, the JSON
 * storage domain, Typert registry and Gateway, Session Controller, ToolRuntime
 * with dsh-tool-web, and a PTC substrate. No LLM loop or network: model
 * requests are driven through `agent/request` and tool calls run under an
 * initiator boundary, as the agent loop does. Credentials, transport, the
 * Agent directory and projections are fixtures.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import ToolRuntime, { type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import type { PeerId, PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSearch } from '../src/host/runtime.ts'
import type { SelectionView } from '../src/remote-contract.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { V2Config } from '../src/settings/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const SECRET = 'fixture-secret-not-a-key'
const sid = (id: string) => id as SessionId
const endpoint = (name: string) => ({ kind: 'structured', label: name.toUpperCase(), adapter: 'exa', credentialRef: `KEY_${name.toUpperCase()}`, endpoint: `https://${name}.invalid/search`, trustedEndpoint: true } as const)
const CONFIG: V2Config = { version: 2, defaultConnection: 'custom:a', connections: { 'custom:a': endpoint('a'), 'custom:b': endpoint('b') } }

/** Replaces only the code substrate; the real PTC transport schedules the SDK binding. */
class FixturePtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test-fixture'
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 30_000 }
  }
  async run(request: PtcRunSpec): Promise<PtcRunResult> {
    const tools = request.bindings.find(binding => binding.global === 'tools')!
    return { logs: [], value: await tools.functions.web_search!({ queries: ['ptc one', 'ptc two'] }) }
  }
}

async function host(options: { root?: string; mode?: 'native' | 'ptc'; storage?: boolean; config?: V2Config } = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'search-host-'))
  if (options.root === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => ctx.fiber.dispose())
  new Storage(ctx)
  StorageJson.apply(ctx, { root })
  if (options.storage !== false) await StorageDomain.apply(ctx, { backend: 'json' })
  new WebRuntime(ctx, WebRuntime.Config({ searchProvider: 'enhanced-search' }))
  new TypertRegistry(ctx)
  new Gateway(ctx, {})

  const agents = new Map<string, Agent>()
  const initiator = new AsyncLocalStorage<Agent>()
  const addAgent = (id: string, session = Session.create(sid(id)), agentOptions: Record<string, unknown> = {}) => {
    const agent = { id, session, options: agentOptions } as unknown as Agent
    const scope = createScope(ctx, agent)
    cleanups.push(() => scope.dispose())
    Object.assign(agent, { ctx: scope.ctx })
    agents.set(id, agent)
    return agent
  }
  for (const id of ['one', 'two']) addAgent(id)
  addAgent('child', Session.create(sid('child'), [], { ...Session.create(sid('child')).header, origin: 'subagent' }))
  ctx.provide('agents', { get: (id: string) => agents.get(id), isOwnedBy: () => false, currentInitiator: () => initiator.getStore() } as never)
  ctx.provide('sessions', { get: (id: string) => agents.get(id)?.session } as never)
  ctx.provide('fileUploads', { registerAgentResolver: () => () => {} } as never)
  ctx.provide('sessionProjections', { register: () => () => {}, onChanged: () => () => {}, stateOf: () => undefined } as never)
  ctx.provide('workingDirectory', { ensure: async () => process.cwd(), get: () => process.cwd() } as never)
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 } as never)
  const controller = new SessionController(ctx, { nativeOpen: false })
  const authorize = vi.spyOn(controller, 'resolveAgent') // calls through: the host's ownership policy stays real
  const credentials = {
    describe: vi.fn(async () => ({ configured: true })),
    resolve: vi.fn(async (_ref: unknown): Promise<{ value: string } | undefined> => ({ value: SECRET })),
  }
  ctx.provide('credentials', credentials as never)
  new FixturePtcRuntime(ctx)
  new ToolRuntime(ctx, { mode: options.mode ?? 'native' })
  await ctx.plugin(ToolWeb, { search: true, fetch: false }).await()

  let settings = resolveSettings(options.config ?? CONFIG)
  const plugin = ctx.plugin({ name: 'web-search-enhanced', inject: ['web'], apply: (pluginCtx: Context) => { installSearch(pluginCtx, () => settings) } })
  await plugin.await()
  await vi.waitFor(() => expect(ctx.get('searchConnections')).toBeDefined())

  const peer: PeerScope = { id: 'test-owner' as PeerId, ctx, principal: { kind: 'owner' }, interactions: 'answer', signal: new AbortController().signal, dispose: async () => {} }
  const invoke = (method: 'get' | 'set', request: Record<string, unknown>) =>
    ctx.typertGateway.invoke({ peer, namespace: 'searchConnections', method, args: { request } }) as Promise<SelectionView>
  /** Start model request `step` of turn 1 for an Agent, as the agent loop does. */
  const request = async (id = 'one', step = 0) => {
    const next = vi.fn(async () => ({ provider: 'p', model: 'm' }))
    await expect(ctx.waterfall('agent/request', { agent: agents.get(id)!, turn: 1, step, signal: new AbortController().signal } as never, next as never))
      .resolves.toEqual({ provider: 'p', model: 'm' })
    expect(next).toHaveBeenCalledOnce()
  }
  let calls = 0
  /** Run a tool call of an Agent under its initiator boundary. */
  const execute = (id: string, name = 'web_search', args: unknown = { queries: ['query'] }, signal = new AbortController().signal) => {
    const agent = agents.get(id)!
    return initiator.run(agent, () => ctx.tools.execute({ callId: String(++calls), name, arguments: args, signal, agent } as ToolExecutionInput))
  }
  const commit = (id: string, provider: string, model: string) => {
    const session = agents.get(id)!.session
    session.append('request/header', { reason: session.requestHeader() === undefined ? 'initial' : 'change', header: { config: { provider, model } } })
    session.append('request/context', { provider, model })
  }
  return {
    ctx, root, agents, addAgent, invoke, request, execute, commit, authorize, credentials,
    configure: (next: V2Config) => { settings = resolveSettings(next) },
    unload: () => plugin.dispose(),
  }
}

/** Exa-shaped replies that echo the query; the request URL tells which connection served it. */
function exaTransport() {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body)) as { query: string }
    return Response.json({ results: [{ url: `https://results.invalid/${encodeURIComponent(query)}`, title: query, text: 'fixture evidence' }] })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const urls = (fetch: ReturnType<typeof exaTransport>) => fetch.mock.calls.map(([url]) => String(url))
const maxAge = (fetch: ReturnType<typeof exaTransport>) => fetch.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { contents: { maxAgeHours?: number } }).contents.maxAgeHours)

describe('searchConnections Remote', () => {
  it('serves the session view through the Gateway under Session Controller authorization', async () => {
    const h = await host()
    const view = await h.invoke('get', { sessionId: 'one' })
    expect(view.selection).toEqual({ connectionId: 'custom:a', freshness: 'auto', revision: 0 })
    expect(view.connections.find(c => c.id === 'builtin:exa')).toEqual({ id: 'builtin:exa', label: 'Exa', kind: 'structured', access: 'keyless', status: 'ready', freshness: false })
    expect(view.connections.find(c => c.id === 'builtin:firecrawl')).toMatchObject({ access: 'keyless', freshness: true })
    expect(view.connections.find(c => c.id === 'custom:a')).toMatchObject({ access: 'api-key', credentialRef: 'KEY_A', status: 'ready', freshness: true })
    expect(view.connections.find(c => c.id === 'builtin:session-model')).toMatchObject({ status: 'unsupported', detail: expect.any(String) })
    expect(h.authorize).toHaveBeenCalledWith('one')
    await expect(h.invoke('get', { sessionId: 'child' })).rejects.toMatchObject({ code: expect.stringMatching(/^session\//u) })
  })

  it('rejects malformed requests before authorizing them', async () => {
    const h = await host()
    for (const request of [{ sessionId: 'one', extra: true }, { sessionId: 'one', expectedRevision: 0 }, { sessionId: 'one', freshness: 'hourly', expectedRevision: 0 }, { sessionId: 'one', connectionId: 'custom:b', expectedRevision: -1 }]) {
      await expect(h.invoke('set', request)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    }
    expect(h.authorize).not.toHaveBeenCalled()
  })

  it('changes the selection with compare-and-set and persists it', async () => {
    const h = await host()
    await h.invoke('get', { sessionId: 'one' })
    await expect(h.invoke('set', { sessionId: 'one', connectionId: 'custom:gone', expectedRevision: 0 })).rejects.toMatchObject({ code: 'searchConnections/unavailable', details: { connectionId: 'custom:gone' } })
    const results = await Promise.allSettled([
      h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', expectedRevision: 0 }),
      h.invoke('set', { sessionId: 'one', freshness: 'realtime', expectedRevision: 0 }),
    ])
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'searchConnections/conflict' } }])
    const saved = (await h.invoke('get', { sessionId: 'one' })).selection
    expect(saved.revision).toBe(1)
    // A freshness-only change keeps a connection that has since been removed.
    h.configure({ version: 2 })
    expect((await h.invoke('set', { sessionId: 'one', freshness: 'fresh', expectedRevision: 1 })).selection).toMatchObject({ freshness: 'fresh', revision: 2 })
    h.ctx.emit('session/disposed', h.agents.get('one')!.session) // not a deletion
    await h.ctx.fiber.dispose()
    const reopened = await host({ root: h.root })
    expect((await reopened.invoke('get', { sessionId: 'one' })).selection).toEqual({ ...saved, freshness: 'fresh', revision: 2 })
    expect((await reopened.invoke('get', { sessionId: 'two' })).selection).toEqual({ connectionId: 'custom:a', freshness: 'auto', revision: 0 })
  })
})

describe('search through web_search', () => {
  it('freezes the target of each step and keeps sessions independent', async () => {
    const fetch = exaTransport()
    const h = await host()
    await h.request('one')
    await h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', freshness: 'realtime', expectedRevision: 0 })
    h.configure({ ...CONFIG, freshness: 'realtime' })
    await h.request('one') // a retry of the same step keeps its target
    const first = await h.execute('one', 'web_search', { queries: ['alpha', 'beta'] })
    expect(first.isError).toBe(false)
    expect(urls(fetch)).toEqual(['https://a.invalid/search', 'https://a.invalid/search'])
    expect(maxAge(fetch)).toEqual([undefined, undefined])
    expect(JSON.stringify(first)).toContain('alpha')
    expect(JSON.stringify(first)).not.toContain(SECRET)

    await Promise.all([h.request('one', 1), h.request('two', 1)])
    await Promise.all([h.execute('one'), h.execute('two')])
    expect(urls(fetch).slice(2).sort()).toEqual(['https://a.invalid/search', 'https://b.invalid/search'])
    expect(fetch.mock.calls.slice(2).map(([url, init]) => [String(url), (JSON.parse(String(init?.body)) as { contents: { maxAgeHours?: number } }).contents.maxAgeHours]).sort())
      .toEqual([['https://a.invalid/search', 0], ['https://b.invalid/search', 0]])
    expect(h.credentials.resolve.mock.calls.map(([ref]) => String(ref)).sort()).toEqual(['KEY_A', 'KEY_A', 'KEY_A', 'KEY_B'])

    h.ctx.emit('agent/disposed', { agent: h.agents.get('one')! } as never)
    expect((await h.execute('one')).isError).toBe(true)
  })

  it("runs code-mode searches with the step's target", async () => {
    const fetch = exaTransport()
    const h = await host({ mode: 'ptc' })
    await h.request('one')
    await h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', expectedRevision: 0 })
    expect((await h.execute('one')).isError).toBe(true) // the native surface is collapsed in code mode
    const result = await h.execute('one', 'run_code', { code: 'return await tools.web_search({ queries: ["ptc one", "ptc two"] })', description: 'Search fixture queries' })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('ptc one')
    expect(urls(fetch)).toEqual(['https://a.invalid/search', 'https://a.invalid/search'])
    const events = h.agents.get('one')!.session.snapshotEvents()
    expect(events.filter(event => event.type === 'tool/ptc-dispatch')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain(SECRET)
  })

  it("hides web_search while the session's search is off", async () => {
    exaTransport()
    const h = await host()
    const agent = h.agents.get('one')!
    const visible = () => h.ctx.tools.schemas(agent).some(tool => tool.name === 'web_search')
    await h.invoke('get', { sessionId: 'one' })
    expect(visible()).toBe(true)
    await h.invoke('set', { sessionId: 'one', connectionId: null, expectedRevision: 0 })
    expect(visible()).toBe(false)
    expect(h.ctx.tools.get('web_search', agent)).toBeUndefined()
    await h.request('one')
    expect((await h.execute('one')).isError).toBe(true)
    await h.invoke('set', { sessionId: 'one', connectionId: 'custom:b', expectedRevision: 1 })
    expect(visible()).toBe(true)
    await h.invoke('set', { sessionId: 'one', connectionId: null, expectedRevision: 2 })
    await h.unload() // unloading the plugin never leaves the tool denied
    expect(visible()).toBe(true)
  })

  it('cancels every in-flight query and serves the next request', async () => {
    const h = await host()
    await h.request('one')
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signals.push(init!.signal!)
      init!.signal!.addEventListener('abort', () => { reject(new DOMException('cancelled', 'AbortError')) }, { once: true })
    })))
    const abort = new AbortController()
    const pending = h.execute('one', 'web_search', { queries: ['first', 'second'] }, abort.signal)
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    abort.abort()
    expect((await pending).isError).toBe(true)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    exaTransport()
    await h.request('one', 1)
    expect((await h.execute('one')).isError).toBe(false)
  })

  it('keeps chat running when the selection cannot be read, and recovers on retry', async () => {
    const fetch = exaTransport()
    const h = await host({ storage: false })
    await h.request('one')
    const failed = await h.execute('one')
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).toContain('WEB_SEARCH_STORAGE_UNAVAILABLE')
    expect(fetch).not.toHaveBeenCalled()
    await StorageDomain.apply(h.ctx, { backend: 'json' })
    await h.request('one') // the same step captures again after a failure
    expect((await h.execute('one')).isError).toBe(false)
  })

  it('applies a stored Off before Agent creation completes', async () => {
    const first = await host()
    await first.invoke('get', { sessionId: 'one' })
    await first.invoke('set', { sessionId: 'one', connectionId: null, expectedRevision: 0 })
    await first.ctx.fiber.dispose()
    const h = await host({ root: first.root })
    const open = h.ctx.storageDomain.open.bind(h.ctx.storageDomain)
    vi.spyOn(h.ctx.storageDomain, 'open').mockImplementation(async spec => {
      await new Promise(resolve => setTimeout(resolve, 20)) // slow storage
      return open(spec)
    })
    const agent = h.agents.get('one')!
    await h.ctx.serial('agent/created', { agent, source: 'resume' } as never)
    expect(h.ctx.tools.schemas(agent).some(tool => tool.name === 'web_search')).toBe(false)
  })

  it('refuses searches outside a model request', async () => {
    const h = await host()
    await expect(h.ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_SEARCH_CONTEXT_UNAVAILABLE' })
  })
})

describe('session-dependent routes', () => {
  /** Two pi-ai-style routes in a renamed settings namespace. */
  function models(h: Awaited<ReturnType<typeof host>>) {
    const providers: Record<string, Record<string, unknown>> = {
      first: { api: 'anthropic-messages', baseURL: 'https://first.invalid/v1', apiKeyEnv: 'FIRST_API' },
      second: { api: 'openai-responses', baseURL: 'https://second.invalid/v1', apiKeyEnv: 'SECOND_API' },
    }
    h.ctx.provide('settings', { describe: () => [{ ns: 'renamed-models', value: { providers } }] } as never)
    h.ctx.provide('llm', {
      listConfigurableProviders: () => Object.keys(providers).map(provider => ({ provider, displayName: provider, settingsNs: 'renamed-models', settingsPath: ['providers', provider] })),
    } as never)
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
      content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://source.invalid/' }] }],
      output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://source.invalid/' }] } }],
    }))
    vi.stubGlobal('fetch', fetch)
    return { providers, fetch }
  }

  it("searches with the route of each session's committed model", async () => {
    const h = await host({ config: { version: 2, defaultConnection: 'builtin:session-model', connections: { 'builtin:session-model': { optionsByProtocol: { 'anthropic-messages': { toolIdentifier: 'web_search_20990101' } } } } } })
    const { fetch } = models(h)
    await Promise.all([h.request('one'), h.request('two')])
    h.commit('one', 'first', 'model-one')
    h.commit('two', 'second', 'model-two')
    const view = await h.invoke('get', { sessionId: 'one' })
    expect(view.connections.find(c => c.id === 'builtin:session-model')).toMatchObject({ access: 'api-key', credentialRef: 'FIRST_API', status: 'ready' })
    const results = await Promise.all([h.execute('one'), h.execute('two')])
    expect(results.every(result => !result.isError)).toBe(true)
    const sent = fetch.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) as { model: string; tools: { type: string }[] }, headers: new Headers(init?.headers) }))
    const one = sent.find(call => call.body.model === 'model-one')!
    expect(one).toMatchObject({ url: 'https://first.invalid/v1/messages', body: { tools: [{ type: 'web_search_20990101' }] } })
    expect(one.headers.get('x-api-key')).toBe(SECRET)
    expect(sent.find(call => call.body.model === 'model-two')).toMatchObject({ url: 'https://second.invalid/v1/responses', body: { tools: [{ type: 'web_search' }] } })
    expect(h.credentials.resolve.mock.calls.map(([ref]) => String(ref)).sort()).toEqual(['FIRST_API', 'SECOND_API'])
    expect(JSON.stringify(results)).not.toContain(SECRET)
  })

  it('refuses a route it cannot prove instead of borrowing another key', async () => {
    const h = await host({ config: { version: 2, defaultConnection: 'builtin:session-model' } })
    const { providers, fetch } = models(h)
    delete providers.first!.apiKeyEnv
    await h.request('one')
    h.commit('one', 'first', 'model-one')
    const result = await h.execute('one')
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('WEB_SEARCH_FOLLOW_UNSUPPORTED')
    expect(fetch).not.toHaveBeenCalled()
    expect(h.credentials.resolve).not.toHaveBeenCalled()
  })

  it("keeps a step's route when the provider profile changes mid-step", async () => {
    const h = await host({ config: { version: 2, defaultConnection: 'builtin:session-model' } })
    const { providers, fetch } = models(h)
    await h.request('one')
    h.commit('one', 'first', 'model-one')
    await h.execute('one')
    providers.first = { api: 'openai-responses', baseURL: 'https://changed.invalid/v1', apiKeyEnv: 'CHANGED_API' }
    await h.execute('one')
    await h.request('one', 1)
    await h.execute('one')
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://first.invalid/v1/messages', 'https://first.invalid/v1/messages', 'https://changed.invalid/v1/responses'])
    expect(h.credentials.resolve.mock.calls.map(([ref]) => String(ref))).toEqual(['FIRST_API', 'FIRST_API', 'CHANGED_API'])
  })

  it('searches DeepSeek with the account sign-in on the account route', async () => {
    const h = await host({ config: { version: 2, defaultConnection: 'builtin:deepseek' } })
    const resolveToken = vi.fn(async (url: string) => url.startsWith('https://api.deepseek.com/') ? 'fixture-account-token' : undefined)
    h.ctx.provide('deepseekAccount', { resolveToken } as never)
    h.credentials.describe.mockResolvedValue({ configured: false })
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ results: [{ url: 'https://deepseek.invalid/', title: 'T', snippet: 'S', date: null }] }))
    vi.stubGlobal('fetch', fetch)
    const signedIn = h.addAgent('signed-in', Session.create(sid('signed-in')), { provider: 'deepseek-account', model: 'deepseek-chat' })
    const view = await h.invoke('get', { sessionId: signedIn.session.id })
    expect(view.connections.find(c => c.id === 'builtin:deepseek')).toMatchObject({ access: 'account', status: 'ready' })
    expect((await h.invoke('get', { sessionId: 'one' })).connections.find(c => c.id === 'builtin:deepseek')).toMatchObject({ access: 'api-key', status: 'needs-credential' })
    await h.request('signed-in')
    h.commit('signed-in', 'deepseek-account', 'deepseek-chat')
    expect((await h.execute('signed-in')).isError).toBe(false)
    const headers = new Headers(fetch.mock.calls[0]![1]!.headers)
    expect(fetch.mock.calls[0]![0]).toBe('https://api.deepseek.com/v1/tools/search')
    expect(headers.get('x-dsh-auth-token')).toBe('fixture-account-token')
    expect(headers.has('authorization')).toBe(false)
    expect(h.credentials.resolve).not.toHaveBeenCalled()
  })
})