/**
 * Multi-protocol web search provider for DeepSeek Harness.
 * @module dsh-web-search-enhanced
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { EnhancedSearchProvider } from './provider.ts'
import { defaultToolIdentifier } from './protocols.ts'
import type { ChatSearchMode, ResolvedConfig, SearchContextSize, SearchProtocol } from './protocols.ts'

/** Provider id selected by the bundled Web Profile patch. */
export const DEFAULT_PROVIDER_ID = 'enhanced-search'
/** Default Anthropic-compatible search endpoint. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'
/** Default model aligned with DSH's built-in search provider. */
export const DEFAULT_MODEL = 'deepseek-v4-flash'
/** Settings namespace paired with the plugin configuration card. */
export const SETTINGS_NAMESPACE = settingsNamespace('web-search-enhanced')
/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-enhanced'
/** The web seam this provider contributes to. */
export const inject = ['web']

/** Host configuration. Values may be overridden live from the Web Profile settings card. */
export interface Config {
  providerId?: string
  protocol?: SearchProtocol
  baseURL?: string
  model?: string
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
  protocol: z.union(['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const).default('anthropic-messages'),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  model: z.string().default(DEFAULT_MODEL),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default('DEEPSEEK_API_KEY'),
  apiVersion: z.string().default('2023-06-01'),
  toolIdentifier: z.string(),
  maxTokens: z.number().step(1).min(1).default(4096),
  maxUses: z.number().step(1).min(1).default(5),
  chatSearchMode: z.union(['search-model', 'vendor-options'] as const).default('search-model'),
  searchContextSize: z.union(['low', 'medium', 'high'] as const),
})

/** Resolve and validate all deployment choices before one provider operation. */
export function resolveConfig(config: Config): ResolvedConfig {
  const protocol = config.protocol ?? 'anthropic-messages'
  const resolved: ResolvedConfig = {
    providerId: config.providerId ?? DEFAULT_PROVIDER_ID,
    protocol,
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
    model: config.model ?? DEFAULT_MODEL,
    apiKey: config.apiKey,
    apiKeyEnv: config.apiKeyEnv ?? 'DEEPSEEK_API_KEY',
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

/** Construct a fixed-config provider for tests or custom compositions. */
export function createProvider(config: Config = {}, fetcher: typeof fetch = globalThis.fetch): EnhancedSearchProvider {
  const resolved = resolveConfig(config)
  return new EnhancedSearchProvider(() => resolved, fetcher)
}

/** Register the provider and its live Web Profile settings section. */
export function apply(ctx: Context, config: Config): void {
  const providerId = resolveConfig(config).providerId
  let current: () => Config = () => config
  installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
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
      return await new EnhancedSearchProvider(
        () => resolveConfig(current()),
        globalThis.fetch,
        async (resolved) => {
          if (resolved.apiKey !== undefined && resolved.apiKey.length > 0) return resolved.apiKey
          const ref = credentialRef(resolved.apiKeyEnv)
          const credentials = ctx.get('credentials')
          if (credentials !== undefined) return (await credentials.resolve(ref))?.value
          return launchEnvironmentOf(ctx).get(resolved.apiKeyEnv)?.value
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
  if (config.apiKeyEnv.trim().length === 0) throw new Error('dsh-web-search-enhanced: apiKeyEnv must not be blank')
  if (config.apiVersion.trim().length === 0) throw new Error('dsh-web-search-enhanced: apiVersion must not be blank')
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(config.toolIdentifier)) {
    throw new Error('dsh-web-search-enhanced: toolIdentifier must be 1-128 identifier characters and start with a letter')
  }
  if (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0) throw new Error('dsh-web-search-enhanced: maxTokens must be a positive integer')
  if (!Number.isInteger(config.maxUses) || config.maxUses <= 0) throw new Error('dsh-web-search-enhanced: maxUses must be a positive integer')
}

export { EnhancedSearchProvider } from './provider.ts'
export type { ChatSearchMode, ResolvedConfig, SearchContextSize, SearchProtocol } from './protocols.ts'
