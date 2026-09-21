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
import { z } from 'zod'
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
async function host(root?: string, mode: 'native' | 'ptc' = 'native', deferStorage = false, legacy = false) {
  if (!root) {
    root = await mkdtemp(join(tmpdir(), 'search-host-test-'))
    const dir = root
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
  }
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  new Storage(ctx)
  StorageJson.apply(ctx, { root })
  if (!deferStorage) await StorageDomain.apply(ctx, { backend: 'json' })
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
  const credentials = { describe: vi.fn(async () => ({ configured: true })), resolve: vi.fn(async (_ref: unknown): Promise<{ value: string } | undefined> => ({ value: 'fixture-secret-not-a-key' })) }
  ctx.provide('credentials', credentials as never)
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 } as never)
  const substrate = new FixtureCodeRuntime(ctx)
  new ToolRuntime(ctx, { mode })
  await ctx.plugin(ToolWeb, { search: true, fetch: false }).await()
  if (legacy) {
    const oldDomain = StorageDomain.defineDomain({ name: 'web_search_enhanced', version: 1, tables: {
      selections: StorageDomain.domainTable(z.object({connectionId:z.string().nullable(),revision:z.number().int().nonnegative()}).strict()),
    } })
    const old = await ctx.storageDomain.open(oldDomain)
    await old.table('selections').put('one',{connectionId:null,revision:5})
    await old.close()
  }
  let settings = resolveSettings(config)
  const bridge = installBridge(ctx, () => settings)
  await vi.waitFor(() => expect(ctx.get('searchConnections')).toBeDefined())
  if (!deferStorage) await bridge.runtime.selections()
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
  it('persists session freshness independently, preserves it across switches and freezes the current request', async () => {
    const fetch = successTransport(), h = await host()
    await Promise.all([h.capture('one'),h.capture('two')])
    const frozen = h.bridge.contexts.peek(h.agents.get('one')!)!
    expect(await h.invoke('set',{sessionId:'one',freshness:'realtime',expectedRevision:0})).toMatchObject({freshness:'realtime',selection:{connectionId:'custom:a',freshness:'realtime',revision:1}})
    await h.capture('one')
    expect(h.bridge.contexts.peek(h.agents.get('one')!)).toBe(frozen)
    await h.execute('one')
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).contents.maxAgeHours).toBeUndefined()
    await expect(h.invoke('set',{sessionId:'one',connectionId:'custom:b',expectedRevision:0})).rejects.toMatchObject({code:'gateway/bad-request'})
    expect(await h.invoke('set',{sessionId:'one',connectionId:'custom:b',expectedRevision:1})).toMatchObject({freshness:'realtime',selection:{revision:2}})
    await expect(h.invoke('set',{sessionId:'one',freshness:'fresh',expectedRevision:1})).rejects.toMatchObject({code:'gateway/bad-request'})
    h.changeSettings({...config,freshness:'fresh'})
    await Promise.all([h.capture('one',1),h.capture('two',1)])
    await Promise.all([h.execute('one'),h.execute('two')])
    expect(fetch.mock.calls.slice(1).map(c=>JSON.parse(String(c[1]?.body)).contents.maxAgeHours)).toEqual([0,undefined])
    expect(await h.invoke('get',{sessionId:'two'})).toMatchObject({freshness:'auto',selection:{revision:0}})
    await h.ctx.fiber.dispose()
    const reopened = await host(h.root)
    expect(await reopened.invoke('get',{sessionId:'one'})).toMatchObject({freshness:'realtime',selection:{connectionId:'custom:b',revision:2}})
    expect(await reopened.invoke('get',{sessionId:'two'})).toMatchObject({freshness:'auto'})
  })
  it('opens old schema records without destructive migration and materializes the default durably', async () => {
    const h = await host(undefined,'native',false,true)
    h.changeSettings({...config,freshness:'fresh'})
    expect(await h.invoke('get',{sessionId:'one'})).toMatchObject({freshness:'fresh',selection:{connectionId:null,revision:5,freshness:'fresh'}})
    h.changeSettings({...config,freshness:'realtime'})
    expect(await h.invoke('get',{sessionId:'one'})).toMatchObject({freshness:'fresh'})
    expect(await h.invoke('get',{sessionId:'two'})).toMatchObject({freshness:'realtime'})
    await h.ctx.fiber.dispose()
    const reopened = await host(h.root)
    expect(await reopened.invoke('get',{sessionId:'one'})).toMatchObject({freshness:'fresh',selection:{connectionId:null,revision:5}})
    expect(await reopened.invoke('set',{sessionId:'one',freshness:'auto',expectedRevision:5})).toMatchObject({freshness:'auto',selection:{connectionId:null,revision:6}})
  })
  it('inherits both session values for seeded forks and keeps subsequent edits independent', async () => {
    const h = await host()
    await h.invoke('set',{sessionId:'one',connectionId:null,freshness:'realtime',expectedRevision:0})
    const base = Session.create(sid('fork'))
    const session = Session.create(sid('fork'),[],{...base.header,parentSession:sid('one'),isSeeded:true},base.inheritedEventCount)
    h.agents.set('fork',{id:'fork',ctx:h.ctx,session} as unknown as Agent)
    expect(await h.invoke('get',{sessionId:'fork'})).toMatchObject({freshness:'realtime',selection:{connectionId:null,revision:0}})
    await h.invoke('set',{sessionId:'fork',connectionId:'custom:b',freshness:'fresh',expectedRevision:0})
    await h.invoke('set',{sessionId:'one',freshness:'auto',expectedRevision:1})
    expect(await h.invoke('get',{sessionId:'fork'})).toMatchObject({freshness:'fresh',selection:{connectionId:'custom:b',revision:1}})
    expect(await h.invoke('get',{sessionId:'one'})).toMatchObject({freshness:'auto',selection:{connectionId:null,revision:2}})
  })
  it('rejects invalid partial requests and authorizes freshness-only updates without validating the retained connection', async () => {
    const h = await host()
    await h.invoke('get',{sessionId:'one'})
    const count = h.authorize.mock.calls.length
    for (const patch of [{},{freshness:'bad'},{freshness:null},{freshness:'fresh',extra:true},{connectionId:4},{freshness:'auto',expectedRevision:0.5}]) {
      await expect(h.invoke('set',{sessionId:'one',expectedRevision:0,...patch})).rejects.toMatchObject({code:'gateway/bad-request'})
    }
    expect(h.authorize).toHaveBeenCalledTimes(count)
    await expect(h.invoke('set',{sessionId:'child',freshness:'fresh',expectedRevision:0})).rejects.toMatchObject({code:'session/agent-busy'})
    h.changeSettings({version:2}) // retained custom:a no longer exists
    expect(await h.invoke('set',{sessionId:'one',freshness:'fresh',expectedRevision:0})).toMatchObject({freshness:'fresh',selection:{connectionId:'custom:a',revision:1}})
    await expect(h.invoke('set',{sessionId:'one',connectionId:'custom:a',expectedRevision:1})).rejects.toMatchObject({code:'gateway/bad-request'})
    expect(await h.invoke('set',{sessionId:'one',connectionId:null,expectedRevision:1})).toMatchObject({freshness:'fresh',selection:{connectionId:null,revision:2}})
    expect(await h.invoke('set',{sessionId:'one',freshness:'realtime',expectedRevision:2})).toMatchObject({freshness:'realtime',selection:{connectionId:null,revision:3}})
  })
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
    expect((await h.invoke('get', { sessionId: 'two' })).selection).toEqual({ connectionId: 'custom:a', revision: 0, freshness: 'auto' })
    h.ctx.emit('session/disposed', h.agents.get('one')!.session)
    expect((await h.invoke('get', { sessionId: 'one' })).selection).toEqual(saved)
    await h.ctx.fiber.dispose()
    const reopened = await host(h.root)
    expect((await reopened.invoke('get', { sessionId: 'one' })).selection).toEqual(saved)
    expect((await reopened.invoke('get', { sessionId: 'two' })).selection).toEqual({ connectionId: 'custom:a', revision: 0, freshness: 'auto' })
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
    expect(fetch.mock.calls.slice(2).map(c => JSON.parse(String(c[1]?.body)).contents.maxAgeHours)).toEqual([undefined, 0])
    expect(JSON.stringify(first)).not.toContain('fixture-secret-not-a-key')
    expect(h.bridge.diagnostics()).toHaveLength(4)
    expect(h.bridge.diagnostics()[2]).toMatchObject({requested:'auto',freshnessVerified:false})
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

