/**
 * Multi-protocol web search provider for DeepSeek Harness.
 * @module dsh-web-search-enhanced
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { EnhancedSearchProvider } from './provider.ts'
import { defaultToolIdentifier } from './protocols.ts'
import type { ChatSearchMode, ModelMode, ResolvedConfig, SearchContextSize, SearchProtocol, SearchWireRecord } from './protocols.ts'

/** Provider id selected by the bundled Web Profile patch. */
export const DEFAULT_PROVIDER_ID = 'enhanced-search'
/** Default Anthropic-compatible search endpoint. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'
/** Default model aligned with DSH's built-in search provider. */
export const DEFAULT_MODEL = 'deepseek-flash'
/** Credential reference owned by this plugin's fixed and fallback routes. */
export const DEFAULT_API_KEY_ENV = 'WEB_SEARCH_ENHANCED_API'
/** Settings namespace paired with the plugin configuration card. */
export const SETTINGS_NAMESPACE = 'web-search-enhanced'
/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-enhanced'
/** The web seam this provider contributes to. */
export const inject = ['web']

/** Host configuration. Values may be overridden live from the Web Profile settings card. */
export interface Config {
  providerId?: string
  modelMode?: ModelMode
  protocol?: SearchProtocol
  baseURL?: string
  model?: string
  fallbackModel?: string
  apiKey?: string
  apiKeyEnv?: string
  apiVersion?: string
  toolIdentifier?: string
  maxTokens?: number
  maxUses?: number
  chatSearchMode?: ChatSearchMode
  searchContextSize?: SearchContextSize
}

/** Schema shared by composition defaults and the live settings section. */
export const Config: z<Config> = z.object({
  providerId: z.string().default(DEFAULT_PROVIDER_ID),
  modelMode: z.union(['configured', 'current-session'] as const).default('configured'),
  protocol: z.union(['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const).default('anthropic-messages'),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  model: z.string().default(DEFAULT_MODEL),
  fallbackModel: z.string(),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  apiVersion: z.string().default('2023-06-01'),
  toolIdentifier: z.string(),
  maxTokens: z.number().step(1).min(1).default(4096),
  maxUses: z.number().step(1).min(1).default(5),
  chatSearchMode: z.union(['search-model', 'vendor-options'] as const).default('search-model'),
  searchContextSize: z.union(['low', 'medium', 'high'] as const),
})

/** Resolve and validate one fixed/fallback route. */
export function resolveConfig(config: Config): ResolvedConfig {
  const protocol = config.protocol ?? 'anthropic-messages'
  const model = config.model ?? DEFAULT_MODEL
  const resolved: ResolvedConfig = {
    providerId: config.providerId ?? DEFAULT_PROVIDER_ID,
    modelMode: config.modelMode ?? 'configured',
    protocol,
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
    model,
    fallbackModel: config.fallbackModel?.trim() || undefined,
    apiKey: config.apiKey,
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    apiVersion: config.apiVersion ?? '2023-06-01',
    toolIdentifier: config.toolIdentifier?.trim() || defaultToolIdentifier(protocol),
    maxTokens: config.maxTokens ?? 4096,
    maxUses: config.maxUses ?? 5,
    chatSearchMode: config.chatSearchMode ?? 'search-model',
    searchContextSize: config.searchContextSize,
  }
  assertResolvedConfig(resolved)
  return resolved
}

interface AgentSelection { provider?: string; model?: string }
interface RequestHeader { config?: AgentSelection }
interface AgentSession {
  requestHeader?: () => RequestHeader | undefined
  append?: (type: string, data: unknown) => unknown
}
interface Initiator { options?: AgentSelection; session?: AgentSession }
interface AgentsService { currentInitiator?: () => Initiator | undefined }
interface DefaultModelService { currentSelection?: () => AgentSelection | undefined }
interface SettingsService { get: (namespace: string) => unknown }
interface LlmService { resolveModelInfo?: (provider: string, model: string) => Promise<{ api?: string } | undefined> }
interface RouteProfile { api?: string; baseURL?: string; apiKeyEnv?: string }
interface LlmSettings { providers?: Record<string, RouteProfile | undefined> }

function contextService<T>(ctx: Context, name: string): T | undefined {
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name]
    if (direct !== undefined) return direct as T
  } catch {
    // Optional services may throw before they are registered.
  }
  return typeof ctx.get === 'function' ? ctx.get(name) as T | undefined : undefined
}

