import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Freshness } from '../catalog.ts'
import type { ResolvedSettings, FixedBinding } from '../config.ts'
import { ExecutionContexts, type SearchSnapshot } from './execution-context.ts'
import { captureFollowSettings, FollowRequest, FollowModelError } from './session-model.ts'
import { SessionSelections, SelectionConflict } from './session-selection.ts'
import { getRequest, setRequest, selectionSchema, type SelectionView } from '../remote-contract.ts'
import { abortable, executeSearch, FOLLOW_UNAVAILABLE, searchError } from '../search/service.ts'
import type { FreshnessDiagnostic } from '../search/diagnostics.ts'

export const selectionDomain = defineDomain({ name: 'web_search_enhanced', version: 1, tables: { selections: domainTable(selectionSchema) } })
export interface BridgeRuntime {
  settings(): ResolvedSettings
  selections(): Promise<SessionSelections>
  describe(agent?: Agent): Promise<SelectionView['connections']>
  initialize(session: Agent['session'], agent?: Agent): Promise<SelectionView['selection']>
}
/** Ordinary-session authorization deliberately delegates to the real Session Controller. */
export class SearchConnections extends TypertRemoteService {
  constructor(ctx: Context, private runtime: BridgeRuntime) { super(ctx, 'searchConnections') }
  private async authorized(id: string) {
    const found = await this.ctx.sessionController.resolveAgent(id as Agent['session']['id'])
    if ('error' in found) throw found.error
    return found.agent
  }
  private async view(agent: Agent): Promise<SelectionView> {
    const selection = await this.runtime.initialize(agent.session, agent)
    return { selection, connections: await this.runtime.describe(agent), freshness: selection.freshness! }
  }
  @Remote
  async get(request: { sessionId: string }): Promise<SelectionView> {
    const parsed = getRequest.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Invalid search selection request', {})
    return this.view(await this.authorized(parsed.data.sessionId))
  }
  @Remote
  async set(request: { sessionId: string; connectionId?: string | null; freshness?: Freshness; expectedRevision: number }): Promise<SelectionView> {
    const parsed = setRequest.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Invalid search selection request', {})
    const agent = await this.authorized(parsed.data.sessionId)
    const session = agent.session
    const { connectionId, freshness, expectedRevision } = parsed.data
    if (connectionId !== undefined && connectionId !== null) {
      const c = this.runtime.settings().connections[connectionId]
      if (!c || c.disabled) throw new RemoteError('gateway/bad-request', 'Search connection is missing or disabled', {})
    }
    await this.runtime.initialize(session, agent)
    try { await (await this.runtime.selections()).set(session.id, { ...(connectionId !== undefined ? { connectionId } : {}), ...(freshness !== undefined ? { freshness } : {}) }, expectedRevision) }
    catch (error) {
      if (error instanceof SelectionConflict) throw new RemoteError('gateway/bad-request', error.message, {})
      throw new RemoteError('gateway/internal', 'Search selection could not be persisted', {})
    }
    return this.view(agent)
  }
}

