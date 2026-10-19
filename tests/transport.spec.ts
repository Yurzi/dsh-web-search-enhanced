/** The bounded HTTP transport and the keyless MCP client. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADAPTER_WIRES } from '../src/search/adapters/index.ts'
import { abortable } from '../src/search/errors.ts'
import { MAX_RESPONSE_BYTES, requestJson, TIMEOUT_MS, withDeadline, type HttpRequest, type Upstream } from '../src/search/http.ts'
import { callTool, type McpToolCall } from '../src/search/mcp.ts'

/** The error a promise rejects with. */
async function rejection(pending: Promise<unknown>): Promise<Error> {
  try {
    await pending
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const REQUEST: HttpRequest = { url: 'https://search.test/api', method: 'POST', headers: { 'content-type': 'application/json' }, body: { query: 'q' } }
const UPSTREAM: Upstream = { label: 'Fixture', access: 'api-key' }
const search = (signal?: AbortSignal, upstream = UPSTREAM) => withDeadline(signal, deadline => requestJson(REQUEST, deadline, upstream))

function stub(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(fetch)
  vi.stubGlobal('fetch', mock)
  return mock
}
/** A fetch that never answers but honors its signal, like the real one. */
const hanging = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init.signal!.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
})
/** A body that never yields a chunk; `cancel` records its release. */
function stalledBody() {
  const cancel = vi.fn()
  let pulled!: () => void
  const started = new Promise<void>(resolve => { pulled = resolve })
  const body = new ReadableStream<Uint8Array>({ pull: () => { pulled(); return new Promise(() => {}) }, cancel }, { highWaterMark: 0 })
  return { body, cancel, started }
}