function header(h: Awaited<ReturnType<typeof host>>, id: string, provider: string, model: string) {
  const session = h.agents.get(id)!.session
  session.append('request/header', { reason:session.requestHeader() ? 'change' : 'initial', header:{config:{provider,model}} })
}
function followFixture(h: Awaited<ReturnType<typeof host>>) {
  const providers: Record<string, {api:string; baseURL:string; apiKeyEnv?:string}> = {
    first:{api:'anthropic-messages',baseURL:'https://first.invalid/v1',apiKeyEnv:'FIRST_API'},
    second:{api:'openai-responses',baseURL:'https://second.invalid/v1',apiKeyEnv:'SECOND_API'},
    third:{api:'openai-completions',baseURL:'https://third.invalid/v1',apiKeyEnv:'THIRD_API'},
  }
  const adapters = new Map(Object.keys(providers).map(id => [id, {}]))
  h.ctx.provide('settings', {get: (ns:string) => ns === 'llm-pi-ai' ? {providers} : undefined} as never)
  h.ctx.provide('llm', {registration: (id:string) => ({adapter:adapters.get(id)})} as never)
  h.changeSettings({version:2,defaultConnection:'builtin:session-model'})
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({
    content:[{type:'web_search_tool_result',content:[{type:'web_search_result',url:'https://source.invalid'}]}],
    output:[{type:'web_search_call',action:{sources:[{url:'https://source.invalid'}]}}],
    choices:[{message:{content:'Evidence',annotations:[{type:'url_citation',url_citation:{url:'https://source.invalid'}}]}}],
  }))
  vi.stubGlobal('fetch',fetcher)
  return {providers,adapters,fetcher}
}
describe('follow-session model through installed DSH tools and remotes', () => {
  it.each(['native','ptc'] as const)('%s uses the committed model, session-specific endpoint and credential for every query',async mode=>{
    const h=await host(undefined,mode), f=followFixture(h)
    Object.assign(h.agents.get('one')!,{options:{provider:'third',model:'stale-model'}})
    await Promise.all([h.capture('one'),h.capture('two')])
    // Actual committed identities become available AFTER agent/request preparation.
    header(h,'one','first','actual-one');header(h,'two','second','actual-two')
    const view=await h.invoke('get',{sessionId:'one'})
    expect(view.connections.find(c=>c.id==='builtin:session-model')).toMatchObject({configured:true,credentialRef:'FIRST_API'})
    const results=await Promise.all(['one','two'].map(id=>h.execute(id,mode==='ptc'?'run_code':'web_search',mode==='ptc'?{code:'return await tools.web_search({queries:["q"]})',description:'fixture'}:{queries:['a','b']})))
    expect(results.every(r=>!r.isError)).toBe(true)
    expect(f.fetcher).toHaveBeenCalledTimes(4)
    for(const [url,init] of f.fetcher.mock.calls){
      const body=JSON.parse(String(init?.body)), reqHeaders=new Headers(init?.headers)
      if(body.model==='actual-one'){expect(url).toBe('https://first.invalid/v1/messages');expect(reqHeaders.get('x-api-key')).toBe('fixture-secret-not-a-key')}
      else {expect(body.model).toBe('actual-two');expect(url).toBe('https://second.invalid/v1/responses')}
    }
    expect(h.credentials.resolve.mock.calls.map(c=>String(c[0])).sort()).toEqual(['FIRST_API','FIRST_API','SECOND_API','SECOND_API'])
    expect(JSON.stringify(results)).not.toContain('fixture-secret-not-a-key')
  })
  it('retains old settings across same-step retries, accepts later actual model changes, and samples the next step',async()=>{
    const h=await host(), f=followFixture(h)
    await h.capture(); header(h,'one','first','m1')
    f.providers.first={api:'openai-responses',baseURL:'https://changed.invalid/v1',apiKeyEnv:'CHANGED_API'}
    await h.capture() // same step cannot resample new settings
    expect((await h.execute('one')).isError).toBe(false)
    expect(f.fetcher.mock.calls[0]?.[0]).toBe('https://first.invalid/v1/messages')
    header(h,'one','third','m3') // host routing change uses a different cached binding key
    expect((await h.execute('one')).isError).toBe(false)
    expect(f.fetcher.mock.calls[1]?.[0]).toBe('https://third.invalid/v1/chat/completions')
    await h.capture('one',1); header(h,'one','first','m1')
    expect((await h.execute('one')).isError).toBe(false)
    expect(f.fetcher.mock.calls[2]?.[0]).toBe('https://changed.invalid/v1/responses')
    expect(h.credentials.resolve.mock.calls.map(c=>String(c[0]))).toEqual(['FIRST_API','THIRD_API','CHANGED_API'])
  })
  it('refuses unknown routes and missing/revoked credentials without fallback or cross-route key use',async()=>{
    const h=await host(), f=followFixture(h)
    delete f.providers.first!.apiKeyEnv
    header(h,'one','first','m1');await h.capture()
    const missing=await h.execute('one')
    expect(missing.isError).toBe(true);expect(f.fetcher).not.toHaveBeenCalled();expect(h.credentials.resolve).not.toHaveBeenCalled()
    header(h,'one','second','m2')
    h.credentials.resolve.mockResolvedValue(undefined)
    const revoked=await h.execute('one');expect(revoked.isError).toBe(true);expect(f.fetcher).not.toHaveBeenCalled()
    expect(h.credentials.resolve.mock.calls.map(c=>String(c[0]))).toEqual(['SECOND_API'])
    header(h,'one','subscription-route','m')
    expect((await h.execute('one')).isError).toBe(true);expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('isolates per-protocol options and cancels unresolved follow credentials without sending HTTP',async()=>{
    const h=await host(), f=followFixture(h)
    h.changeSettings({version:2,defaultConnection:'builtin:session-model',connections:{'builtin:session-model':{optionsByProtocol:{'anthropic-messages':{toolIdentifier:'web_search_20990101'},'openai-responses':{toolIdentifier:'web_search'}}}}})
    await h.capture();header(h,'one','first','m1')
    expect((await h.execute('one')).isError).toBe(false)
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body)).tools[0].type).toBe('web_search_20990101')
    header(h,'one','second','m2')
    expect((await h.execute('one')).isError).toBe(false)
    expect(JSON.parse(String(f.fetcher.mock.calls[1]?.[1]?.body)).tools[0].type).toBe('web_search')
    h.credentials.resolve.mockImplementation(()=>new Promise(()=>{}))
    const abort=new AbortController()
    const pending=h.execute('one','web_search',{queries:['q1','q2']},abort.signal)
    await vi.waitFor(()=>expect(h.credentials.resolve).toHaveBeenCalledTimes(4))
    abort.abort('sensitive-abort-reason')
    const result=await pending
    expect(result.isError).toBe(true);expect(f.fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(result)).not.toContain('sensitive-abort-reason')
  })
  it('fails closed after adapter replacement, recovers on next step, and preserves ordinary chat',async()=>{
    const h=await host(), f=followFixture(h)
    header(h,'one','first','m');await h.capture()
    f.adapters.set('first',{})
    expect((await h.execute('one')).isError).toBe(true);expect(f.fetcher).not.toHaveBeenCalled()
    await h.capture('one',1)
    expect((await h.execute('one')).isError).toBe(false)
  })
})