export function installBridge(ctx: Context, settings: () => ResolvedSettings) {
  const contexts = new ExecutionContexts()
  const follow = new WeakMap<SearchSnapshot, { request?: FollowRequest; error?: string }>()
  const diagnostics: Readonly<FreshnessDiagnostic & { sessionId: string; connectionId: string | null; step: number }>[] = []
  ctx.effect(() => () => { diagnostics.length = 0 }, 'private search diagnostics')
  let openSelections: (() => Promise<SessionSelections>) | undefined
  const storageMount = ctx.inject(['storageDomain'], storageCtx => {
    let domain: ReturnType<typeof storageCtx.storageDomain.open<typeof selectionDomain>> | undefined
    let state: Promise<SessionSelections> | undefined
    const open = () => {
      if (!state) {
        domain = storageCtx.storageDomain.open(selectionDomain)
        state = domain.then(d => new SessionSelections(d.table('selections')))
        void state.catch(() => { state = undefined; domain = undefined })
      }
      return state
    }
    openSelections = open
    storageCtx.effect(() => async () => {
      if (openSelections === open) openSelections = undefined
      await domain?.then(d => d.close(), () => {})
    }, 'search selection domain')
  })
  const runtime: BridgeRuntime = {
    settings,
    async selections() {
      // The provider may mount before the scoped storage effect. Await the actual
      // Cordis activation instead of permanently freezing that startup race.
      if (!openSelections && ctx.get('storageDomain')) await storageMount
      if (!openSelections) throw searchError('搜索存储尚未就绪：需要 DSH storage-domain 及持久后端；请检查插件依赖', 'WEB_SEARCH_STORAGE_UNAVAILABLE')
      try { return await openSelections() } catch {
        throw searchError('搜索存储打开失败；请检查 DSH 存储后端，下次请求会重新尝试', 'WEB_SEARCH_STORAGE_UNAVAILABLE')
      }
    },
    async describe(agent) {
      const credentials = ctx.get('credentials')
      return Promise.all(Object.values(settings().connections).map(async c => {
        let ref = c.kind === 'structured' ? c.credentialRef : c.binding?.mode === 'fixed' ? c.binding.credentialRef : undefined
        let configured = false, reason: string | undefined
        if (c.disabled) reason = '连接已禁用'
        else if (c.kind === 'structured' && c.keyless === true) configured = true
        else if (c.binding?.mode === 'session') {
          try {
            if (!agent) throw new FollowModelError('需要当前会话模型才能判断可用性')
            ref = new FollowRequest(captureFollowSettings(ctx)).resolve(agent).credentialRef
          } catch (error) { reason = error instanceof FollowModelError ? error.message : FOLLOW_UNAVAILABLE }
        }
        if (!reason && !configured && ref) {
          try { configured = (await credentials?.describe(credentialRef(ref)))?.configured === true } catch { /* fail closed, no credential details */ }
          if (!configured) reason = '请配置 DSH Credential: ' + ref
        }
        return { id: c.id, label: c.label, kind: c.kind, configured, ...(c.keyless ? { keyless: true } : {}), ...(reason ? { reason } : {}), ...(ref ? { credentialRef: ref } : {}) }
      }))
    },
    async initialize(session, agent) {
      const selections = await runtime.selections()
      const config = settings()
      return selections.get(session.id, async () => {
        const parent = session.header.parentSession
        // Fork current plugin selection once; historical fork-boundary routing is not exported.
        if (parent && session.header.isSeeded) {
          const inherited = await selections.get(parent, async () => null, config.freshness)
          return { connectionId: inherited.connectionId, freshness: inherited.freshness! }
        }
        if (config.defaultConnection !== undefined) return config.defaultConnection
        const available = (await runtime.describe(agent)).filter(c => c.configured)
        return available.length === 1 ? available[0]!.id : null
      }, config.freshness)
    },
  }
  ctx.on('agent/request', async (payload, next) => {
    const previous = contexts.peek(payload.agent)
    if (!previous || previous.errorCode === 'WEB_SEARCH_STORAGE_UNAVAILABLE' || previous.turn !== payload.turn || previous.step !== payload.step) {
      try {
        const selection = await abortable(runtime.initialize(payload.agent.session, payload.agent), payload.signal)
        const snapshot = contexts.capture(payload.agent, payload.agent.session.id, payload.turn, payload.step, selection, settings())
        if (snapshot.connection?.binding?.mode === 'session') {
          try { follow.set(snapshot, { request: new FollowRequest(captureFollowSettings(ctx)) }) }
          catch { follow.set(snapshot, { error: '无法读取当前会话 provider 配置；请检查 DSH settings' }) }
        }
      } catch (error) {
        // Keep a sanitized category, not the catch-all that previously hid every
        // startup/storage/migration fault behind the same unhelpful message.
        const code = (error as { code?: string })?.code
        const category = code === 'WEB_SEARCH_STORAGE_UNAVAILABLE' ? code : code === 'WEB_SEARCH_MIGRATION_REQUIRED' ? code : 'WEB_SEARCH_CONFIG_INVALID'
        const message = category === 'WEB_SEARCH_STORAGE_UNAVAILABLE' ? '搜索存储暂不可用：请检查 DSH storage-domain 及持久后端；下一次请求会重试' : category === 'WEB_SEARCH_MIGRATION_REQUIRED' ? '检测到旧版搜索配置：请在设置 → 搜索连接中导入旧配置' : '搜索配置无法解析：请在设置 → 搜索连接中检查配置'
        contexts.capture(payload.agent, payload.agent.session.id, payload.turn, payload.step, { connectionId: null, revision: 0 }, { freshness: 'auto', connections: {} }, message, category)
      }
    }
    return next() // never add metadata or replace the LLM configuration
  })
  ctx.on('tools/execute', (exec, next) => {
    const snapshot = exec.agent ? contexts.peek(exec.agent) : undefined
    if (!snapshot) return next()
    let binding: FixedBinding | undefined, bindingError: string | undefined
    if (snapshot.connection?.binding?.mode === 'session' && exec.agent) {
      const captured = follow.get(snapshot)
      try {
        if (!captured?.request) throw new FollowModelError(captured?.error ?? '缺少跟随配置快照；请发起新的模型请求')
        binding = captured.request.resolve(exec.agent)
      } catch (error) { bindingError = error instanceof FollowModelError ? error.message : FOLLOW_UNAVAILABLE }
    }
    return contexts.run(snapshot, binding, bindingError, next)
  })
  ctx.on('agent/disposed', ({ agent }) => contexts.forget(agent))
  // session/disposed is NOT durable deletion. Never erase persisted selections there.
  ctx.inject(['sessionController', 'typert'], remoteCtx => { new SearchConnections(remoteCtx, runtime) })
  ctx.web.registerSearchProvider({
    id: 'enhanced-search', available: () => true,
    async search(request, signal) {
      const execution = contexts.current()
      if (!execution) throw searchError('缺少模型请求搜索快照；请发起新的模型请求后重试', 'WEB_SEARCH_CONTEXT_UNAVAILABLE')
      if (execution.bindingError && !execution.snapshot.error) {
        if (signal?.aborted) throw searchError('search aborted', 'WEB_ABORTED')
        throw searchError(execution.bindingError, 'WEB_SEARCH_FOLLOW_UNSUPPORTED')
      }
      return executeSearch(execution.snapshot, request, async ref => (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value, signal, execution.binding, globalThis.fetch, facts => {
        diagnostics.push(Object.freeze({ ...facts, sessionId: execution.snapshot.sessionId, connectionId: execution.snapshot.selection.connectionId, step: execution.snapshot.step }))
        if (diagnostics.length > 100) diagnostics.shift()
      })
    },
  })
  return { contexts, runtime, diagnostics: () => diagnostics.slice() }
}
