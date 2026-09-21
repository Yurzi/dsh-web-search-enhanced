import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchKeyless } from '../src/adapters/mcp.ts'

afterEach(() => vi.useRealTimers())
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
const rpc = (result: unknown, id = 2) => json({ jsonrpc: '2.0', id, result })
const example = { url: 'https://example.com', title: 'Example', snippet: 'evidence' }
function fixture(final: () => Response = () => rpc({ structuredContent: { results: [example] } })) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, { 'Mcp-Session-Id': 'session-fixture' })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return final()
  })
}

describe('keyless MCP search', () => {
  it.each(['json','sse'])('Tinyfish uses a single anonymous search call and parses %s text JSON',async format=>{
    const envelope={jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({results:[example,{...example,url:'https://example.com/2'}],page:0,total_results:2})}]}}
    const fetcher=vi.fn<typeof fetch>(async()=>format==='json'?json(envelope):new Response('data: '+JSON.stringify(envelope)+'\n\n',{headers:{'content-type':'text/event-stream'}}))
    const result=await searchKeyless('tinyfish',{query:'hello',maxResults:1},undefined,fetcher,{location:'US',language:'en',purpose:'research',domain_type:'web'})
    expect(result).toEqual({sources:[example],truncated:true})
    expect(fetcher).toHaveBeenCalledOnce()
    const [url,init]=fetcher.mock.calls[0]!, headers=new Headers(init?.headers)
    expect(url).toBe('https://agent.tinyfish.ai/mcp');expect(init?.redirect).toBe('error')
    expect(headers.get('x-tinyfish-access-mode')).toBe('keyless')
    for(const name of ['authorization','x-api-key','cookie','mcp-session-id']) expect(headers.has(name)).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'search',arguments:{query:'hello',location:'US',language:'en',purpose:'research',domain_type:'web'}}})
  })
  it('Tinyfish validates options, skips zero count, and honors cancellation',async()=>{
    const fetcher=vi.fn<typeof fetch>(()=>new Promise(()=>{}))
    await expect(searchKeyless('tinyfish',{query:'q'},undefined,fetcher,{headers:{}})).rejects.toThrow()
    expect(await searchKeyless('tinyfish',{query:'q',maxResults:0},undefined,fetcher)).toEqual({sources:[],truncated:false})
    await expect(searchKeyless('tinyfish',{query:'q'},undefined,fetcher,{domain_type:'research_paper'})).rejects.toThrow('API Key mode')
    await expect(searchKeyless('tinyfish',{query:'x'.repeat(2001)},undefined,fetcher)).rejects.toThrow('invalid search query')
    expect(fetcher).not.toHaveBeenCalled()
    const controller=new AbortController()
    const pending=searchKeyless('tinyfish',{query:'q'},controller.signal,fetcher)
    controller.abort('private reason')
    await expect(pending).rejects.toMatchObject({code:'WEB_ABORTED'})
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each([{isError:true,content:[{type:'text',text:'secret'}]}, {content:[{type:'text',text:'secret'}]}])('Tinyfish rejects tool failures and unknown formats without fallback',async result=>{
    const fetcher=vi.fn<typeof fetch>(async()=>rpc(result,1))
    const error=await searchKeyless('tinyfish',{query:'hello'},undefined,fetcher).catch(e=>e)
    expect(error).toBeInstanceOf(Error);expect(error.message).not.toContain('secret')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each([
    ['exa', 'https://mcp.exa.ai/mcp', 'web_search_exa', 'numResults'],
    ['firecrawl', 'https://mcp.firecrawl.dev/v2/mcp', 'firecrawl_search', 'limit'],
  ] as const)('%s uses three stateless requests with exact arguments and no credentials', async (adapter, endpoint, tool, count) => {
    const fetcher = fixture()
    for (let i = 0; i < 2; i++) {
      expect((await searchKeyless(adapter, { query: 'hello', maxResults: 3 }, undefined, fetcher)).sources).toEqual([example])
    }
    expect(fetcher).toHaveBeenCalledTimes(6)
    const calls = fetcher.mock.calls.map(([url, init]) => ({ url, init: init!, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) }))
    expect(calls.map(c => c.body.method)).toEqual(Array(2).fill(['initialize', 'notifications/initialized', 'tools/call']).flat())
    for (const [index, call] of calls.entries()) {
      expect(call.url).toBe(endpoint)
      expect(call.init.redirect).toBe('error')
      expect(call.headers.has('authorization')).toBe(false)
      expect(call.headers.has('x-api-key')).toBe(false)
      expect(call.headers.get('Mcp-Session-Id')).toBe(index % 3 ? 'session-fixture' : null)
      if (index % 3 === 2) expect(call.body.params).toEqual({ name: tool, arguments: { query: 'hello', [count]: 3 } })
    }
  })

  it('parses Exa Text and Highlights blocks with published dates', async () => {
    const text = 'Title: First\nURL: https://example.com/one\nPublished Date: 2025-01-01\nText: First paragraph\nsecond line\n\n---\n\nTitle: Second\nURL: https://example.com/two\nPublished: 2024-02-01\nHighlights:\n - Useful evidence\n - More evidence'
    const result = await searchKeyless('exa', { query: 'hello' }, undefined, fixture(() => rpc({ content: [{ type: 'text', text }] })))
    expect(result.sources).toEqual([
      { url: 'https://example.com/one', title: 'First', publishedAt: '2025-01-01', snippet: 'First paragraph\nsecond line' },
      { url: 'https://example.com/two', title: 'Second', publishedAt: '2024-02-01', snippet: '- Useful evidence\n - More evidence' },
    ])
  })

  it.each([{ web: [example] }, { data: { web: [example] } }, { results: [example] }])('parses Firecrawl JSON text %j', async payload => {
    const fetcher = fixture(() => rpc({ content: [{ type: 'text', text: JSON.stringify(payload) }] }))
    expect((await searchKeyless('firecrawl', { query: 'hello' }, undefined, fetcher)).sources).toEqual([example])
  })

  it('matches SSE responses per event, supports multiline data and split UTF-8, and cancels without EOF', async () => {
    const cancel = vi.fn()
    const data = ': ping\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0","id":99,"error":{"message":"ignore"}}\r\n\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":2,"result":{"structuredContent":{"web":[{"url":"https://example.com","title":"中文"}]}}}\r\n\r\n'
    const encoded = new TextEncoder().encode(data)
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of encoded) c.enqueue(new Uint8Array([byte])) }, cancel })
    const fetcher = fixture(() => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    expect((await searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).sources).toEqual([{ url: 'https://example.com', title: '中文' }])
    expect(cancel).toHaveBeenCalled()
  })

  it('matches JSON batch ids rather than falling back to another response', async () => {
    const fetcher = fixture(() => json([{ jsonrpc: '2.0', id: 99, result: {} }, { jsonrpc: '2.0', id: 2, result: { structuredContent: [example] } }]))
    expect((await searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).sources).toEqual([example])
  })

  it.each([
    () => json({ jsonrpc: '2.0', id: 2, error: { message: 'secret-provider-body' } }),
    () => rpc({ isError: true, content: [{ type: 'text', text: 'secret-provider-body' }] }),
    () => rpc({}, 99),
    () => new Response('secret-provider-body'),
  ])('fails safely without retry on invalid RPC or tool errors', async final => {
    const fetcher = fixture(final)
    const error = await searchKeyless('exa', { query: 'hello' }, undefined, fetcher).catch(e => e)
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(String(error)).not.toContain('secret-provider-body')
    expect(error.cause).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('rejects initialization errors before notification or tools/call', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ jsonrpc: '2.0', id: 1, error: { message: 'secret' } }))
    await expect(searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not swallow notification HTTP errors', async () => {
    const fetcher = fixture()
    fetcher.mockImplementationOnce(async () => rpc({}, 1)).mockImplementationOnce(async () => new Response('secret', { status: 500 }))
    await expect(searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('redacts network exceptions and preserves rate-limit classification', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('secret-key') })
    await expect(searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).rejects.not.toThrow('secret-key')
    fetcher.mockImplementation(async () => new Response('secret-key', { status: 429 }))
    await expect(searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).rejects.toMatchObject({ code: 'WEB_PROVIDER_RATE_LIMITED' })
  })

  it('validates URLs, bounds source fields, deduplicates and applies result count', async () => {
    const rows = [null, { url: 'javascript:alert(1)' }, { url: 'https://user:password@example.com' }, { url: '/relative' }, { url: 'https://example.com/\nfoo' },
      { url: 'https://example.com/one', title: 't'.repeat(2000), snippet: 's'.repeat(10000) },
      { url: 'https://example.com/one' }, { url: 'https://example.com/two' }]
    const result = await searchKeyless('exa', { query: 'hello', maxResults: 1 }, undefined, fixture(() => rpc({ structuredContent: { results: rows } })))
    expect(result.sources).toEqual([{ url: 'https://example.com/one', title: 't'.repeat(1000), snippet: 's'.repeat(4000) }])
    expect(result.truncated).toBe(true)
  })

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid count %s without network', async maxResults => {
    const fetcher = fixture()
    await expect(searchKeyless('exa', { query: 'hello', maxResults }, undefined, fetcher)).rejects.toThrow('invalid result limit')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('validates query, returns zero without network, and aborts before transport', async () => {
    const fetcher = fixture()
    await expect(searchKeyless('exa', { query: '   ' }, undefined, fetcher)).rejects.toThrow('invalid search query')
    expect(await searchKeyless('exa', { query: 'hello', maxResults: 0 }, undefined, fetcher)).toEqual({ sources: [], truncated: false })
    await expect(searchKeyless('exa', { query: 'hello' }, AbortSignal.abort(), fetcher)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([false, true])('enforces byte limit and cancels oversized stream (declared=%s)', async declared => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('中'.repeat(750_000))) }, cancel })
    const fetcher = fixture(() => new Response(stream, { headers: declared ? { 'content-length': '3000000' } : {} }))
    await expect(searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(cancel).toHaveBeenCalled()
  })

  it('cancels a stalled stream on user abort', async () => {
    const cancel = vi.fn(), controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const stream = new ReadableStream<Uint8Array>({ pull() { started(); return new Promise(() => {}) }, cancel }, { highWaterMark: 0 })
    const pending = searchKeyless('exa', { query: 'hello' }, controller.signal, fixture(() => new Response(stream)))
    const checked = expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await ready
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    controller.abort()
    await checked
    expect(cancel).toHaveBeenCalled()
  })

  it.each(['fetch', 'body'] as const)('bounds a stalled %s by the operation deadline', async stall => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetcher = stall === 'fetch' ? vi.fn<typeof fetch>(() => new Promise(() => {})) : fixture(() => new Response(new ReadableStream({ pull() { return new Promise(() => {}) }, cancel })))
    const checked = expect(searchKeyless('exa', { query: 'hello' }, undefined, fetcher)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await vi.advanceTimersByTimeAsync(90_001)
    await checked
    if (stall === 'body') expect(cancel).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('MCP result format validation',()=>{
  it('does not turn an unrecognized tool result into successful empty search',async()=>{
    await expect(searchKeyless('exa',{query:'q'},undefined,fixture(()=>rpc({content:[{type:'text',text:'unknown payload'}]})))).rejects.toMatchObject({code:'WEB_PROVIDER_RESPONSE_INVALID'})
  })
  it('accepts an explicit Exa no-results message',async()=>{
    expect(await searchKeyless('exa',{query:'q'},undefined,fixture(()=>rpc({content:[{type:'text',text:'No search results found.'}]})))).toEqual({sources:[],truncated:false})
  })
})
