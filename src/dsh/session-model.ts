import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-llm'
import type { FixedBinding } from '../config.ts'
import { endpoint, reference } from '../config.ts'
import type { SearchProtocol } from '../protocols.ts'

export interface ModelSelection { provider?: string; model?: string }
export interface SessionModelAgent { options?: ModelSelection; session: { requestHeader(): { config?: ModelSelection } | undefined } }
interface Route {
  api?: string; baseURL?: string; credentialRef?: string
  models?: readonly string[]
  catalog: Readonly<Record<string, { api?: string; baseURL?: string }>>
  error?: string
}
/** Only allowlisted, nonsecret facts enter the request snapshot. */
export interface FollowSettings { readonly providers: Readonly<Record<string, Readonly<Route>>> }
const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined
const string = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined
export class FollowModelError extends Error {
  readonly code = 'WEB_SEARCH_FOLLOW_UNSUPPORTED'
}
const fail = (message: string): never => { throw new FollowModelError(message) }
export function sessionModelSelection(agent?: SessionModelAgent): Required<ModelSelection> {
  if (!agent) return fail('缺少当前会话模型上下文')
  const header = agent.session.requestHeader()
  // Do not fill half a committed route with unrelated options or a global default.
  const selection = header === undefined ? agent.options : header.config
  if (!selection?.provider || !selection.model) return fail('当前会话没有完整的 provider/model；请先选择对话模型')
  return { provider: selection.provider, model: selection.model }
}
export function searchProtocolOf(api: unknown): SearchProtocol | undefined {
  switch (api) {
    case 'anthropic-messages': return 'anthropic-messages'
    case 'openai-responses': return 'openai-responses'
    case 'openai-completions': case 'openai-chat-completions': return 'openai-chat-completions'
    default: return undefined
  }
}
/** Optional, shape-detected pi-ai catalog shim; explicit settings never need it.
 * No private current()/snapshot, auth resolver, network probe or secret is read.
 * Missing/changed shapes disable only catalog completion, not explicit routes.
 */
function catalogOf(adapter: unknown, provider: string): Route['catalog'] {
  const catalog: Record<string, { api?: string; baseURL?: string }> = Object.create(null)
  try {
    const config = object(object(adapter)?.config)
    if (typeof config?.profiles !== 'function') return catalog
    const profiles = config.profiles.call(config) as unknown
    if (!(profiles instanceof Map)) return catalog
    const profile = object(profiles.get(provider)), directory = object(profile?.piProvider)
    if (typeof directory?.getModels !== 'function') return catalog
    const models: unknown = directory.getModels.call(directory)
    if (!Array.isArray(models)) return catalog
    for (const value of models) {
      const model = object(value), id = string(model?.id)
      if (!id) continue
      const api = string(model?.api)
      let baseURL: string | undefined
      try { if (model?.baseUrl !== undefined) baseURL = endpoint(model.baseUrl) } catch { /* no unsafe URL in snapshots */ }
      // Never retain unknown fields (including auth/headers) from catalog records.
      catalog[id] = Object.freeze({ ...(api && searchProtocolOf(api) ? { api } : {}), ...(baseURL ? { baseURL } : {}) })
    }
  } catch { /* a missing optional catalog is handled by normal binding validation */ }
  return Object.freeze(catalog)
}
/** Compatibility boundary, NOT a public LlmRuntime API.
 * The public directory exposes route metadata but no adapter identity or wire
 * binding. Retain the target version's private registration shape only for the
 * existing identity guard/catalog shim; an unavailable shape disables follow
 * search rather than silently dropping replacement protection.
 */