function currentSelection(ctx: Context): AgentSelection | undefined {
  const initiator = contextService<AgentsService>(ctx, 'agents')?.currentInitiator?.()
  const requestSelection = initiator?.session?.requestHeader?.()?.config
  if (requestSelection?.provider && requestSelection.model) return requestSelection
  if (initiator?.options?.provider && initiator.options.model) return initiator.options
  return contextService<DefaultModelService>(ctx, 'agentDefaultModel')?.currentSelection?.()
}

function routeProfile(ctx: Context, provider: string): RouteProfile | undefined {
  const settings = contextService<SettingsService>(ctx, 'settings')
  const value = settings?.get('llm-pi-ai') as LlmSettings | undefined
  return value?.providers?.[provider]
}

function searchProtocolOf(api: unknown): SearchProtocol | undefined {
  switch (api) {
    case 'anthropic-messages': return 'anthropic-messages'
    case 'openai-responses': return 'openai-responses'
    case 'openai-completions':
    case 'openai-chat-completions': return 'openai-chat-completions'
    default: return undefined
  }
}

/**
 * Resolve the current Session route at search time. The fixed route is also the
 * fallback route, so a configured fallback remains useful outside an Agent turn.
 */
export async function resolveRuntimeConfig(ctx: Context, config: Config): Promise<ResolvedConfig> {
  const requestedMode = config.modelMode ?? 'configured'
  const fixed = resolveConfig({ ...config, modelMode: 'configured' })
  const fallback = fixed.fallbackModel === undefined
    ? fixed
    : resolveConfig({ ...config, modelMode: 'configured', model: fixed.fallbackModel })
  if (requestedMode === 'configured') return fixed

  const selection = currentSelection(ctx)
  if (!selection?.provider || !selection.model) return fallback
  const route = routeProfile(ctx, selection.provider)
  const llm = contextService<LlmService>(ctx, 'llm')
  let modelInfo: { api?: string } | undefined
  try {
    modelInfo = await llm?.resolveModelInfo?.(selection.provider, selection.model)
  } catch {
    return fallback
  }
  const protocol = searchProtocolOf(modelInfo?.api ?? route?.api)
  if (protocol === undefined || route?.baseURL === undefined || route.baseURL.length === 0) return fallback

  const { apiKey: _literalApiKey, ...withoutLiteralKey } = config
  return resolveConfig({
    ...withoutLiteralKey,
    modelMode: 'configured',
    model: selection.model,
    protocol,
    baseURL: route.baseURL,
    apiKeyEnv: route.apiKeyEnv ?? fixed.apiKeyEnv,
  })
}

/** Construct a fixed-config provider for tests or custom compositions. */
export function createProvider(
  config: Config = {},
  fetcher: typeof fetch = globalThis.fetch,
  recordRequest?: (record: SearchWireRecord) => void,
): EnhancedSearchProvider {
  const resolved = resolveConfig(config)
  return new EnhancedSearchProvider(() => resolved, fetcher, async c => c.apiKey ?? process.env[c.apiKeyEnv], recordRequest)
}

function installPluginSettings(
  ctx: Context,
  ns: string,
  schema: z<Config>,
  entry: Config,
  hooks: {
    setSource: (source: () => Config) => void
    onChange: () => void
    validate?: (value: Config) => void
  },
): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings as unknown as {
      installSection?: (owner: Context, ns: string, schema: z<Config>, entry: Config, hooks: unknown) => void
      register?: (ns: unknown, schema: z<Config>, options?: unknown) => { get: () => Config; watch: (cb: () => void) => () => void }
    }
    if (typeof settings?.installSection === 'function') {
      settings.installSection(ctx, ns, schema, entry, hooks)
    } else if (typeof settings?.register === 'function') {
      const scope = settings.register(ns, schema, {
        base: entry,
        ...(hooks.validate === undefined ? {} : { validate: hooks.validate }),
      })
      hooks.setSource(() => scope.get())
      hooks.onChange()
      scope.watch(() => {
        hooks.onChange()
      })
    }
  })
}