describe('HTTP transport', () => {
  it('sends JSON, refuses redirects and parses the reply', async () => {
    const fetch = stub(async () => Response.json({ ok: true }))
    await expect(search()).resolves.toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(REQUEST.url)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', body: '{"query":"q"}' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports transport failures (including refused redirects) without their details', async () => {
    stub(async () => { throw new TypeError('redirect to https://secret.test?key=fixture-key') })
    const error = await rejection(search())
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('Fixture could not be reached') })
    expect(error.message).not.toMatch(/secret|fixture-key/)
    expect(error.cause).toBeUndefined()
  })

  it.each<[number, Upstream['access'], string]>([
    [401, 'api-key', 'WEB_PROVIDER_AUTH_ERROR'],
    [403, 'api-key', 'WEB_PROVIDER_AUTH_ERROR'],
    [401, 'keyless', 'WEB_KEYLESS_UNAVAILABLE'],
    [403, 'keyless', 'WEB_KEYLESS_UNAVAILABLE'],
    [401, 'account', 'WEB_PROVIDER_AUTH_ERROR'],
    [402, 'api-key', 'WEB_PROVIDER_ACCESS_ERROR'],
    [429, 'keyless', 'WEB_PROVIDER_RATE_LIMITED'],
    [500, 'api-key', 'WEB_PROVIDER_ERROR'],
  ])('maps HTTP %i (%s) to %s without reading the body', async (status, access, code) => {
    const cancel = vi.fn()
    stub(async () => new Response(new ReadableStream({ start: c => { c.enqueue(new TextEncoder().encode('private upstream body')) }, cancel }), { status }))
    const error = await rejection(search(undefined, { label: 'Fixture', access }))
    expect(error).toMatchObject({ code, message: expect.stringContaining(`HTTP ${status}`) })
    expect(error.message).not.toContain('private')
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects bodies that are not JSON without echoing them', async () => {
    stub(async () => new Response('private-invalid-json'))
    const error = await rejection(search())
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_RESPONSE_INVALID' })
    expect(error.message).not.toContain('private')
  })

  it('reports a body that breaks off without its cause', async () => {
    stub(async () => new Response(new ReadableStream({ pull: c => { c.error(new Error('secret socket detail')) } })))
    const error = await rejection(search())
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('broke off') })
    expect(error.message).not.toContain('secret')
    expect(error.cause).toBeUndefined()
  })

  it.each([true, false])('caps the body at 2 MiB (declared length: %s)', async declared => {
    const cancel = vi.fn()
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES / 2 + 1)
    const body = new ReadableStream<Uint8Array>({ pull: c => { c.enqueue(chunk) }, cancel })
    stub(async () => new Response(body, { headers: declared ? { 'content-length': String(MAX_RESPONSE_BYTES + 1) } : {} }))
    await expect(search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('exceeds 2 MiB') })
    if (!declared) expect(cancel).toHaveBeenCalled()
  })

  it('aborts a pending request and releases a stalled body', async () => {
    stub(hanging)
    const first = new AbortController()
    const pending = search(first.signal)
    first.abort('sensitive reason')
    const error = await rejection(pending)
    expect(error).toMatchObject({ code: 'WEB_ABORTED' })
    expect(error.message).not.toContain('sensitive')
    expect(error.cause).toBeUndefined()

    const { body, cancel, started } = stalledBody()
    stub(async () => new Response(body))
    const second = new AbortController()
    const reading = search(second.signal)
    await started
    second.abort()
    await expect(reading).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(cancel).toHaveBeenCalled()
  })

  it.each(['request', 'body'] as const)('times out a stalled %s after 90 s', async stall => {
    vi.useFakeTimers()
    const { body, cancel } = stalledBody()
    stub(stall === 'request' ? hanging : async () => new Response(body))
    const pending = expect(search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    await pending
    if (stall === 'body') expect(cancel).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('abortable', () => {
  it('observes work an already-cancelled search no longer waits for', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const late = Promise.withResolvers<never>()
      await expect(abortable(late.promise, AbortSignal.abort())).rejects.toMatchObject({ code: 'WEB_ABORTED' })
      late.reject(new Error('late failure'))
      await new Promise(resolve => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('MCP client', () => {
  const json = (body: unknown, headers: Record<string, string> = {}) => Response.json(body, { headers })
  const rpc = (result: unknown, id = 2) => json({ jsonrpc: '2.0', id, result })
  const SOURCE = { url: 'https://example.com', title: 'Example', snippet: 'evidence' }
  const CALL: McpToolCall = { url: 'https://mcp.test/mcp', tool: 'search', arguments: { query: 'q' }, handshake: true }
  const call = (overrides: Partial<McpToolCall> = {}) => withDeadline(undefined, signal => callTool({ ...CALL, ...overrides }, signal, { label: 'Fixture', access: 'keyless' }))
  /** A server that keeps a session: initialize, the initialized notification, then `final` for tools/call. */
  const server = (final: () => Response = () => rpc({ structuredContent: { results: [SOURCE] } })) => stub(async (_url, init) => {
    const { method } = JSON.parse(String(init.body)) as { method: string }
    if (method === 'initialize') return json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }, { 'mcp-session-id': 'session-fixture' })
    if (method === 'notifications/initialized') return new Response(null, { status: 202 })
    return final()
  })
  const bodies = (fetch: ReturnType<typeof stub>) => fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>)

  it('initializes a session, then calls the tool within it', async () => {
    const fetch = server()
    await expect(call()).resolves.toEqual({ structuredContent: { results: [SOURCE] } })
    expect(bodies(fetch).map(body => body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    expect(bodies(fetch)[2]).toEqual({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search', arguments: { query: 'q' } } })
    const headers = fetch.mock.calls.map(([, init]) => new Headers(init.headers))
    expect(headers.map(h => h.get('mcp-session-id'))).toEqual([null, 'session-fixture', 'session-fixture'])
    expect(headers[2]!.get('mcp-protocol-version')).toBe('2025-03-26')
    for (const h of headers) for (const name of ['authorization', 'x-api-key', 'cookie']) expect(h.has(name)).toBe(false)
    expect(fetch.mock.calls.every(([url, init]) => url === CALL.url && init.redirect === 'error')).toBe(true)
  })

  it('calls a stateless server once', async () => {
    const fetch = stub(async () => rpc({ content: [] }, 1))
    await call({ handshake: false, headers: { 'x-tinyfish-access-mode': 'keyless' } })
    expect(bodies(fetch).map(body => body.method)).toEqual(['tools/call'])
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('x-tinyfish-access-mode')).toBe('keyless')
  })

  it('reads the matching event from an SSE stream and stops reading there', async () => {
    const cancel = vi.fn()
    const events = ': ping\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'
      + 'data: {"jsonrpc":"2.0","id":99,"error":{"message":"other request"}}\r\n\r\n'
      + 'data: {"jsonrpc":"2.0",\r\ndata: "id":2,"result":{"structuredContent":{"web":[{"url":"https://example.com","title":"中文"}]}}}\r\n\r\n'
    const bytes = new TextEncoder().encode(events)
    // One byte per chunk splits multi-byte characters; the stream stays open after the answer.
    const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])) }, cancel })
    server(() => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    await expect(call()).resolves.toEqual({ structuredContent: { web: [{ url: 'https://example.com', title: '中文' }] } })
    expect(cancel).toHaveBeenCalled()
  })

  it('matches the response id inside a JSON batch', async () => {
    server(() => json([{ jsonrpc: '2.0', id: 99, result: {} }, { jsonrpc: '2.0', id: 2, result: { structuredContent: [SOURCE] } }]))
    await expect(call()).resolves.toEqual({ structuredContent: [SOURCE] })
  })

  it.each([
    ['a JSON-RPC error', () => json({ jsonrpc: '2.0', id: 2, error: { message: 'secret-provider-body' } }), 'WEB_PROVIDER_ERROR'],
    ['a tool error', () => rpc({ isError: true, content: [{ type: 'text', text: 'secret-provider-body' }] }), 'WEB_PROVIDER_ERROR'],
    ['no matching response', () => rpc({}, 99), 'WEB_PROVIDER_RESPONSE_INVALID'],
    ['a body that is not JSON', () => new Response('secret-provider-body'), 'WEB_PROVIDER_RESPONSE_INVALID'],
  ])('fails on %s without retrying or leaking it', async (_case, final, code) => {
    const fetch = server(final)
    const error = await rejection(call())
    expect(error).toMatchObject({ code })
    expect(error.message).not.toContain('secret')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('stops at a failed initialization', async () => {
    const fetch = stub(async () => json({ jsonrpc: '2.0', id: 1, error: { message: 'secret' } }))
    await expect(call()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('keyless MCP results', () => {
  const exa = ADAPTER_WIRES.exa.keyless
  const tinyfish = ADAPTER_WIRES.tinyfish.keyless
  if (typeof exa !== 'object' || typeof tinyfish !== 'object') throw new Error('expected MCP routes')
  const textResult = (text: string) => ({ content: [{ type: 'text', text }] })

  it('reads Exa text blocks', () => {
    const text = 'Title: First\nURL: https://example.com/one\nPublished Date: 2025-01-01\nText: First paragraph\nsecond line\n\n---\n\n'
      + 'Title: Second\nURL: https://example.com/two\nHighlights:\n - Useful evidence'
    expect(exa.parse(textResult(text))).toEqual([
      { url: 'https://example.com/one', title: 'First', publishedAt: '2025-01-01T00:00:00.000Z', snippet: 'First paragraph\nsecond line' },
      { url: 'https://example.com/two', title: 'Second', snippet: '- Useful evidence' },
    ])
  })

  it('reads JSON rows from structured content or text', () => {
    const rows = { results: [{ url: 'https://example.com', title: 'Example', snippet: 'evidence' }] }
    expect(tinyfish.parse(textResult(JSON.stringify(rows)))).toEqual(rows.results)
    expect(exa.parse({ structuredContent: rows })).toEqual(rows.results)
  })

  it('accepts an explicit empty result but never mistakes an unknown one for it', () => {
    expect(exa.parse(textResult('No search results found.'))).toEqual([])
    for (const route of [exa, tinyfish]) {
      expect(() => route.parse(textResult('unknown payload'))).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_RESPONSE_INVALID' }))
    }
  })
})