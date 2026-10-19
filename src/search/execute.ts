/** The single dispatch point from a resolved search target to the network. */
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { ADAPTERS, type Freshness } from '../catalog.ts'
import type { ModelSearchOptions, StructuredConnection } from '../settings/resolve.ts'
import type { FixedModelBinding } from '../settings/types.ts'
import { ADAPTER_WIRES, type Auth, type SearchInput } from './adapters/index.ts'
import { abortable, searchError, throwIfAborted } from './errors.ts'
import { requestJson, withDeadline, type Upstream } from './http.ts'
import { callTool } from './mcp.ts'
import { modelRequest, parseModelResponse } from './model.ts'

export type SearchTarget =
  | { readonly kind: 'structured'; readonly connection: StructuredConnection; readonly freshness: Freshness }
  | { readonly kind: 'model'; readonly label: string; readonly route: FixedModelBinding; readonly options: ModelSearchOptions }

export interface SearchDeps {
  /** Resolve a DSH credential reference; undefined while it is unset. */
  credential(ref: string): Promise<string | undefined>
  /** Present only when the calling session runs on the DeepSeek account route. */
  readonly accountToken?: ((endpoint: string) => Promise<string | undefined>) | undefined
}

export async function executeSearch(target: SearchTarget, request: WebSearchRequest, deps: SearchDeps, signal?: AbortSignal): Promise<WebSearchResult> {
  throwIfAborted(signal)
  return target.kind === 'model'
    ? searchModel(target, request, deps, signal)
    : searchStructured(target, request, deps, signal)
}

async function searchStructured(
  { connection, freshness }: Extract<SearchTarget, { kind: 'structured' }>,
  request: WebSearchRequest, deps: SearchDeps, signal: AbortSignal | undefined,
): Promise<WebSearchResult> {
  const input: SearchInput = { query: request.query, maxResults: request.maxResults, freshness, options: connection.options }
  const sources = connection.access === 'keyless'
    ? await searchKeyless(connection, input, signal)
    : await searchPersonal(connection, input, deps, signal)
  return { sources, truncated: false }
}

/** Anonymous access always uses the official route and never falls back to a personal key. */
async function searchKeyless(connection: StructuredConnection, input: SearchInput, signal: AbortSignal | undefined): Promise<WebSearchSource[]> {
  const adapter = ADAPTER_WIRES[connection.adapter]
  const route = adapter.keyless
  if (route === undefined) throw new Error(`${connection.adapter} has no keyless route`)
  const upstream: Upstream = { label: connection.label, access: 'keyless' }
  if (route === 'rest') {
    const request = adapter.request(input, ADAPTERS[connection.adapter].endpoint, { kind: 'keyless' })
    return adapter.parse(await withDeadline(signal, deadline => requestJson(request, deadline, upstream)), input)
  }
  return route.parse(await withDeadline(signal, deadline => callTool({ ...route, arguments: route.arguments(input) }, deadline, upstream)))
}

async function searchPersonal(connection: StructuredConnection, input: SearchInput, deps: SearchDeps, signal: AbortSignal | undefined): Promise<WebSearchSource[]> {
  const adapter = ADAPTER_WIRES[connection.adapter]
  const auth = await authFor(connection, deps, signal)
  const request = adapter.request(input, connection.endpoint, auth)
  const payload = await withDeadline(signal, deadline => requestJson(request, deadline, { label: connection.label, access: auth.kind }))
  return adapter.parse(payload, input)
}

/** An account sign-in when the service accepts it for this session, else the connection's API key. */
async function authFor(connection: StructuredConnection, deps: SearchDeps, signal: AbortSignal | undefined): Promise<Auth> {
  if (ADAPTERS[connection.adapter].account && deps.accountToken !== undefined) {
    const token = await abortable(deps.accountToken(connection.endpoint), signal)
    if (token) return { kind: 'account', token }
  }
  return { kind: 'api-key', key: await apiKey(connection.credentialRef, deps, signal) }
}

async function searchModel(
  { label, route, options }: Extract<SearchTarget, { kind: 'model' }>,
  request: WebSearchRequest, deps: SearchDeps, signal: AbortSignal | undefined,
): Promise<WebSearchResult> {
  const key = await apiKey(route.credentialRef, deps, signal)
  const payload = await withDeadline(signal, deadline => requestJson(modelRequest(route, options, request.query, key), deadline, { label, access: 'api-key' }))
  return parseModelResponse(route.protocol, payload)
}

async function apiKey(ref: string, deps: SearchDeps, signal: AbortSignal | undefined): Promise<string> {
  const key = (await abortable(deps.credential(ref), signal))?.trim()
  if (!key) {
    throw searchError('WEB_PROVIDER_CREDENTIAL_MISSING', `no API key is stored for ${ref}; ask the user to add it in the search connection settings (DSH Credentials) or choose another search connection`)
  }
  return key
}