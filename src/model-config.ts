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
/** Construct a fixed-config provider for tests or custom compositions. */
export function createProvider(
  config: Config = {},
  fetcher: typeof fetch = globalThis.fetch,
  recordRequest?: (record: SearchWireRecord) => void,
): EnhancedSearchProvider {
  const resolved = resolveConfig(config)
  return new EnhancedSearchProvider(() => resolved, fetcher, async c => c.apiKey ?? process.env[c.apiKeyEnv], recordRequest)
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
