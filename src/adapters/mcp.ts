import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { validateStructuredOptions } from './structured.ts'

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 90_000
const PROTOCOL = '2025-06-18'
const fail = (message: string, code = 'WEB_PROVIDER_ERROR') => new WebError('dsh-web-search-enhanced: ' + message, code)
const aborted = () => fail('search aborted', 'WEB_ABORTED')

// Bound injected fetchers/readers even when they do not observe AbortSignal.
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted())
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) { reject(aborted()); return }
    signal.addEventListener('abort', abort, { once: true })
  })
}
function envelope(value: any, id: number): any {
  const message = (Array.isArray(value) ? value : [value]).find(x => x?.id === id)
  if (!message) return undefined
  if (message.jsonrpc !== '2.0' || message.error || !message.result || typeof message.result !== 'object') throw fail('invalid MCP response')
  return message.result
}

async function readResult(response: Response, id: number, signal: AbortSignal): Promise<any> {
  const reader = response.body?.getReader()
  if (!reader) throw fail('empty MCP response')
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw fail('keyless search response too large')
    const sse = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
    const decoder = new TextDecoder()
    let bytes = 0, buffer = ''
    const event = (block: string) => {
      const data = block.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, '')).join('\n')
      if (!data || data === '[DONE]') return undefined
      return envelope(JSON.parse(data), id)
    }
    while (true) {
      const chunk = await untilAbort(reader.read(), signal)
      if (signal.aborted) throw aborted()
      if (chunk.value) {
        bytes += chunk.value.byteLength
        if (bytes > MAX_BYTES) throw fail('keyless search response too large')
        buffer += decoder.decode(chunk.value, { stream: true })
      }
      if (chunk.done) buffer += decoder.decode()
      if (sse) {
        let boundary: RegExpExecArray | null
        while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
          const result = event(buffer.slice(0, boundary.index))
          buffer = buffer.slice(boundary.index + boundary[0].length)
          if (result !== undefined) return result
        }
        if (chunk.done && buffer.trim()) {
          const result = event(buffer)
          if (result !== undefined) return result
        }
      } else if (chunk.done) {
        const result = envelope(JSON.parse(buffer), id)
        if (result !== undefined) return result
      }
      if (chunk.done) throw fail('missing matching MCP response')
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel() // Never await an uncooperative stream's cancellation promise.
  }
}

async function call(url: string, tool: string, args: Record<string, unknown>, signal: AbortSignal | undefined, fetcher: typeof fetch, tinyfish = false): Promise<any> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(abort, TIMEOUT_MS)
  const post = async (body: Record<string, unknown>, session?: string, protocol?: string) => {
    if (controller.signal.aborted) throw aborted()
    const pending = fetcher(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json',
        ...(tinyfish ? { 'X-TinyFish-Access-Mode': 'keyless' } : {}),
        ...(session ? { 'Mcp-Session-Id': session } : {}), ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}) },
      body: JSON.stringify(body),
    })
    // Dispose responses arriving after cancellation, including from injected fetchers.
    void pending.then(r => { if (controller.signal.aborted) void r.body?.cancel().catch(() => {}) }, () => {})
    const response = await untilAbort(pending, controller.signal)
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw fail('keyless search HTTP ' + response.status, response.status === 429 ? 'WEB_PROVIDER_RATE_LIMITED' : response.status === 401 || response.status === 403 ? 'WEB_KEYLESS_UNAVAILABLE' : 'WEB_PROVIDER_ERROR')
    }
    if (body.id === undefined) {
      void response.body?.cancel().catch(() => {})
      return { response, value: undefined }
    }
    return { response, value: await readResult(response, body.id as number, controller.signal) }
  }
  try {
    // Tinyfish's public keyless route uses a stateless tools/call (OpenCode v2).
    if (tinyfish) {
      const result = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
      if (result.value.isError) throw fail('keyless search tool failed')
      return result.value
    }
    // Session state never escapes this operation. No retries on protocol/tool errors.
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dsh-web-search-enhanced', version: '0.0.6' },
    } })
    const session = init.response.headers.get('Mcp-Session-Id') ?? undefined
    const protocol = typeof init.value.protocolVersion === 'string' ? init.value.protocolVersion : PROTOCOL
    await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, session, protocol)
    const result = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }, session, protocol)
    if (result.value.isError) throw fail('keyless search tool failed')
    return result.value
  } catch (error) {
    // Never propagate provider bodies, JSON parser input, fetch errors or their causes.
    if (controller.signal.aborted) throw aborted()
    if (error instanceof WebError && error.code === 'WEB_KEYLESS_UNAVAILABLE') throw fail('所选服务拒绝免 Key 访问；请显式切换个人 API Key 或选择其他连接', 'WEB_KEYLESS_UNAVAILABLE')
    if (error instanceof WebError && error.code === 'WEB_PROVIDER_RATE_LIMITED') throw fail('keyless search rate limited', 'WEB_PROVIDER_RATE_LIMITED')
    throw fail('keyless search transport or MCP failure')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}
