import { describe, expect, it, vi } from 'vitest'
import { createProvider, EnhancedSearchProvider, resolveConfig } from '../src/index.ts'

describe('enhanced search provider', () => {
  it('dispatches with redirect rejection and parses the selected protocol', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://a.test' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'answer', annotations: [] }] },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const provider = createProvider(
      { protocol: 'openai-responses', baseURL: 'https://api.example/v1', model: 'm', apiKey: 'secret' },
      fetcher as unknown as typeof fetch,
    )
    await expect(provider.search({ query: 'q' })).resolves.toEqual({ content: 'answer', sources: [{ url: 'https://a.test' }], truncated: false })
    expect(fetcher).toHaveBeenCalledWith('https://api.example/v1/responses', expect.objectContaining({ method: 'POST', redirect: 'error' }))
  })

  it('reports missing credentials with a machine-readable code', async () => {
    const provider = createProvider({ apiKeyEnv: 'DSH_WEB_SEARCH_ENHANCED_MISSING_KEY' })
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('cancels while credential resolution is pending', async () => {
    const fetcher = vi.fn()
    const provider = new EnhancedSearchProvider(
      () => resolveConfig({ apiKeyEnv: 'PENDING_KEY' }),
      fetcher as unknown as typeof fetch,
      async () => await new Promise<string | undefined>(() => {}),
    )
    const controller = new AbortController()
    const search = provider.search({ query: 'q' }, controller.signal)
    controller.abort(new Error('stop'))
    await expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('maps caller cancellation to WEB_ABORTED before dispatch', async () => {
    const fetcher = vi.fn()
    const provider = createProvider({ apiKey: 'secret' }, fetcher as unknown as typeof fetch)
    const controller = new AbortController(); controller.abort(new Error('stop'))
    await expect(provider.search({ query: 'q' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('surfaces upstream error details with endpoint recovery guidance without following redirects', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'unsupported tool' } }), { status: 400 }))
    const provider = createProvider({ apiKey: 'secret' }, fetcher as unknown as typeof fetch)
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('HTTP 400: unsupported tool'),
    })
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      message: expect.stringContaining('The web search request used endpoint "https://api.deepseek.com/anthropic/v1/messages"'),
    })
  })

  it('adds endpoint recovery instructions to network failures and unprocessable responses', async () => {
    const networkFailFetcher = vi.fn(async () => { throw new TypeError('connection refused') })
    const provider1 = createProvider({ apiKey: 'secret' }, networkFailFetcher as unknown as typeof fetch)
    await expect(provider1.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('connection refused'),
    })

    const badJsonFetcher = vi.fn(async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }))
    const provider2 = createProvider({ apiKey: 'secret' }, badJsonFetcher as unknown as typeof fetch)
    await expect(provider2.search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('The web search request used endpoint'),
    })
  })

  it('invokes recordRequest with sanitized wire request before dispatch', async () => {
    const records: any[] = []
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://test.com' }] },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const provider = createProvider(
      { protocol: 'anthropic-messages', apiKey: 'super-secret-key' },
      fetcher as unknown as typeof fetch,
      record => { records.push(record) },
    )
    await provider.search({ query: 'audit query' })
    expect(records).toHaveLength(1)
    const rec = records[0]
    expect(rec.endpoint).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(rec.protocol).toBe('anthropic-messages')
    expect(rec.apiVersion).toBe('2023-06-01')
    expect(rec.body.messages[0].content[0].text).toContain('audit query')
    expect(JSON.stringify(rec)).not.toContain('super-secret-key')
  })
})
