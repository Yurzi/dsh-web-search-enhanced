import { describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { searchStructured, validateStructuredOptions } from '../src/adapters/structured.ts'
import type { StructuredAdapter } from '../src/adapters/structured.ts'

const adapters: StructuredAdapter[] = ['firecrawl', 'exa', 'tavily', 'tinyfish']
const config = { endpoint: 'https://search.example/search' }
// Synthetic transport credential only, never an authenticated request.
const context = { apiKey: 'test-only-credential', freshness: 'auto' as const }
const row = { url: 'https://example.com/page', title: 'Page', description: 'SERP', markdown: 'Scraped text', text: 'Source text', highlights: ['Highlight'], content: 'Tavily text', snippet: 'Tinyfish text' }
function envelope(adapter: StructuredAdapter, rows: unknown[] = [row]) {
  return adapter === 'firecrawl' ? { success: true, data: { web: rows } } : { results: rows }
}
function mock(payload: unknown) { return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload)) }
function body(fetcher: ReturnType<typeof mock>) { return JSON.parse(fetcher.mock.calls[0]![1]!.body as string) as Record<string, any> }

describe('structured search API contracts (official-doc-shaped synthetic fixtures)', () => {
  it('records partial/ignored privately without asserting verified freshness or leaking queries', async () => {
    const diagnose = vi.fn()
    const result = await searchStructured('firecrawl', {query:'private query'}, config, { ...context, freshness:'realtime', fetcher:mock(envelope('firecrawl',[row,{url:'https://example.com/missing',description:'old SERP'}])), diagnose })
    expect(diagnose).toHaveBeenLastCalledWith({requested:'realtime',outcome:'partial',sources:2,contentSources:1,freshnessVerified:false})
    expect(result).not.toHaveProperty('freshness');expect(JSON.stringify(diagnose.mock.calls)).not.toContain('private query')
    await searchStructured('tavily', {query:'private query'}, config, { ...context, freshness:'realtime', fetcher:mock(envelope('tavily')), diagnose })
    expect(diagnose.mock.calls[1]?.[0].outcome).toBe('ignored')
  })
  it.each(adapters)('%s authenticates, refuses redirects, and returns sources without a summary', async adapter => {
    const fetcher = mock(envelope(adapter))
    const result = await searchStructured(adapter, { query: 'query', maxResults: 2 }, config, { ...context, fetcher })
    expect(result.sources[0]?.url).toBe(row.url)
    expect(result.content).toBeUndefined()
    expect(result.truncated).toBe(false)
    const init = fetcher.mock.calls[0]![1]!
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init.headers).get(adapter === 'exa' || adapter === 'tinyfish' ? 'x-api-key' : 'authorization')).toBe(adapter === 'exa' || adapter === 'tinyfish' ? context.apiKey : 'Bearer ' + context.apiKey)
    if (adapter === 'tinyfish') {
      const url = new URL(String(fetcher.mock.calls[0]![0]))
      expect(init.method).toBe('GET')
      expect(init.body).toBeUndefined()
      expect([...url.searchParams.keys()]).toEqual(['query', 'page'])
      expect(url.searchParams.get('page')).toBe('0')
    } else expect(init.method).toBe('POST')
  })
  it.each(adapters)('%s accepts empty results and locally enforces output caps', async adapter => {
    expect(await searchStructured(adapter, { query: 'q' }, config, { ...context, fetcher: mock(envelope(adapter, [])) })).toEqual({ sources: [], truncated: false })
    const fetcher = mock(envelope(adapter, [row, { ...row, url: 'https://example.com/two' }]))
    const result = await searchStructured(adapter, { query: 'q', maxResults: 1 }, config, { ...context, fetcher })
    expect(result.sources).toHaveLength(1)
    expect(result.truncated).toBe(true)
    const noCall = mock(null)
    expect(await searchStructured(adapter, { query: 'q', maxResults: 0 }, config, { ...context, fetcher: noCall })).toEqual({ sources: [], truncated: false })
    expect(noCall).not.toHaveBeenCalled()
  })
  it.each(['auto', 'fresh', 'realtime'] as const)('maps %s to actual Firecrawl and Exa content', async freshness => {
    const fire = mock(envelope('firecrawl'))
    const exa = mock(envelope('exa'))
    const f = await searchStructured('firecrawl', { query: 'q', maxResults: 500 }, config, { ...context, freshness, fetcher: fire })
    const e = await searchStructured('exa', { query: 'q', maxResults: 500 }, config, { ...context, freshness, fetcher: exa })
    expect(body(fire).limit).toBe(100)
    expect(body(exa).numResults).toBe(100)
    expect(body(fire).sources).toEqual([{ type: 'web' }])
    expect(body(fire).scrapeOptions).toEqual(freshness === 'auto' ? undefined : { formats: [{ type: 'markdown' }], maxAge: freshness === 'fresh' ? 86400000 : 0 })
    expect(body(exa).contents).toEqual({ text: { maxCharacters: 4000 }, ...(freshness === 'auto' ? {} : { maxAgeHours: freshness === 'fresh' ? 24 : 0 }) })
    expect(f.sources[0]?.snippet).toBe(freshness === 'auto' ? 'SERP' : 'Scraped text')
    expect(e.sources[0]?.snippet).toBe('Source text')
    expect(JSON.stringify(body(exa))).not.toContain('livecrawl')
  })
  it('does not substitute SERP text for missing scraped content', async () => {
    const fetcher = mock(envelope('firecrawl', [{ url: row.url, description: 'Old SERP', markdown: null }]))
    const result = await searchStructured('firecrawl', { query: 'q' }, config, { ...context, freshness: 'realtime', fetcher })
    expect(result.sources[0]?.snippet).toBeUndefined()
  })
  it.each(['tavily', 'tinyfish'] as const)('%s ignores cache freshness rather than mapping date windows', async adapter => {
    const fetcher = mock(envelope(adapter))
    for (const freshness of ['auto', 'fresh', 'realtime'] as const) await searchStructured(adapter, { query: 'q', maxResults: 300 }, config, { ...context, freshness, fetcher })
    expect(fetcher.mock.calls.map(call => [call[0], call[1]?.body])).toEqual(Array(3).fill([fetcher.mock.calls[0]![0], fetcher.mock.calls[0]![1]?.body]))
    if (adapter === 'tavily') expect(body(fetcher)).toMatchObject({ max_results: 20, include_answer: false, include_raw_content: false })
  })
  it('bounds snippets separately from source truncation and handles dates conservatively', async () => {
    const fetcher = mock({ results: [{ ...row, text: 'x'.repeat(5000), publishedDate: '2025-01-02' }] })
    const result = await searchStructured('exa', { query: 'q' }, config, { ...context, fetcher })
    expect(result.sources[0]?.snippet).toHaveLength(4000)
    expect(result.sources[0]?.publishedAt).toBe('2025-01-02T00:00:00.000Z')
    expect(result.truncated).toBe(false)
    const tiny = await searchStructured('tinyfish', { query: 'q' }, config, { ...context, fetcher: mock({ results: [{ ...row, date: '2 hours ago' }] }) })
    expect(tiny.sources[0]?.publishedAt).toBeUndefined()
  })
  it.each(adapters)('%s rejects malformed envelopes and rows, not disguising them as empty', async adapter => {
    for (const payload of [{}, { error: 'private error' }, envelope(adapter, [null]), envelope(adapter, [{ url: 'javascript:alert(1)' }]), envelope(adapter, [{ ...row, title: 10 }]), envelope(adapter, [{ ...row, url: 'https://user:password@example.com' }])]) {
      await expect(searchStructured(adapter, { query: 'q' }, config, { ...context, fetcher: mock(payload) })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    }
  })
  it.each([401, 402, 403, 429, 500])('sanitizes HTTP %s failures without reading the error body', async status => {
    const cancel = vi.fn()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status }))
    await expect(searchStructured('tinyfish', { query: 'private-query' }, config, { ...context, fetcher })).rejects.toThrow('HTTP ' + status)
    expect(cancel).toHaveBeenCalled()
  })
  it('does not leak transport WebErrors, URLs, credentials, JSON, or abort reasons', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new WebError('private-query test-only-credential https://secret.example', 'SECRET'))
    try { await searchStructured('tinyfish', { query: 'private-query' }, config, { ...context, fetcher }); expect.fail('must fail') } catch (error) {
      expect(String(error)).not.toMatch(/private-query|test-only-credential|secret.example/)
      expect((error as Error).cause).toBeUndefined()
    }
    await expect(searchStructured('exa', { query: 'q' }, config, { ...context, fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('private-invalid-json')) })).rejects.toThrow('invalid structured JSON')
  })
  it('rejects oversized declared and streamed responses', async () => {
    for (const response of [new Response('{}', { headers: { 'content-length': '9999999' } }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
      await expect(searchStructured('exa', { query: 'q' }, config, { ...context, fetcher: vi.fn<typeof fetch>().mockResolvedValue(response) })).rejects.toThrow('size limit')
    }
  })
  it('cancels before fetch and during a fetch that ignores its signal', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}))
    const pending = searchStructured('exa', { query: 'q' }, config, { ...context, signal: controller.signal, fetcher })
    controller.abort('sensitive reason')
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await expect(pending).rejects.not.toHaveProperty('cause')
    await expect(searchStructured('exa', { query: 'q' }, config, { ...context, signal: controller.signal, fetcher })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('cancels and releases a stalled response stream', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    let started!: () => void
    const reading = new Promise<void>(resolve => { started = resolve })
    const response = new Response(new ReadableStream({ pull() { started() }, cancel }))
    const pending = searchStructured('exa', { query: 'q' }, config, { ...context, signal: controller.signal, fetcher: vi.fn<typeof fetch>().mockResolvedValue(response) })
    await reading
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(cancel).toHaveBeenCalled()
  })
  it('times out without depending on cooperative fetch', async () => {
    vi.useFakeTimers()
    try {
      const pending = searchStructured('exa', { query: 'q' }, config, { ...context, fetcher: vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})) })
      const assertion = expect(pending).rejects.toMatchObject({ code: 'WEB_PROVIDER_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(90_000)
      await assertion
    } finally { vi.useRealTimers() }
  })
  it('validates options without arbitrary passthrough or freshness overrides', () => {
    expect(validateStructuredOptions('tinyfish', { purpose: 'Explicit purpose', location: 'US' })).toEqual({ purpose: 'Explicit purpose', location: 'US' })
    for (const adapter of adapters) for (const options of [{ apiKey: 'hidden' }, { maxAgeHours: 0 }, { limit: 3 }, { query: 'override' }, { headers: {} }, [], null]) expect(() => validateStructuredOptions(adapter, options)).toThrow()
    expect(() => validateStructuredOptions('exa', { type: 'neural' })).toThrow()
    expect(() => validateStructuredOptions('tavily', { search_depth: 'invalid' })).toThrow()
    expect(() => validateStructuredOptions('firecrawl', { safe: 'yes' })).toThrow()
  })
  it('rejects unsafe endpoints and invalid limits before sending credentials', async () => {
    const fetcher = mock({ results: [] })
    for (const endpoint of ['not-url', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com?key=secret', 'https://example.com#fragment']) await expect(searchStructured('exa', { query: 'q' }, { endpoint }, { ...context, fetcher })).rejects.toThrow('endpoint')
    for (const maxResults of [-1, 1.5, NaN, Infinity]) await expect(searchStructured('exa', { query: 'q', maxResults }, config, { ...context, fetcher })).rejects.toThrow('limit')
    expect(fetcher).not.toHaveBeenCalled()
  })

  describe('academic search adapters (openalex & semanticscholar)', () => {
    it('OpenAlex executes GET with search query, mailto, and per-page limits', async () => {
      const payload = {
        results: [{
          id: 'https://openalex.org/W123',
          doi: 'https://doi.org/10.1038/s41586-025-0001',
          title: 'DeepSeek Reasoning Paper',
          publication_date: '2025-05-15',
          cited_by_count: 120,
          open_access: { is_oa: true, oa_url: 'https://example.org/paper.pdf' },
          authorships: [
            { author: { display_name: 'Alice Researcher' } },
            { author: { display_name: 'Bob Scientist' } },
          ],
          abstract_inverted_index: {
            We: [0],
            present: [1],
            a: [2],
            novel: [3],
            method: [4],
          },
        }],
      }
      const fetcher = mock(payload)
      const result = await searchStructured('openalex', { query: 'deepseek reasoning', maxResults: 5 }, { endpoint: 'https://api.openalex.org/works' }, { ...context, fetcher })
      expect(result.sources).toHaveLength(1)
      const s = result.sources[0]!
      expect(s.url).toBe('https://doi.org/10.1038/s41586-025-0001')
      expect(s.title).toBe('DeepSeek Reasoning Paper')
      expect(s.publishedAt).toBe('2025-05-15T00:00:00.000Z')
      expect(s.snippet).toContain('[Citations: 120]')
      expect(s.snippet).toContain('[Authors: Alice Researcher, Bob Scientist]')
      expect(s.snippet).toContain('[OA PDF: https://example.org/paper.pdf]')
      expect(s.snippet).toContain('We present a novel method')

      const callUrl = new URL(String(fetcher.mock.calls[0]![0]))
      expect(callUrl.searchParams.get('search')).toBe('deepseek reasoning')
      expect(callUrl.searchParams.get('per-page')).toBe('5')
      expect(callUrl.searchParams.get('mailto')).toBe('dsh-web-search@users.noreply.github.com')
      const init = fetcher.mock.calls[0]![1]!
      expect(init.method).toBe('GET')
      expect(init.body).toBeUndefined()
      expect(new Headers(init.headers).has('authorization')).toBe(false)
      expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('api_key')).toBe(context.apiKey)
    })

    it('OpenAlex supports anonymous keyless access', async () => {
      const fetcher = mock({ results: [{ id: 'https://openalex.org/W1', title: 'Paper', abstract_inverted_index: { Hello: [0] } }] })
      const result = await searchStructured('openalex', { query: 'test' }, { endpoint: 'https://api.openalex.org/works' }, { freshness: 'auto', keyless: true, fetcher })
      expect(result.sources[0]?.url).toBe('https://openalex.org/W1')
      const init = fetcher.mock.calls[0]![1]!
      expect(new Headers(init.headers).has('authorization')).toBe(false)
      expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('api_key')).toBeNull()
    })

    it('Semantic Scholar executes GET with fields, query, x-api-key, and parses TL;DR and citations', async () => {
      const payload = {
        total: 1,
        data: [{
          paperId: 's2_123456',
          url: 'https://www.semanticscholar.org/paper/s2_123456',
          title: 'Attention Mechanism Study',
          year: 2024,
          publicationDate: '2024-06-01',
          citationCount: 450,
          tldr: { text: 'Attention is efficient and scalable.' },
          abstract: 'Detailed study of attention layers in large networks.',
          authors: [{ name: 'Dr. Smith' }, { name: 'Dr. Jones' }],
          openAccessPdf: { url: 'https://arxiv.org/pdf/2406.00001.pdf' },
        }],
      }
      const fetcher = mock(payload)
      const result = await searchStructured('semanticscholar', { query: 'attention mechanism', maxResults: 10 }, { endpoint: 'https://api.semanticscholar.org/graph/v1/paper/search' }, { ...context, fetcher })
      expect(result.sources).toHaveLength(1)
      const s = result.sources[0]!
      expect(s.url).toBe('https://www.semanticscholar.org/paper/s2_123456')
      expect(s.title).toBe('Attention Mechanism Study')
      expect(s.publishedAt).toBe('2024-06-01T00:00:00.000Z')
      expect(s.snippet).toContain('[TL;DR: Attention is efficient and scalable.]')
      expect(s.snippet).toContain('[Citations: 450]')
      expect(s.snippet).toContain('[Authors: Dr. Smith, Dr. Jones]')
      expect(s.snippet).toContain('[OA PDF: https://arxiv.org/pdf/2406.00001.pdf]')
      expect(s.snippet).toContain('Detailed study of attention layers in large networks.')

      const callUrl = new URL(String(fetcher.mock.calls[0]![0]))
      expect(callUrl.searchParams.get('query')).toBe('attention mechanism')
      expect(callUrl.searchParams.get('limit')).toBe('10')
      expect(callUrl.searchParams.get('fields')).toContain('title,url,abstract,tldr')
      const init = fetcher.mock.calls[0]![1]!
      expect(init.method).toBe('GET')
      expect(init.body).toBeUndefined()
      expect(new Headers(init.headers).get('x-api-key')).toBe(context.apiKey)
    })

    it('Semantic Scholar rejects keyless mode (requires API key)', async () => {
      const fetcher = mock({ data: [] })
      await expect(searchStructured('semanticscholar', { query: 'test' }, { endpoint: 'https://api.semanticscholar.org/graph/v1/paper/search' }, { freshness: 'auto', keyless: true, fetcher })).rejects.toThrow('invalid keyless REST route')
    })

    it('OpenAlex merges is_oa into filter, uses custom mailto and sets multi-field sort', async () => {
      const fetcher = mock({ results: [{ id: 'https://openalex.org/W2', title: 'Paper 2', abstract_inverted_index: { Test: [0] } }] })
      await searchStructured('openalex', { query: 'physics' }, {
        endpoint: 'https://api.openalex.org/works',
        options: {
          filter: 'publication_year:2024',
          is_oa: true,
          mailto: 'researcher@example.edu',
          sort: 'publication_year:desc,cited_by_count:desc',
        },
      }, { ...context, fetcher })
      const callUrl = new URL(String(fetcher.mock.calls[0]![0]))
      expect(callUrl.searchParams.get('filter')).toBe('publication_year:2024,is_oa:true')
      expect(callUrl.searchParams.has('is_oa')).toBe(false)
      expect(callUrl.searchParams.get('mailto')).toBe('researcher@example.edu')
      expect(callUrl.searchParams.get('sort')).toBe('publication_year:desc,cited_by_count:desc')
    })

    it('Semantic Scholar safely handles empty search results without data property', async () => {
      const fetcher = mock({ total: 0 })
      const result = await searchStructured('semanticscholar', { query: 'nonexistent paper 12345' }, {
        endpoint: 'https://api.semanticscholar.org/graph/v1/paper/search',
      }, { ...context, fetcher })
      expect(result.sources).toEqual([])
      expect(result.truncated).toBe(false)
    })

    it('validates OpenAlex and Semantic Scholar options', () => {
      expect(validateStructuredOptions('openalex', {
        sort: 'publication_year:desc,cited_by_count:desc',
        is_oa: true,
        filter: 'publication_year:2024',
        mailto: 'academic@institution.org',
      })).toEqual({
        sort: 'publication_year:desc,cited_by_count:desc',
        is_oa: true,
        filter: 'publication_year:2024',
        mailto: 'academic@institution.org',
      })
      expect(validateStructuredOptions('semanticscholar', { year: '2020-2024', fieldsOfStudy: 'Computer Science,Physics' })).toEqual({
        year: '2020-2024',
        fieldsOfStudy: 'Computer Science,Physics',
      })
      expect(() => validateStructuredOptions('openalex', { sort: 'unsafe;drop table' })).toThrow()
      expect(() => validateStructuredOptions('openalex', { mailto: 'not-an-email' })).toThrow()
      expect(() => validateStructuredOptions('semanticscholar', { year: 'nineteen-ninety' })).toThrow()
    })
  })
})
