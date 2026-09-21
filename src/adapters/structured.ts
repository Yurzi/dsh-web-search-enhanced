import { WebError } from '@deepseek-ai/dsh-web'
import { freshnessDiagnostic, type FreshnessDiagnostic } from '../search/diagnostics.ts'
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

export type StructuredAdapter = 'firecrawl' | 'exa' | 'tavily' | 'tinyfish'
type Freshness = 'auto' | 'fresh' | 'realtime'
const MAX_BYTES = 2 * 1024 * 1024
const SNIPPET_LENGTH = 4000
const TIMEOUT_MS = 90_000
const safeErrors = new WeakSet<Error>()

function failure(message: string, code = 'WEB_PROVIDER_ERROR'): WebError {
  // Never retain upstream bodies, exception causes, query URLs, or abort reasons.
  const error = new WebError('dsh-web-search-enhanced: ' + message, code)
  safeErrors.add(error)
  return error
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw failure('invalid structured response')
  return value as Record<string, unknown>
}

/** Narrow first-release options; counts and content-cache controls are owned by the adapter. */
export function validateStructuredOptions(adapter: StructuredAdapter, options: unknown = {}): Record<string, unknown> {
  const rules: Record<StructuredAdapter, Record<string, RegExp | readonly string[] | 'boolean'>> = {
    firecrawl: { country: /^[A-Za-z]{2}$/, location: /^[^\x00-\x1f]{1,200}$/, safe: 'boolean' },
    exa: { type: ['auto', 'fast', 'instant'] },
    tavily: { search_depth: ['basic', 'advanced', 'fast', 'ultra-fast'], topic: ['general', 'news', 'finance'] },
    tinyfish: { location: /^[A-Za-z]{2}$/, language: /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/, purpose: /^[^\x00-\x1f]{1,2000}$/, domain_type: ['web', 'news', 'research_paper'] },
  }
  if (!Object.hasOwn(rules, adapter) || typeof options !== 'object' || options === null || Array.isArray(options)) throw failure('invalid structured options')
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options)) {
    const rule = Object.hasOwn(rules[adapter], key) ? rules[adapter][key] : undefined
    const valid = rule === 'boolean' ? typeof value === 'boolean'
      : rule instanceof RegExp ? typeof value === 'string' && rule.test(value)
        : Array.isArray(rule) && typeof value === 'string' && rule.includes(value)
    if (!valid) throw failure('unsupported or invalid structured option')
    result[key] = value
  }
  return result
}

/** Search only the selected API. No retries, pagination, fallback, or generated summary. */
export async function searchStructured(
  adapter: StructuredAdapter,
  request: WebSearchRequest,
  config: { endpoint: string; options?: Record<string, unknown> },
  context: { freshness: Freshness; apiKey?: string; keyless?: boolean; signal?: AbortSignal; fetcher?: typeof fetch; diagnose?: (facts: FreshnessDiagnostic) => void },
): Promise<WebSearchResult> {
  if (context.signal?.aborted) throw failure('search aborted', 'WEB_ABORTED')
  const options = validateStructuredOptions(adapter, config.options)
  if (!['auto', 'fresh', 'realtime'].includes(context.freshness)) throw failure('invalid freshness')
  let endpoint: URL
  try { endpoint = new URL(config.endpoint) } catch { throw failure('invalid search endpoint') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw failure('invalid search endpoint')
  if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > (adapter === 'firecrawl' ? 500 : 10_000)) throw failure('invalid search query')
  if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 0)) throw failure('invalid result limit')
  const anonymous = context.keyless === true
  const keylessEndpoints: Partial<Record<StructuredAdapter, string>> = { firecrawl: 'https://api.firecrawl.dev/v2/search', tavily: 'https://api.tavily.com/search' }
  if (anonymous && (endpoint.href !== keylessEndpoints[adapter] || context.apiKey !== undefined)) throw failure('invalid keyless REST route')
  if (!anonymous && (typeof context.apiKey !== 'string' || !context.apiKey.trim() || /[\r\n]/.test(context.apiKey))) throw failure('missing or invalid API key', 'WEB_PROVIDER_CREDENTIAL_MISSING')
  if (request.maxResults === 0) return { sources: [], truncated: false }
  const limit = request.maxResults === undefined ? undefined : Math.min(request.maxResults, adapter === 'tavily' ? 20 : 100)
  const headers: Record<string, string> = { accept: 'application/json' }
  const body: Record<string, unknown> = { ...options, query: request.query }
  if (anonymous && adapter === 'tavily') headers['x-tavily-access-mode'] = 'keyless'
  if (adapter === 'exa' || adapter === 'tinyfish') headers['x-api-key'] = context.apiKey ?? ''
  else if (context.apiKey) headers.authorization = 'Bearer ' + context.apiKey
  if (adapter === 'firecrawl') {
    body.sources = [{ type: 'web' }]
    if (limit !== undefined) body.limit = limit
    if (context.freshness !== 'auto') body.scrapeOptions = { formats: [{ type: 'markdown' }], maxAge: context.freshness === 'fresh' ? 86_400_000 : 0 }
  } else if (adapter === 'exa') {
    if (limit !== undefined) body.numResults = limit
    // Bounded source text avoids requesting a generated summary/highlight synthesis.
    body.contents = { text: { maxCharacters: SNIPPET_LENGTH }, ...(context.freshness === 'auto' ? {} : { maxAgeHours: context.freshness === 'fresh' ? 24 : 0 }) }
  } else if (adapter === 'tavily') {
    if (limit !== undefined) body.max_results = limit
    body.include_answer = false
    body.include_raw_content = false
  } else {
    endpoint.searchParams.set('query', request.query)
    endpoint.searchParams.set('page', '0')
    for (const [key, value] of Object.entries(options)) endpoint.searchParams.set(key, String(value))
  }
  const init: RequestInit = { method: adapter === 'tinyfish' ? 'GET' : 'POST', headers }
  if (adapter !== 'tinyfish') { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body) }
  const payload = await fetchJson(endpoint.toString(), init, context.signal, context.fetcher)
  const result = normalize(adapter, payload, request.maxResults, context.freshness)
  context.diagnose?.(freshnessDiagnostic(context.freshness, adapter === 'firecrawl' || adapter === 'exa', result.sources.map(s => s.snippet)))
  return result
}

