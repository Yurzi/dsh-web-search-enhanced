import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { buildWireRequest, parseSearchResponse } from './protocols.ts'
import type { ResolvedConfig } from './protocols.ts'

/** Multi-protocol search provider. One resolved settings snapshot serves each operation. */
export class EnhancedSearchProvider implements WebSearchProvider {
  /** Stable provider id selected by ctx.web. */
  readonly id: string

  /** Create a provider backed by a dynamic settings resolver. */
  constructor(
    private readonly resolveConfig: () => ResolvedConfig,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly resolveApiKey: (config: ResolvedConfig) => Promise<string | undefined> = async config => config.apiKey ?? process.env[config.apiKeyEnv],
  ) {
    this.id = resolveConfig().providerId
  }

  /** Report whether local configuration can attempt a request without network I/O. */
  available(): boolean {
    try {
      const config = this.resolveConfig()
      return URL.canParse(config.baseURL)
        && config.model.length > 0
        && config.apiKeyEnv.length > 0
        && Number.isInteger(config.maxTokens)
        && config.maxTokens > 0
    } catch {
      return false
    }
  }

  /** Execute one server-side web search and normalize its citations. */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const config = this.resolveConfig()
    throwIfAborted(signal)
    const apiKey = config.apiKey ?? await resolveCredential(this.resolveApiKey(config), signal)
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError(
        `dsh-web-search-enhanced: no API key for "${config.apiKeyEnv}"`,
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      )
    }
    const wire = buildWireRequest(config, request.query, apiKey)
    let response: Response
    try {
      response = await this.fetcher(wire.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: wire.headers,
        body: JSON.stringify(wire.body),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      throw searchEndpointError(
        wire.endpoint,
        config.apiKeyEnv,
        `dsh-web-search-enhanced: ${config.protocol} request failed: ${String(error)}`,
        error,
      )
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const payload = await response.json() as unknown
        const root = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : undefined
        const error = typeof root?.error === 'object' && root.error !== null ? root.error as Record<string, unknown> : undefined
        const candidate = error?.message ?? (typeof error === 'string' ? error : undefined) ?? root?.message
        if (typeof candidate === 'string' && candidate.length > 0) detail = `${detail}: ${candidate}`
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      }
      throw searchEndpointError(
        wire.endpoint,
        config.apiKeyEnv,
        `dsh-web-search-enhanced: upstream API error (${detail})`,
      )
    }
    try {
      const payload = await response.json() as unknown
      return parseSearchResponse(config.protocol, payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
      const message = error instanceof WebError
        ? error.message
        : `dsh-web-search-enhanced: unprocessable ${config.protocol} response: ${String(error)}`
      throw searchEndpointError(wire.endpoint, config.apiKeyEnv, message, error)
    }
  }
}

async function resolveCredential(pending: Promise<string | undefined>, signal?: AbortSignal): Promise<string | undefined> {
  if (signal === undefined) return await pending
  throwIfAborted(signal)
  return await new Promise<string | undefined>((resolve, reject) => {
    const onAbort = () => { reject(aborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/** Add endpoint recovery instructions to failures that occur after request dispatch begins. */
function searchEndpointError(endpoint: string, apiKeyEnv: string, message: string, cause?: unknown): WebError {
  return new WebError(
    `${message}\n\nThe web search request used endpoint ${JSON.stringify(endpoint)}. `
    + 'Search endpoint configuration is separate from chat. If that endpoint is not intended, '
    + 'guide the user to Settings > Plugins > Plugin configuration > Web Search Enhanced, where they can '
    + 'change and save Endpoint base URL. If that settings page is unavailable, the user can set '
    + `${apiKeyEnv.length > 0 ? apiKeyEnv : 'WEB_SEARCH_ENHANCED_API'} or configure web-search-enhanced.baseURL to a trusted `
    + 'search endpoint. Only the user should choose or change the endpoint.',
    'WEB_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted === true) throw aborted(signal) }
function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('dsh-web-search-enhanced: search aborted', 'WEB_ABORTED', { cause: signal?.aborted === true ? signal.reason : fallback })
}
function isAbortError(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError' }