function rows(value: any): any[] | undefined {
  if (Array.isArray(value)) return value
  for (const candidate of [value?.results, value?.web, value?.data?.web, value?.data]) {
    if (Array.isArray(candidate)) return candidate
  }
  return undefined
}
function exaRows(value: string): any[] {
  return value.split(/(?=^Title:[ \t]*)/m).flatMap(block => {
    const field = (name: string) => new RegExp('^' + name + ':[ \\t]*(.*)$', 'm').exec(block)?.[1]?.trim()
    const url = field('URL')
    if (!url) return []
    const snippet = /^(?:Text|Highlights):[ \t]*([\s\S]*)/m.exec(block)?.[1]?.replace(/\n\s*---\s*$/, '').trim()
    return [{ url, title: field('Title'), publishedAt: field('Published(?: Date)?'), snippet }]
  })
}
function sources(value: any, adapter: 'exa' | 'firecrawl' | 'tinyfish'): WebSearchSource[] {
  let candidates = rows(value.structuredContent) ?? rows(value)
  if (!candidates) {
    let recognized = false
    candidates = (Array.isArray(value.content) ? value.content : []).flatMap((part: any) => {
      if (part?.type !== 'text' || typeof part.text !== 'string') return []
      try { const parsed = rows(JSON.parse(part.text)); if (parsed) recognized = true; return parsed ?? [] }
      catch {
        const parsed = adapter === 'exa' ? exaRows(part.text) : []
        if (parsed.length || /^No (?:search )?results (?:found|returned)/i.test(part.text.trim())) recognized = true
        return parsed
      }
    })
    if (!recognized) throw fail('keyless search returned an unsupported result format', 'WEB_PROVIDER_RESPONSE_INVALID')
  }
  const seen = new Set<string>()
  return (candidates ?? []).flatMap((row: any) => {
    const url = text(row?.url, 8193)
    if (!url || url.length > 8192 || /[\u0000-\u0020\u007f]/.test(url)) return []
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || seen.has(parsed.href)) return []
      seen.add(parsed.href)
    } catch { return [] }
    const title = text(row.title, 1000)
    const snippet = text(row.snippet ?? row.description ?? row.text ?? row.markdown ?? (Array.isArray(row.highlights) ? row.highlights.join('\n') : undefined), 4000)
    const publishedAt = text(row.publishedAt ?? row.publishedDate, 100)
    return [{ url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}), ...(publishedAt ? { publishedAt } : {}) }]
  })
}

export async function searchKeyless(adapter: 'exa' | 'firecrawl' | 'tinyfish', request: WebSearchRequest, signal?: AbortSignal, fetcher: typeof fetch = fetch, options: Record<string, unknown> = {}): Promise<WebSearchResult> {
  if (signal?.aborted) throw aborted()
  if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > (adapter === 'tinyfish' ? 2000 : 10_000)) throw fail('invalid search query')
  if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 0)) throw fail('invalid result limit')
  if (adapter === 'tinyfish' && options.domain_type === 'research_paper') throw fail('Tinyfish keyless supports web/news only; use API Key mode for research_paper')
  if (request.maxResults === 0) return { sources: [], truncated: false }
  // Tinyfish's search tool supports the same scoped search options, but no count parameter.
  // Apply maxResults locally; never invent content freshness controls.
  const args = adapter === 'tinyfish'
    ? { ...validateStructuredOptions('tinyfish', options), query: request.query }
    : { query: request.query, ...(request.maxResults === undefined ? {} : { [adapter === 'exa' ? 'numResults' : 'limit']: Math.min(request.maxResults, 100) }) }
  const routes = { exa: ['https://mcp.exa.ai/mcp', 'web_search_exa'], firecrawl: ['https://mcp.firecrawl.dev/v2/mcp', 'firecrawl_search'], tinyfish: ['https://agent.tinyfish.ai/mcp', 'search'] } as const
  const [url, tool] = routes[adapter]
  const result = await call(url, tool, args, signal, fetcher, adapter === 'tinyfish')
  const list = sources(result, adapter), limit = request.maxResults ?? list.length
  return { sources: list.slice(0, limit), truncated: list.length > limit }
}
