import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { buildWireRequest, defaultToolIdentifier, parseSearchResponse, type ResolvedConfig } from '../protocols.ts'
import type { FixedBinding } from '../config.ts'
import type { SearchSnapshot } from '../dsh/execution-context.ts'
import { fetchJson, searchStructured } from '../adapters/structured.ts'
import { searchKeyless } from '../adapters/mcp.ts'
import { freshnessDiagnostic, type FreshnessDiagnostic } from './diagnostics.ts'

export const FOLLOW_UNAVAILABLE = '无法将当前会话模型解析为支持的搜索连接；请检查 provider 的协议、endpoint 和凭据引用。'
export function searchError(message: string, code = 'WEB_PROVIDER_ERROR'): WebError { return new WebError('dsh-web-search-enhanced: ' + message, code) }
export async function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) { void pending.catch(() => {}); throw searchError('search aborted', 'WEB_ABORTED') }
  if (!signal) return pending
  return new Promise((resolve, reject) => {
    const abort = () => reject(searchError('search aborted', 'WEB_ABORTED'))
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {})
  })
}
/** All bindings converge here; only the resolver distinguishes fixed and session models. */
export async function executeSearch(
  snapshot: SearchSnapshot, request: WebSearchRequest,
  resolveCredential: (ref: string) => Promise<string | undefined>,
  signal?: AbortSignal, binding?: FixedBinding, fetcher: typeof fetch = globalThis.fetch, diagnose?: (facts: FreshnessDiagnostic) => void,
): Promise<WebSearchResult> {
  if (signal?.aborted) throw searchError('search aborted', 'WEB_ABORTED')
  if (snapshot.error) throw searchError(snapshot.error, snapshot.errorCode ?? 'WEB_SEARCH_CONTEXT_UNAVAILABLE')
  if (!snapshot.selection.connectionId) throw searchError('请在当前会话选择搜索连接', 'WEB_SEARCH_NOT_SELECTED')
  const c = snapshot.connection
  if (!c || c.disabled) throw searchError('所选连接已删除或禁用，请修复或重新选择', 'WEB_SEARCH_CONNECTION_INVALID')
  const route = c.binding?.mode === 'fixed' ? c.binding : binding
  if (c.kind === 'model' && !route) throw searchError(FOLLOW_UNAVAILABLE, 'WEB_SEARCH_FOLLOW_UNSUPPORTED')
  const keyless = c.kind === 'structured' && c.keyless === true
  const ref = c.kind === 'structured' ? c.credentialRef : route!.credentialRef
  let key: string | undefined
  if (keyless) {
    if (c.adapter !== 'exa' && c.adapter !== 'tinyfish') {
      try { return await searchStructured(c.adapter!, request, { endpoint: c.endpoint!, options: c.options }, { freshness: snapshot.freshness, keyless: true, ...(signal ? { signal } : {}), fetcher, ...(diagnose ? { diagnose } : {}) }) }
      catch (error) {
        if ((error as { code?: string })?.code === 'WEB_PROVIDER_AUTH_ERROR') throw searchError(c.adapter + ' 拒绝当前网络的免 Key 访问；请显式切换个人 API Key 或选择其他连接', 'WEB_KEYLESS_UNAVAILABLE')
        throw error
      }
    }
    const result = await searchKeyless(c.adapter, request, signal, fetcher, c.options)
    diagnose?.(freshnessDiagnostic(snapshot.freshness, false, result.sources.map(s => s.snippet)))
    return result
  }
  if (!ref) throw searchError('所选连接缺少凭据引用', 'WEB_PROVIDER_CREDENTIAL_MISSING')
  try { key = await abortable(resolveCredential(ref), signal) } catch (error) {
    if (signal?.aborted) throw searchError('search aborted', 'WEB_ABORTED')
    throw searchError('DSH Credentials 无法解析所选连接的凭据', 'WEB_PROVIDER_CREDENTIAL_MISSING')
  }
  if (!key?.trim() || /[\r\n]/u.test(key)) throw searchError('所选连接缺少有效的 DSH Credential: ' + ref, 'WEB_PROVIDER_CREDENTIAL_MISSING')
  if (c.kind === 'structured') return searchStructured(c.adapter!, request, { endpoint: c.endpoint!, options: c.options }, { freshness: snapshot.freshness, apiKey: key, ...(signal ? { signal } : {}), fetcher, ...(diagnose ? { diagnose } : {}) })
  if (!Number.isSafeInteger(request.maxResults ?? 1) || (request.maxResults ?? 1) < 0 || !request.query.trim()) throw searchError('invalid search request')
  if (request.maxResults === 0) return { sources: [], truncated: false }
  const options = c.binding?.mode === 'session' ? c.optionsByProtocol?.[route!.protocol] ?? {} : c.options
  const config: ResolvedConfig = {
    providerId: 'enhanced-search', modelMode: 'configured', protocol: route!.protocol, model: route!.model, baseURL: route!.baseURL,
    apiKeyEnv: ref, apiKey: undefined, fallbackModel: undefined, apiVersion: String(options.apiVersion ?? '2023-06-01'),
    toolIdentifier: String(options.toolIdentifier ?? defaultToolIdentifier(route!.protocol)), maxTokens: Number(options.maxTokens ?? 4096), maxUses: Number(options.maxUses ?? 5),
    chatSearchMode: options.chatSearchMode as ResolvedConfig['chatSearchMode'] ?? 'search-model', searchContextSize: options.searchContextSize as ResolvedConfig['searchContextSize'],
  }
  const wire = buildWireRequest(config, request.query, key)
  const payload = await fetchJson(wire.endpoint, { method: 'POST', headers: wire.headers, body: JSON.stringify(wire.body) }, signal, fetcher)
  let result: WebSearchResult
  try { result = parseSearchResponse(route!.protocol, payload) } catch { throw searchError('所选模型返回非法搜索响应（请确认模型支持服务端搜索）', 'WEB_PROVIDER_RESPONSE_INVALID') }
  diagnose?.(freshnessDiagnostic(snapshot.freshness, false, result.sources.map(s => s.snippet)))
  const limit = request.maxResults ?? result.sources.length
  return { ...result, sources: result.sources.slice(0, limit), truncated: result.truncated || result.sources.length > limit }
}
