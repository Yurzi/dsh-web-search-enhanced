/**
 * `builtin:session-model`: search with the model that serves the session.
 * Its route is derived only from public facts — the LLM configurable-provider
 * directory and the settings form it points at — and fails with a clear
 * reason whenever those facts cannot prove the endpoint and credential.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { LlmConfigurableProvider, LlmNativeAuth } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { CREDENTIAL_REF, type ModelProtocol } from '../catalog.ts'
import { isRecord, text } from '../search/sources.ts'
import { isEndpoint } from '../settings/resolve.ts'
import type { FixedModelBinding } from '../settings/types.ts'

/** Provider id of the DeepSeek account sign-in route. */
export const ACCOUNT_PROVIDER = 'deepseek-account'

export interface SessionModel {
  readonly provider: string
  readonly model: string
}

export type FollowRoute =
  | { readonly kind: 'route'; readonly route: FixedModelBinding }
  | { readonly kind: 'unsupported'; readonly detail: string }

/** Routing fields a profile or one of its models may set. */
interface Routing {
  readonly api: string | undefined
  readonly baseURL: string | undefined
  /** Custom request headers, which search does not forward. */
  readonly headers: boolean
}

/** Secret-free facts of one configurable provider route, copied out of its profile. */
interface RouteFacts extends Routing {
  readonly apiKeyEnv: string | undefined
  /** The profile holds a literal API key. */
  readonly inlineKey: boolean
  readonly defaultBaseURL: string | undefined
  readonly nativeAuth: LlmNativeAuth | undefined
  readonly models: ReadonlyMap<string, Routing>
}

/** Route facts of every configurable provider, by provider id. */
export type RouteDirectory = ReadonlyMap<string, RouteFacts>

/** The model of the session's next request: a pending switch, else the last request's, else the Agent's route. */
export function nextModel(ctx: Context, agent: Agent): SessionModel | undefined {
  const pending = ctx.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending
  return complete(pending ?? agent.session.requestHeader()?.config ?? agent.options)
}

/** The model of the request in flight, which called the search. */
export function requestModel(agent: Agent): SessionModel | undefined {
  return complete(agent.session.requestHeader()?.config)
}

/** Copy the route facts of every configurable provider; later profile edits do not affect the copy. */
export function captureRoutes(ctx: Context): RouteDirectory {
  const forms = new Map<string, unknown>((ctx.get('settings')?.describe() ?? []).map(form => [form.ns, form.value]))
  const entries = ctx.get('llm')?.listConfigurableProviders() ?? []
  return new Map(entries.map(entry => [entry.provider, factsOf(entry, at(forms.get(entry.settingsNs), entry.settingsPath) ?? {})]))
}

/** Derive the search route of `model` from captured route facts. */
export function followRoute(routes: RouteDirectory, model: SessionModel | undefined): FollowRoute {
  if (model === undefined) return unsupported('the session has no model yet')
  const route = routes.get(model.provider)
  if (route === undefined) return unsupported(`provider "${model.provider}" publishes no configurable route, so its endpoint and credential are unknown`)
  const own = route.models.get(model.model)
  if (route.inlineKey) return unsupported('the provider profile holds an inline API key; store it in DSH Credentials and reference it with apiKeyEnv')
  if (route.headers || own?.headers === true) return unsupported('the route sends custom request headers, which search does not forward')

  const api = own?.api ?? route.api
  const protocol = protocolOf(api)
  if (protocol === undefined) {
    return unsupported(api === undefined
      ? 'the provider profile does not declare its wire protocol (api)'
      : `protocol ${JSON.stringify(api)} has no server-side web search; use anthropic-messages, openai-responses or openai-completions`)
  }
  const baseURL = own?.baseURL ?? route.baseURL ?? route.defaultBaseURL
  if (baseURL === undefined || !isEndpoint(baseURL)) return unsupported('the route has no usable endpoint (baseURL)')
  const credential = credentialOf(route)
  if (credential.kind === 'unsupported') return credential
  return { kind: 'route', route: { mode: 'fixed', protocol, model: model.model, baseURL, credentialRef: credential.ref } }
}

function factsOf(entry: LlmConfigurableProvider, profile: Record<string, unknown>): RouteFacts {
  // A model's own entry, from `models` or `modelOverrides`, may set its protocol and endpoint.
  const listed = (Array.isArray(profile.models) ? profile.models : []).filter(isRecord).map(item => [text(item.id), item] as const)
  const overrides = Object.entries(isRecord(profile.modelOverrides) ? profile.modelOverrides : {})
  const models = new Map<string, Routing>()
  for (const [id, item] of [...overrides, ...listed]) if (id !== undefined && isRecord(item)) models.set(id, routingOf(item))
  return {
    ...routingOf(profile),
    apiKeyEnv: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined,
    inlineKey: profile.apiKey !== undefined,
    defaultBaseURL: entry.defaultBaseURL,
    nativeAuth: entry.nativeAuth,
    models,
  }
}

function routingOf(profile: Record<string, unknown>): Routing {
  return {
    api: typeof profile.api === 'string' ? profile.api : undefined,
    baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : undefined,
    headers: isRecord(profile.headers) && Object.keys(profile.headers).length > 0,
  }
}

function credentialOf({ apiKeyEnv, nativeAuth }: RouteFacts): { kind: 'ref'; ref: string } | Extract<FollowRoute, { kind: 'unsupported' }> {
  if (apiKeyEnv !== undefined) {
    return CREDENTIAL_REF.test(apiKeyEnv) ? { kind: 'ref', ref: apiKeyEnv } : unsupported('apiKeyEnv is not a valid credential reference')
  }
  if (nativeAuth?.oauth === true) return unsupported('the route may authenticate with an OAuth sign-in; set apiKeyEnv on the provider profile to search with an API key')
  const [only, ...others] = nativeAuth?.env ?? []
  if (only === undefined || others.length > 0) return unsupported('the route names no single credential reference; set apiKeyEnv on the provider profile')
  return { kind: 'ref', ref: only }
}

function protocolOf(api: string | undefined): ModelProtocol | undefined {
  switch (api) {
    case 'anthropic-messages': return 'anthropic-messages'
    case 'openai-responses': return 'openai-responses'
    case 'openai-completions':
    case 'openai-chat-completions': return 'openai-chat-completions'
    default: return undefined
  }
}

/** Follow own properties only, so an inherited object is never mistaken for a profile. */
function at(value: unknown, path: readonly string[]): Record<string, unknown> | undefined {
  let node = value
  for (const key of path) node = isRecord(node) && Object.hasOwn(node, key) ? node[key] : undefined
  return isRecord(node) ? node : undefined
}

function complete(selection: { readonly provider?: string | undefined; readonly model?: string | undefined } | null | undefined): SessionModel | undefined {
  return selection?.provider && selection.model ? { provider: selection.provider, model: selection.model } : undefined
}

function unsupported(detail: string): Extract<FollowRoute, { kind: 'unsupported' }> {
  return { kind: 'unsupported', detail }
}