/** Register the provider and its live Web Profile settings section. */
export function apply(ctx: Context, config: Config): void {
  const providerId = resolveConfig(config).providerId
  let current: () => Config = () => config
  installPluginSettings(ctx, SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
    validate: (value) => {
      const resolved = resolveConfig(value)
      if (resolved.providerId !== providerId) {
        throw new Error('dsh-web-search-enhanced: providerId cannot be changed through live settings')
      }
    },
  })
  const dynamicProvider: WebSearchProvider = {
    id: providerId,
    available: () => {
      try { resolveConfig(current()); return true } catch { return false }
    },
    search: async (request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> => {
      const resolved = await resolveRuntimeConfig(ctx, current())
      return await new EnhancedSearchProvider(
        () => resolved,
        globalThis.fetch,
        async (runtime) => {
          if (runtime.apiKey !== undefined && runtime.apiKey.length > 0) return runtime.apiKey
          const ref = credentialRef(runtime.apiKeyEnv)
          const credentials = ctx.get('credentials')
          if (credentials !== undefined) {
            const resolvedValue = (await credentials.resolve(ref))?.value
            if (resolvedValue !== undefined && resolvedValue.length > 0) return resolvedValue
          }
          const ambient = launchEnvironmentOf(ctx).get(runtime.apiKeyEnv)?.value
          if (ambient !== undefined && ambient.length > 0) return ambient
          if (runtime.apiKeyEnv === DEFAULT_API_KEY_ENV && runtime.baseURL.includes('deepseek.com')) {
            const dsRef = credentialRef('DEEPSEEK_API_KEY')
            if (credentials !== undefined) {
              const dsVal = (await credentials.resolve(dsRef))?.value
              if (dsVal !== undefined && dsVal.length > 0) return dsVal
            }
            const dsAmbient = launchEnvironmentOf(ctx).get('DEEPSEEK_API_KEY')?.value
            if (dsAmbient !== undefined && dsAmbient.length > 0) return dsAmbient
          }
          return undefined
        },
        (record) => {
          try {
            const initiator = contextService<AgentsService>(ctx, 'agents')?.currentInitiator?.()
            initiator?.session?.append?.('web/deepseek-search-llm-request', {
              endpoint: record.endpoint,
              apiVersion: record.apiVersion ?? '2023-06-01',
              body: record.body,
            })
          } catch {
            // Logging failure should never block or fail the search request
          }
        },
      ).search(request, signal)
    },
  }
  ctx.web.registerSearchProvider(dynamicProvider)
}

function assertResolvedConfig(config: ResolvedConfig): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(config.providerId)) {
    throw new Error('dsh-web-search-enhanced: providerId must be 1-128 letters, digits, dots, underscores, or hyphens')
  }
  if (!URL.canParse(config.baseURL)) throw new Error('dsh-web-search-enhanced: baseURL must be an absolute URL')
  const endpointBase = new URL(config.baseURL)
  if (endpointBase.protocol !== 'http:' && endpointBase.protocol !== 'https:') throw new Error('dsh-web-search-enhanced: baseURL protocol must be HTTP or HTTPS')
  if (endpointBase.username.length > 0 || endpointBase.password.length > 0 || endpointBase.search.length > 0 || endpointBase.hash.length > 0) {
    throw new Error('dsh-web-search-enhanced: baseURL must not contain credentials, query parameters, or a fragment')
  }
  if (config.model.trim().length === 0) throw new Error('dsh-web-search-enhanced: model must not be blank')
  if (config.fallbackModel !== undefined && config.fallbackModel.trim().length === 0) throw new Error('dsh-web-search-enhanced: fallbackModel must not be blank when provided')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(config.apiKeyEnv)) throw new Error('dsh-web-search-enhanced: apiKeyEnv must be a valid credential reference')
  if (config.apiVersion.trim().length === 0) throw new Error('dsh-web-search-enhanced: apiVersion must not be blank')
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(config.toolIdentifier)) {
    throw new Error('dsh-web-search-enhanced: toolIdentifier must be 1-128 identifier characters and start with a letter')
  }
  if (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0) throw new Error('dsh-web-search-enhanced: maxTokens must be a positive integer')
  if (!Number.isInteger(config.maxUses) || config.maxUses <= 0) throw new Error('dsh-web-search-enhanced: maxUses must be a positive integer')
}

export { EnhancedSearchProvider } from './provider.ts'
export type { ChatSearchMode, ModelMode, ResolvedConfig, SearchContextSize, SearchProtocol, SearchWireRecord } from './protocols.ts'