/** Shared bounded JSON transport. The caller owns trusted endpoint/credential binding. */
export async function fetchJson(endpoint: string, init: RequestInit, signal?: AbortSignal, fetcher: typeof fetch = globalThis.fetch): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, TIMEOUT_MS)
  const aborted = () => failure(timedOut ? 'search timed out' : 'search aborted', timedOut ? 'WEB_PROVIDER_TIMEOUT' : 'WEB_ABORTED')
  let response: Response | undefined
  try {
    if (controller.signal.aborted) throw aborted()
    const pending = fetcher(endpoint, { ...init, redirect: 'error', signal: controller.signal })
    // If an injected transport ignores cancellation, release its late response as well.
    void pending.then(r => { if (controller.signal.aborted) void r.body?.cancel().catch(() => {}) }, () => {})
    response = await cancellable(pending, controller.signal, aborted)
    if (!response.ok) {
      const status = response.status
      const code = status === 401 || status === 403 ? 'WEB_PROVIDER_AUTH_ERROR' : status === 402 ? 'WEB_PROVIDER_ACCESS_ERROR' : status === 429 ? 'WEB_PROVIDER_RATE_LIMITED' : 'WEB_PROVIDER_ERROR'
      throw failure('search failed (HTTP ' + status + ')', code)
    }
    return await readJson(response, controller.signal, aborted)
  } catch (error) {
    if (controller.signal.aborted) throw aborted()
    if (error instanceof Error && safeErrors.has(error)) throw error
    throw failure('search transport or response failed')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {})
  }
}

async function cancellable<T>(pending: Promise<T>, signal: AbortSignal, aborted: () => WebError): Promise<T> {
  if (signal.aborted) throw aborted()
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted())
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort)).catch(() => {})
  })
}
async function readJson(response: Response, signal: AbortSignal, aborted: () => WebError): Promise<unknown> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > MAX_BYTES) throw failure('structured response exceeds size limit')
  if (!response.body) throw failure('empty structured response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const item = await cancellable(reader.read(), signal, aborted)
      if (item.done) break
      size += item.value.byteLength
      if (size > MAX_BYTES) throw failure('structured response exceeds size limit')
      chunks.push(item.value)
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown } catch { throw failure('invalid structured JSON response') }
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw failure('invalid structured response field')
  return value.trim() || undefined
}
function normalize(adapter: StructuredAdapter, payload: unknown, limit: number | undefined, freshness: Freshness): WebSearchResult {
  const root = record(payload)
  if (root.error != null || root.success === false) throw failure(adapter + ' returned an API error')
  if (adapter === 'firecrawl' && root.success !== true) throw failure('invalid Firecrawl success envelope')
  const rows = adapter === 'firecrawl' ? record(root.data).web : root.results
  if (!Array.isArray(rows)) throw failure('structured response missing results array')
  const sources: WebSearchSource[] = rows.map(value => {
    const row = record(value)
    const url = text(row.url)
    if (!url || url.length > 8192) throw failure('invalid structured source URL')
    let parsed: URL
    try { parsed = new URL(url) } catch { throw failure('invalid structured source URL') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw failure('invalid structured source URL')
    const title = text(row.title)
    let snippet: string | undefined
    let date: string | undefined
    if (adapter === 'firecrawl') {
      const description = text(row.description)
      const markdown = text(row.markdown)
      // Missing scrape content remains missing: never label an old SERP snippet as fresh.
      snippet = freshness === 'auto' ? description : markdown
    } else if (adapter === 'exa') {
      const content = text(row.text)
      let highlights: string | undefined
      if (row.highlights != null) {
        if (!Array.isArray(row.highlights) || row.highlights.some(x => typeof x !== 'string')) throw failure('invalid Exa highlights')
        highlights = row.highlights.join('\n').trim() || undefined
      }
      snippet = content ?? highlights
      date = text(row.publishedDate)
    } else if (adapter === 'tavily') {
      snippet = text(row.content)
      // published_date is an estimated published-or-updated date, not a reliable publication timestamp.
    } else {
      snippet = text(row.snippet)
      date = text(row.date)
    }
    const iso = date && /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(date) && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined
    return { url, ...(title ? { title: title.slice(0, 1000) } : {}), ...(snippet ? { snippet: snippet.slice(0, SNIPPET_LENGTH) } : {}), ...(iso ? { publishedAt: iso } : {}) }
  })
  return { sources: limit === undefined ? sources : sources.slice(0, limit), truncated: limit !== undefined && sources.length > limit }
}
