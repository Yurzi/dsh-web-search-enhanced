import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ResolvedSettings } from '../config.ts'
import { ExecutionContexts } from './execution-context.ts'
import { SessionSelections, SelectionConflict } from './session-selection.ts'
import { getRequest, setRequest, selectionSchema, type SelectionView } from '../remote-contract.ts'
import { abortable, executeSearch, FOLLOW_UNAVAILABLE, searchError } from '../search/service.ts'
import type { FreshnessDiagnostic } from '../search/diagnostics.ts'

export const selectionDomain = defineDomain({ name: 'web_search_enhanced', version: 1, tables: { selections: domainTable(selectionSchema) } })
export interface BridgeRuntime {
  settings(): ResolvedSettings
  selections(): Promise<SessionSelections>
  describe(): Promise<SelectionView['connections']>
  initialize(session: Agent['session']): Promise<SelectionView['selection']>
}
/** Ordinary-session authorization deliberately delegates to the real Session Controller. */
export class SearchConnections extends TypertRemoteService {
  constructor(ctx: Context, private runtime: BridgeRuntime) { super(ctx, 'searchConnections') }
  private async authorized(id: string) {
    const found = await this.ctx.sessionController.resolveAgent(id as Agent['session']['id'])
    if ('error' in found) throw found.error
    return found.agent.session
  }
  private async view(session: Agent['session']): Promise<SelectionView> {
    return { selection: await this.runtime.initialize(session), connections: await this.runtime.describe(), freshness: this.runtime.settings().freshness }
  }
  @Remote
  async get(request: { sessionId: string }): Promise<SelectionView> {
    const parsed = getRequest.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Invalid search selection request', {})
    return this.view(await this.authorized(parsed.data.sessionId))
  }
  @Remote
  async set(request: { sessionId: string; connectionId: string | null; expectedRevision: number }): Promise<SelectionView> {
    const parsed = setRequest.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Invalid search selection request', {})
    const session = await this.authorized(parsed.data.sessionId)
    const { connectionId, expectedRevision } = parsed.data
    if (connectionId !== null) {
      const c = this.runtime.settings().connections[connectionId]
      if (!c || c.disabled) throw new RemoteError('gateway/bad-request', 'Search connection is missing or disabled', {})
    }
    await this.runtime.initialize(session)
    try { await (await this.runtime.selections()).set(session.id, connectionId, expectedRevision) }
    catch (error) {
      if (error instanceof SelectionConflict) throw new RemoteError('gateway/bad-request', error.message, {})
      throw new RemoteError('gateway/internal', 'Search selection could not be persisted', {})
    }
    return this.view(session)
  }
}

export function installBridge(ctx: Context, settings: () => ResolvedSettings) {
  const contexts = new ExecutionContexts()
  const diagnostics: Readonly<FreshnessDiagnostic & { sessionId: string; connectionId: string | null; step: number }>[] = []
  ctx.effect(() => () => { diagnostics.length = 0 }, 'private search diagnostics')
  let state: Promise<SessionSelections> | undefined
  ctx.inject(['storageDomain'], storageCtx => {
    storageCtx.effect(() => {
      const domain = storageCtx.storage.domain.open(selectionDomain)
      const opened = domain.then(d => new SessionSelections(d.table('selections')))
      state = opened
      void opened.catch(() => {})
      return async () => { if (state === opened) state = undefined; await domain.then(d => d.close(), () => {}) }
    }, 'search selection domain')
  })
  const runtime: BridgeRuntime = {
    settings,
    async selections() {
      if (!state) throw searchError('会话搜索存储不可用（需要 DSH Storage Domain 持久后端）', 'WEB_SEARCH_STORAGE_UNAVAILABLE')
      try { return await state } catch { throw searchError('会话搜索存储打开失败', 'WEB_SEARCH_STORAGE_UNAVAILABLE') }
    },
    async describe() {
      const credentials = ctx.get('credentials')
      return Promise.all(Object.values(settings().connections).map(async c => {
        const ref = c.kind === 'structured' ? c.credentialRef : c.binding?.mode === 'fixed' ? c.binding.credentialRef : undefined
        let configured = false, reason: string | undefined
        if (c.disabled) reason = '连接已禁用'
        else if (!ref) reason = FOLLOW_UNAVAILABLE
        else {
          try { configured = (await credentials?.describe(credentialRef(ref)))?.configured === true } catch { /* fail closed, no credential details */ }
          if (!configured) reason = '请配置 DSH Credential: ' + ref
        }
        return { id: c.id, label: c.label, kind: c.kind, configured, ...(reason ? { reason } : {}), ...(ref ? { credentialRef: ref } : {}) }
      }))
    },
    async initialize(session) {
      const selections = await runtime.selections()
      return selections.get(session.id, async () => {
        const parent = session.header.parentSession
        // Fork current plugin selection once; historical fork-boundary routing is not exported.
        if (parent && session.header.isSeeded) {
          return (await selections.get(parent, async () => null)).connectionId
        }
        const config = settings()
        if (config.defaultConnection !== undefined) return config.defaultConnection
        const available = (await runtime.describe()).filter(c => c.configured)
        return available.length === 1 ? available[0]!.id : null
      })
    },
  }
  ctx.on('agent/request', async (payload, next) => {
    const previous = contexts.peek(payload.agent)
    if (!previous || previous.turn !== payload.turn || previous.step !== payload.step) {
      try {
        const selection = await abortable(runtime.initialize(payload.agent.session), payload.signal)
        contexts.capture(payload.agent, payload.agent.session.id, payload.turn, payload.step, selection, settings())
      } catch {
        // Search misconfiguration must not block ordinary chat; actual search fails explicitly.
        contexts.capture(payload.agent, payload.agent.session.id, payload.turn, payload.step, { connectionId: null, revision: 0 }, { freshness: 'auto', connections: {} }, '本请求未能冻结会话搜索状态；请检查存储及配置后发起新请求')
      }
    }
    return next() // never add metadata or replace the LLM configuration
  })
  ctx.on('tools/execute', (exec, next) => {
    const snapshot = exec.agent ? contexts.peek(exec.agent) : undefined
    if (!snapshot) return next()
    return contexts.run(snapshot, undefined, FOLLOW_UNAVAILABLE, next)
  })
  ctx.on('agent/disposed', ({ agent }) => contexts.forget(agent))
  // session/disposed is NOT durable deletion. Never erase persisted selections there.
  ctx.inject(['sessionController', 'typert'], remoteCtx => { new SearchConnections(remoteCtx, runtime) })
  ctx.web.registerSearchProvider({
    id: 'enhanced-search', available: () => true,
    async search(request, signal) {
      const execution = contexts.current()
      if (!execution) throw searchError('缺少模型请求搜索快照；请发起新的模型请求后重试', 'WEB_SEARCH_CONTEXT_UNAVAILABLE')
      return executeSearch(execution.snapshot, request, async ref => (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value, signal, execution.binding, globalThis.fetch, facts => {
        diagnostics.push(Object.freeze({ ...facts, sessionId: execution.snapshot.sessionId, connectionId: execution.snapshot.selection.connectionId, step: execution.snapshot.step }))
        if (diagnostics.length > 100) diagnostics.shift()
      })
    },
  })
  return { contexts, runtime, diagnostics: () => diagnostics.slice() }
}