function adapterIdentity(llm: unknown, provider: string): object {
  const registration = object(llm)?.registration
  if (typeof registration !== 'function') return fail('宿主无法提供会话 adapter 身份；请使用固定搜索连接')
  const entry: unknown = registration.call(llm, provider)
  const adapter = object(object(entry)?.adapter)
  if (!adapter) return fail('宿主无法提供会话 adapter 身份；请使用固定搜索连接')
  return adapter
}
export interface CapturedFollowSettings {
  readonly settings: FollowSettings
  /** Kept separately from cloneable facts; verifies adapter replacement, not secrets. */
  assertAdapter(provider: string): void
}
export function captureFollowSettings(ctx: Context): CapturedFollowSettings {
  const settings = ctx.get('settings')
  const llm = ctx.get('llm')
  // Namespace is a Loader entry id, not an adapter package's fixed name.
  // Read unredacted Host forms only to reject unsupported auth; snapshots below
  // retain the same nonsecret allowlist as fixed connections.
  const forms = new Map(settings?.describe().map(form => [String(form.ns), form.value]) ?? [])
  const routes: Record<string, Readonly<Route>> = Object.create(null)
  const adapters = new Map<string, object>()
  const registered = new Set(llm?.listProviders().map(provider => provider.id) ?? [])
  for (const { provider, settingsNs, settingsPath } of llm?.listConfigurableProviders() ?? []) {
    const value = settingsPath.reduce<unknown>((parent, key) => {
      const record = object(parent)
      return record && Object.hasOwn(record, key) ? record[key] : undefined
    }, forms.get(settingsNs))
    const profile = object(value)
    if (!profile) { routes[provider] = { catalog: {}, error: '会话 provider 配置不可用' }; continue }
    if (!registered.has(provider)) { routes[provider] = { catalog: {}, error: '会话 provider 已不在宿主注册目录中' }; continue }
    let adapter: object
    try { adapter = adapterIdentity(llm, provider) } catch { routes[provider] = { catalog: {}, error: '宿主无法确认会话 adapter 身份；请使用固定搜索连接' }; continue }
    adapters.set(provider, adapter)
    const rawApi = string(profile.api)
    const api = searchProtocolOf(rawApi) ? rawApi : undefined
    let baseURL: string | undefined, credentialRef: string | undefined, error: string | undefined
    if (profile.api !== undefined && !api) error = '当前会话协议为空或不支持服务端搜索'
    try { if (profile.baseURL !== undefined) baseURL = endpoint(profile.baseURL) } catch { error = '会话 endpoint 配置非法' }
    try { if (profile.apiKeyEnv !== undefined) credentialRef = reference(profile.apiKeyEnv) } catch { error = '会话凭据引用配置非法' }
    if (profile.apiKey !== undefined || profile.auth !== undefined || profile.oauth !== undefined) error = '此路由使用不支持的认证配置；跟随搜索需要 DSH Credential 引用'
    if (Object.keys(object(profile.headers) ?? {}).length) error = '此路由需要自定义 headers；首版跟随搜索不透传 headers'
    if (profile.transport !== undefined && profile.transport !== 'sse' && profile.transport !== 'auto') error = '此路由不是受支持的 HTTP 搜索传输'
    let models: string[] | undefined
    if (profile.models !== undefined) {
      if (!Array.isArray(profile.models)) error = '会话 models 配置非法'
      else models = profile.models.map(m => string(object(m)?.id)).filter((id): id is string => id !== undefined)
    }
    // Follow search does not accept model-level endpoint, API or credential overrides.
    const overrides = [...(Array.isArray(profile.models) ? profile.models : []), ...Object.values(object(profile.modelOverrides) ?? {})]
    if (overrides.some(m => ['api','baseURL','apiKeyEnv','apiKey','headers'].some(k => Object.hasOwn(object(m) ?? {}, k)))) error = '当前宿主不支持 model 级 endpoint、协议或认证覆盖'
    routes[provider] = Object.freeze({ ...(api ? { api } : {}), ...(baseURL ? { baseURL } : {}), ...(credentialRef ? { credentialRef } : {}),
      ...(models ? { models: Object.freeze(models) } : {}), catalog: api && baseURL ? Object.freeze({}) : catalogOf(adapter, provider), ...(error ? { error } : {}) })
  }
  return {
    settings: Object.freeze({ providers: Object.freeze(routes) }),
    assertAdapter(provider) {
      if (!adapters.has(provider)) return
      try { if (adapterIdentity(llm, provider) === adapters.get(provider)) return } catch { /* unavailable */ }
      fail('会话模型 adapter 已替换或移除；请发起新的模型请求')
    },
  }
}
export function resolveFollowBinding(settings: FollowSettings, selection: Required<ModelSelection>): FixedBinding {
  const route = settings.providers[selection.provider]
  if (!route) return fail('当前 provider 没有可用的宿主配置；不能解析为 API Key 搜索连接')
  if (route.error) return fail(route.error)
  if (route.models && !route.models.includes(selection.model)) return fail('当前模型已不在此 provider 的显式 models 列表中')
  const model = route.catalog[selection.model]
  const protocol = searchProtocolOf(route.api ?? model?.api)
  if (!protocol) return fail('当前会话协议不支持服务端搜索，或目录未提供协议；请检查 provider 配置')
  const baseURL = route.baseURL ?? model?.baseURL
  if (!baseURL) return fail('当前会话缺少 endpoint，且目录无法补齐；请检查 provider 配置')
  if (!route.credentialRef) return fail('当前会话缺少 apiKeyEnv；首版跟随搜索不重建 OAuth/订阅认证，也不借用其他连接的 Key')
  try {
    return Object.freeze({ mode: 'fixed', model: selection.model, protocol, baseURL: endpoint(baseURL), credentialRef: reference(route.credentialRef) })
  } catch { return fail('当前会话 endpoint 或凭据引用格式非法') }
}
/** Per-request binding cache: one settings snapshot, distinct effective provider/model pairs. */
export class FollowRequest {
  private bindings = new Map<string, FixedBinding>()
  constructor(private captured: CapturedFollowSettings) {}
  resolve(agent: SessionModelAgent): FixedBinding {
    const selection = sessionModelSelection(agent)
    this.captured.assertAdapter(selection.provider)
    const key = JSON.stringify([selection.provider, selection.model])
    let binding = this.bindings.get(key)
    if (!binding) { binding = resolveFollowBinding(this.captured.settings, selection); this.bindings.set(key, binding) }
    return binding
  }
}
