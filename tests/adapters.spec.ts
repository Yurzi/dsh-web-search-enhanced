/** Wire contracts per adapter (synthetic, official-doc-shaped fixtures) and the dispatch through executeSearch. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADAPTER_IDS, ADAPTERS, type AdapterId } from '../src/catalog.ts'
import { ADAPTER_WIRES, type Auth, type SearchInput } from '../src/search/adapters/index.ts'
import { executeSearch, type SearchDeps } from '../src/search/execute.ts'
import { resolveSettings, type StructuredConnection } from '../src/settings/resolve.ts'

afterEach(() => { vi.unstubAllGlobals() })

const KEY: Auth = { kind: 'api-key', key: 'fixture-key' }
const input = (overrides: Partial<SearchInput> = {}): SearchInput => ({ query: 'q', maxResults: 5, freshness: 'auto', options: {}, ...overrides })
const request = (adapter: AdapterId, overrides?: Partial<SearchInput>, auth: Auth = KEY) => ADAPTER_WIRES[adapter].request(input(overrides), ADAPTERS[adapter].endpoint, auth)
const params = (url: string) => Object.fromEntries(new URL(url).searchParams)

describe('adapter requests', () => {
  it.each<[AdapterId, string, Record<string, string>, Record<string, unknown> | undefined]>([
    ['exa', 'POST', { 'x-api-key': 'fixture-key' }, { query: 'q', numResults: 5, contents: { text: { maxCharacters: 4000 } } }],
    ['firecrawl', 'POST', { authorization: 'Bearer fixture-key' }, { query: 'q', sources: [{ type: 'web' }], limit: 5 }],
    ['tavily', 'POST', { authorization: 'Bearer fixture-key' }, { query: 'q', max_results: 5, include_answer: false, include_raw_content: false }],
    ['deepseek', 'POST', { authorization: 'Bearer fixture-key' }, { query: 'q', count: 5, need_content: false }],
    ['tinyfish', 'GET', { 'x-api-key': 'fixture-key' }, undefined],
    ['semanticscholar', 'GET', { 'x-api-key': 'fixture-key' }, undefined],
    ['openalex', 'GET', {}, undefined],
  ])('%s sends %s with its credential', (adapter, method, auth, body) => {
    const wire = request(adapter)
    expect(wire.method).toBe(method)
    expect(wire.headers).toMatchObject(auth)
    expect(wire.body).toEqual(body)
    expect(wire.url.startsWith(ADAPTERS[adapter].endpoint)).toBe(true)
  })

  it('places query, count and options in GET parameters', () => {
    expect(params(request('tinyfish', { options: { location: 'US' } }).url)).toEqual({ query: 'q', page: '0', location: 'US' })
    expect(params(request('semanticscholar', { options: { year: '2020-2024' } }).url)).toMatchObject({ query: 'q', limit: '5', year: '2020-2024', fields: expect.stringContaining('title,url,abstract,tldr') })
    expect(params(request('openalex', { options: { filter: 'publication_year:2024', is_oa: true, sort: 'cited_by_count:desc' } }).url)).toEqual({
      'search': 'q', 'per-page': '5', 'mailto': 'dsh-web-search@users.noreply.github.com', 'api_key': 'fixture-key',
      'filter': 'publication_year:2024,is_oa:true', 'sort': 'cited_by_count:desc',
    })
  })

  it('caps counts at each API limit and lets options never override the query', () => {
    expect(request('exa', { maxResults: 500 }).body).toMatchObject({ numResults: 100 })
    expect(request('tavily', { maxResults: 500 }).body).toMatchObject({ max_results: 20 })
    expect(request('deepseek', { maxResults: 500 }).body).toMatchObject({ count: 50 })
    expect(request('deepseek', { maxResults: undefined }).body).toMatchObject({ count: 10 })
    expect(request('tavily', { options: { topic: 'news' } }).body).toMatchObject({ topic: 'news', query: 'q' })
  })

  it.each(['auto', 'fresh', 'realtime'] as const)('maps %s freshness to Exa and Firecrawl cache controls only', freshness => {
    const maxAge = { auto: undefined, fresh: [24, 86_400_000], realtime: [0, 0] }[freshness]
    expect((request('exa', { freshness }).body as { contents: unknown }).contents).toEqual({ text: { maxCharacters: 4000 }, ...(maxAge ? { maxAgeHours: maxAge[0] } : {}) })
    expect((request('firecrawl', { freshness }).body as { scrapeOptions?: unknown }).scrapeOptions).toEqual(maxAge ? { formats: [{ type: 'markdown' }], maxAge: maxAge[1] } : undefined)
    expect(request('tavily', { freshness })).toEqual(request('tavily'))
  })

  it('authenticates DeepSeek with an account token instead of a key', () => {
    expect(request('deepseek', {}, { kind: 'account', token: 'fixture-token' }).headers).toEqual(expect.objectContaining({ 'x-dsh-auth-token': 'fixture-token' }))
    expect(request('deepseek', {}, { kind: 'account', token: 'fixture-token' }).headers).not.toHaveProperty('authorization')
  })
})

describe('keyless routes', () => {
  it('exist exactly for the adapters the catalog marks keyless', () => {
    for (const adapter of ADAPTER_IDS) expect(ADAPTER_WIRES[adapter].keyless !== undefined).toBe(ADAPTERS[adapter].keyless)
  })

  it.each(['firecrawl', 'tavily', 'openalex'] as const)('%s reuses its REST request without any credential', adapter => {
    expect(ADAPTER_WIRES[adapter].keyless).toBe('rest')
    const wire = request(adapter, {}, { kind: 'keyless' })
    for (const header of ['authorization', 'x-api-key']) expect(wire.headers).not.toHaveProperty(header)
    expect(params(wire.url)).not.toHaveProperty('api_key')
    if (adapter === 'tavily') expect(wire.headers).toMatchObject({ 'x-tavily-access-mode': 'keyless' })
  })

  it('call the hosted MCP tools for Exa and Tinyfish', () => {
    const exa = ADAPTER_WIRES.exa.keyless
    const tinyfish = ADAPTER_WIRES.tinyfish.keyless
    if (typeof exa !== 'object' || typeof tinyfish !== 'object') throw new Error('expected MCP routes')
    expect(exa).toMatchObject({ url: 'https://mcp.exa.ai/mcp', tool: 'web_search_exa', handshake: true })
    expect(exa.arguments(input())).toEqual({ query: 'q', numResults: 5 })
    expect(tinyfish).toMatchObject({ url: 'https://agent.tinyfish.ai/mcp', tool: 'search', handshake: false, headers: { 'x-tinyfish-access-mode': 'keyless' } })
    expect(tinyfish.arguments(input({ options: { domain_type: 'news' } }))).toEqual({ query: 'q', domain_type: 'news' })
  })
})

describe('adapter responses', () => {
  const row = { url: 'https://example.com/page', title: 'Page' }
  it.each<[AdapterId, unknown, Record<string, unknown>]>([
    ['exa', { results: [{ ...row, text: 'Source text', highlights: ['ignored'], publishedDate: '2025-01-02' }] }, { snippet: 'Source text', publishedAt: '2025-01-02T00:00:00.000Z' }],
    ['firecrawl', { success: true, data: { web: [{ ...row, description: 'SERP', markdown: 'Scraped' }] } }, { snippet: 'SERP' }],
    ['tavily', { results: [{ ...row, content: 'Tavily text', published_date: '2025-01-02' }] }, { snippet: 'Tavily text' }],
    ['tinyfish', { results: [{ ...row, snippet: 'Tinyfish text', date: '2 hours ago' }] }, { snippet: 'Tinyfish text' }],
    ['deepseek', { results: [{ ...row, snippet: 'DeepSeek text', date: null }] }, { snippet: 'DeepSeek text' }],
  ])('%s maps its rows to sources', (adapter, payload, expected) => {
    expect(ADAPTER_WIRES[adapter].parse(payload, input())).toEqual([{ ...row, ...expected }])
  })

  it('reports fresh Firecrawl content only from the scrape', () => {
    const rows = { success: true, data: { web: [{ url: row.url, description: 'Old SERP', markdown: null }] } }
    expect(ADAPTER_WIRES.firecrawl.parse(rows, input({ freshness: 'realtime' }))).toEqual([{ url: row.url }])
  })

  it('summarizes OpenAlex works', () => {
    const [source] = ADAPTER_WIRES.openalex.parse({ results: [{
      id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1/x', title: 'Paper', publication_date: '2025-05-15', cited_by_count: 120,
      open_access: { oa_url: 'https://example.org/paper.pdf' }, authorships: [{ author: { display_name: 'Alice' } }, { author: { display_name: 'Bob' } }],
      abstract_inverted_index: { We: [0], present: [1], a: [2], method: [3] },
    }] }, input())
    expect(source).toEqual({
      url: 'https://doi.org/10.1/x', title: 'Paper', publishedAt: '2025-05-15T00:00:00.000Z',
      snippet: '[Citations: 120] [Authors: Alice, Bob] [OA PDF: https://example.org/paper.pdf] We present a method',
    })
  })

  it('summarizes Semantic Scholar papers and accepts an empty result without data', () => {
    const [source] = ADAPTER_WIRES.semanticscholar.parse({ total: 1, data: [{
      paperId: 'p1', title: 'Attention', year: 2024, citationCount: 450, tldr: { text: 'Efficient.' },
      abstract: 'Study.', authors: [{ name: 'Dr. Smith' }], openAccessPdf: { url: 'https://arxiv.org/pdf/1.pdf' },
    }] }, input())
    expect(source).toEqual({
      url: 'https://arxiv.org/pdf/1.pdf', title: 'Attention', publishedAt: '2024-01-01T00:00:00.000Z',
      snippet: '[TL;DR: Efficient.] [Citations: 450] [Authors: Dr. Smith] Study.',
    })
    expect(ADAPTER_WIRES.semanticscholar.parse({ total: 0 }, input())).toEqual([])
  })

  it('drops unusable rows, merges duplicates and bounds fields', () => {
    const rows = [null, { url: 'javascript:alert(1)' }, { url: 'https://user:pw@example.com' }, { url: '/relative' }, { url: 'https://example.com/a', title: 10 },
      { url: 'https://example.com/b', title: 't'.repeat(2000), text: 's'.repeat(5000) }, { url: 'https://example.com/b', publishedDate: '2025-01-01T10:00:00Z' }]
    expect(ADAPTER_WIRES.exa.parse({ results: rows }, input())).toEqual([
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b', title: 't'.repeat(1000), snippet: 's'.repeat(4000), publishedAt: '2025-01-01T10:00:00.000Z' },
    ])
  })

  it.each(ADAPTER_IDS)('%s rejects API errors and malformed envelopes', adapter => {
    for (const payload of [{ error: 'private upstream detail' }, { success: false }]) {
      expect(() => ADAPTER_WIRES[adapter].parse(payload, input())).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    }
    for (const payload of [null, [], { results: 'none' }]) {
      expect(() => ADAPTER_WIRES[adapter].parse(payload, input())).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_RESPONSE_INVALID' }))
    }
    expect(() => ADAPTER_WIRES[adapter].parse({ error: 'private upstream detail' }, input())).not.toThrow('private')
  })
})

describe('executeSearch', () => {
  const connection = (id: string, override: Record<string, unknown> = {}) =>
    resolveSettings({ connections: { [id]: override } }).connections.get(id) as StructuredConnection
  const deps = (key: string | undefined, accountToken?: SearchDeps['accountToken']): SearchDeps & { credential: ReturnType<typeof vi.fn> } =>
    ({ credential: vi.fn(async () => key), accountToken })
  const transport = (body: unknown = { results: [{ url: 'https://example.com' }] }, status = 200) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(body, { status }))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }
  const headers = (fetch: ReturnType<typeof transport>) => new Headers(fetch.mock.calls[0]![1]!.headers)

  it('searches keyless REST at the official endpoint and never reads a credential', async () => {
    const fetch = transport()
    const d = deps('fixture-key')
    const result = await executeSearch({ kind: 'structured', connection: connection('builtin:tavily'), freshness: 'auto' }, { query: 'q' }, d)
    expect(result).toEqual({ sources: [{ url: 'https://example.com' }], truncated: false })
    expect(fetch.mock.calls[0]![0]).toBe('https://api.tavily.com/search')
    expect(headers(fetch).has('authorization')).toBe(false)
    expect(d.credential).not.toHaveBeenCalled()
  })

  it('reports a keyless refusal without falling back to a personal key', async () => {
    const fetch = transport({ error: 'private body' }, 403)
    const d = deps('fixture-key')
    const error = await executeSearch({ kind: 'structured', connection: connection('builtin:firecrawl'), freshness: 'auto' }, { query: 'q' }, d).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'WEB_KEYLESS_UNAVAILABLE' })
    expect(String(error)).not.toContain('private')
    expect(fetch).toHaveBeenCalledOnce()
    expect(d.credential).not.toHaveBeenCalled()
  })

  it('resolves the personal key per search and fails before dispatch without one', async () => {
    const fetch = transport()
    const target = { kind: 'structured', connection: connection('builtin:exa', { access: 'api-key' }), freshness: 'auto' } as const
    await executeSearch(target, { query: 'q' }, deps('fixture-key'))
    expect(headers(fetch).get('x-api-key')).toBe('fixture-key')
    const missing = deps(undefined)
    await expect(executeSearch(target, { query: 'q' }, missing)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING', message: expect.stringContaining('EXA_API_KEY') })
    expect(missing.credential).toHaveBeenCalledWith('EXA_API_KEY')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('prefers the DeepSeek account sign-in and falls back to the API key', async () => {
    const fetch = transport()
    const target = { kind: 'structured', connection: connection('builtin:deepseek'), freshness: 'auto' } as const
    const signedIn = deps(undefined, vi.fn(async () => 'fixture-token'))
    await executeSearch(target, { query: 'q', maxResults: 3 }, signedIn)
    expect(signedIn.accountToken).toHaveBeenCalledWith('https://api.deepseek.com/v1/tools/search')
    expect(headers(fetch).get('x-dsh-auth-token')).toBe('fixture-token')
    expect(signedIn.credential).not.toHaveBeenCalled()
    await executeSearch(target, { query: 'q' }, deps('fixture-key', vi.fn(async () => undefined)))
    expect(new Headers(fetch.mock.calls[1]![1]!.headers).get('authorization')).toBe('Bearer fixture-key')
  })

  it('cancels while a credential lookup is pending', async () => {
    const fetch = transport()
    const controller = new AbortController()
    const pending = executeSearch({ kind: 'structured', connection: connection('builtin:semanticscholar'), freshness: 'auto' }, { query: 'q' },
      { credential: () => new Promise(() => {}) }, controller.signal)
    controller.abort('sensitive reason')
    const error = await pending.catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'WEB_ABORTED' })
    expect(String(error)).not.toContain('sensitive')
    expect(fetch).not.toHaveBeenCalled()
  })
})