describe('storage activation and snapshot recovery', () => {
  it.each(['tavily','tinyfish'] as const)('%s is selectable without credentials and stays frozen until the next request',async adapter=>{
    const h=await host()
    h.credentials.describe.mockResolvedValue({configured:false})
    h.changeSettings({version:2,defaultConnection:'builtin:'+adapter,freshness:'realtime'})
    const fetcher=vi.fn<typeof fetch>(async()=>adapter==='tavily'?Response.json({results:[]}):Response.json({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'{"results":[]}'}]}}))
    vi.stubGlobal('fetch',fetcher)
    const view=await h.invoke('get',{sessionId:'one'})
    expect(view.connections.find(c=>c.id==='builtin:'+adapter)).toMatchObject({configured:true,keyless:true})
    await h.capture()
    h.changeSettings({version:2,connections:{['builtin:'+adapter]:{access:'api-key'}}})
    expect((await h.execute('one')).isError).toBe(false)
    expect(h.credentials.resolve).not.toHaveBeenCalled()
    expect(h.bridge.diagnostics().at(-1)).toMatchObject({requested:'realtime'})
    await h.capture('one',1)
    fetcher.mockResolvedValue(Response.json({results:[]}))
    expect((await h.execute('one')).isError).toBe(false)
    expect(h.credentials.resolve).toHaveBeenCalledOnce()
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).has(adapter==='tavily'?'authorization':'x-api-key')).toBe(true)
  })
  it('recovers the same request step after late storage-domain activation without blocking inference', async () => {
    const h = await host(undefined, 'native', true)
    const fetcher = successTransport()
    await h.capture()
    expect(h.bridge.contexts.peek(h.agents.get('one')!)?.errorCode).toBe('WEB_SEARCH_STORAGE_UNAVAILABLE')
    expect((await h.execute('one')).isError).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    await StorageDomain.apply(h.ctx, { backend:'json' })
    await h.capture()
    expect(h.bridge.contexts.peek(h.agents.get('one')!)?.error).toBeUndefined()
    expect((await h.execute('one')).isError).toBe(false)
  })
  it('reopens a transiently failing domain and never caches the rejection for the plugin lifetime', async () => {
    const h = await host(undefined, 'native', true)
    successTransport()
    await StorageDomain.apply(h.ctx, { backend:'json' })
    const open = vi.spyOn(h.ctx.storageDomain, 'open').mockRejectedValueOnce(new Error('sensitive backend path'))
    await h.capture()
    const failed = await h.execute('one')
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).not.toContain('sensitive backend path')
    await h.capture()
    expect((await h.execute('one')).isError).toBe(false)
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('keyless mode bypasses credentials and keyed mode changes only on the next step', async () => {
    const h = await host()
    h.changeSettings({version:2,defaultConnection:'builtin:firecrawl',freshness:'realtime'})
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18',capabilities:{},serverInfo:{name:'fixture',version:'1'}}})
      if (body.method === 'notifications/initialized') return new Response(null,{status:202})
      if (body.method === 'tools/call') return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:JSON.stringify({web:[{url:'https://evidence.invalid',title:'Fixture',description:'content'}]})}]}})
      return Response.json({success:true,data:{web:[{url:'https://evidence.invalid',description:'rest'}]}})
    })
    vi.stubGlobal('fetch',fetcher)
    const view = await h.invoke('get',{sessionId:'one'})
    expect(view.connections.find(c=>c.id==='builtin:firecrawl')).toMatchObject({configured:true,keyless:true})
    await h.capture()
    expect((await h.execute('one')).isError).toBe(false)
    expect(h.credentials.resolve).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.every(([url])=>url==='https://api.firecrawl.dev/v2/search')).toBe(true)
    expect(fetcher.mock.calls.every(([,init])=>!new Headers(init?.headers).has('authorization'))).toBe(true)
    expect(h.bridge.diagnostics().at(-1)?.requested).toBe('realtime')
    h.changeSettings({version:2,connections:{'builtin:firecrawl':{access:'api-key'}}})
    await h.capture('one',1)
    expect((await h.execute('one')).isError).toBe(false)
    expect(h.credentials.resolve).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe('https://api.firecrawl.dev/v2/search')
  })
})
