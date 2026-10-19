/** Search through a model's server-side web search tool, per wire protocol. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelProtocol } from '../src/catalog.ts'
import { executeSearch } from '../src/search/execute.ts'
import { modelEndpoint, modelRequest, parseModelResponse } from '../src/search/model.ts'
import type { FixedModelBinding } from '../src/settings/types.ts'

afterEach(() => { vi.unstubAllGlobals() })

const route = (protocol: ModelProtocol, baseURL = 'https://api.example/v1/'): FixedModelBinding =>
  ({ mode: 'fixed', protocol, model: 'search-model', baseURL, credentialRef: 'MODEL_KEY' })

describe('model search requests', () => {
  it('builds Anthropic Messages with a configurable server tool', () => {
    const request = modelRequest(route('anthropic-messages'), { toolIdentifier: 'web_search_20990101', maxTokens: 1234, maxUses: 7 }, 'latest news', 'fixture-key')
    expect(request.url).toBe('https://api.example/v1/messages')
    expect(request.headers).toMatchObject({ 'anthropic-version': '2023-06-01', 'x-api-key': 'fixture-key', 'authorization': 'Bearer fixture-key' })
    expect(request.body).toEqual({
      model: 'search-model', max_tokens: 1234,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Perform a web search for the query: latest news' }] }],
      tools: [{ type: 'web_search_20990101', name: 'web_search', max_uses: 7 }],
    })
  })

  it('builds OpenAI Responses with a forced web search tool', () => {
    const request = modelRequest(route('openai-responses'), { searchContextSize: 'high' }, 'q', 'fixture-key')
    expect(request.url).toBe('https://api.example/v1/responses')
    expect(request.headers).toMatchObject({ authorization: 'Bearer fixture-key' })
    expect(request.headers).not.toHaveProperty('x-api-key')
    expect(request.body).toMatchObject({ max_output_tokens: 4096, tools: [{ type: 'web_search', search_context_size: 'high' }], tool_choice: { type: 'web_search' }, stream: false })
  })

  it('builds Chat Completions under the official field unless a vendor field is chosen', () => {
    const official = modelRequest(route('openai-chat-completions'), { toolIdentifier: 'vendor_search', searchContextSize: 'low' }, 'q', 'k')
    expect(official.url).toBe('https://api.example/v1/chat/completions')
    expect(official.body).toMatchObject({ max_tokens: 4096, web_search_options: { search_context_size: 'low' } })
    expect(official.body).not.toHaveProperty('vendor_search')
    const vendor = modelRequest(route('openai-chat-completions'), { toolIdentifier: 'vendor_search', chatSearchMode: 'vendor-options' }, 'q', 'k')
    expect(vendor.body).toMatchObject({ vendor_search: {} })
    expect(vendor.body).not.toHaveProperty('web_search_options')
  })

  it.each([
    ['https://api.anthropic.com', 'https://api.anthropic.com/v1/messages'],
    ['https://api.anthropic.com/v1/', 'https://api.anthropic.com/v1/messages'],
    ['https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/messages'],
    ['https://api.deepseek.com/anthropic', 'https://api.deepseek.com/anthropic/v1/messages'],
  ])('places Anthropic base %s at %s', (base, endpoint) => {
    expect(modelEndpoint(base, 'anthropic-messages')).toBe(endpoint)
  })
})

describe('model search responses', () => {
  it('joins Anthropic results with the citations that quote them', () => {
    expect(parseModelResponse('anthropic-messages', { content: [
      { type: 'text', citations: [{ url: 'https://a.test', cited_text: 'excerpt' }] },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A', page_age: '2026-01-01' }, { type: 'web_search_result', url: 'https://b.test' }] },
    ] })).toEqual({ sources: [{ url: 'https://a.test', title: 'A', snippet: 'excerpt', publishedAt: '2026-01-01T00:00:00.000Z' }, { url: 'https://b.test' }], truncated: false })
  })

  it('reads Responses search calls, answer text and annotations', () => {
    expect(parseModelResponse('openai-responses', { output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://a.test', title: 'A' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'answer', annotations: [{ type: 'url_citation', url: 'https://a.test' }, { type: 'url_citation', url: 'https://b.test' }] }] },
    ] })).toEqual({ content: 'answer', sources: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test' }], truncated: false })
  })

  it('reads Chat Completions annotations and top-level citations', () => {
    expect(parseModelResponse('openai-chat-completions', {
      choices: [{ message: { content: 'answer', annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.test', title: 'A' } }] } }],
      citations: ['https://b.test'],
    })).toEqual({ content: 'answer', sources: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test' }], truncated: false })
  })

  it('accepts the source field names model vendors use', () => {
    expect(parseModelResponse('openai-responses', { output: [{ type: 'web_search_call', results: [
      { source_website_url: 'https://a.test', title: 'A', caption: 'caption text', published_at: '2025-03-04' },
      { url: 'https://b.test', page_age: 'April 30, 2025', published_at: '2025-04-30T08:00:00Z' },
    ] }] })).toEqual({ sources: [
      { url: 'https://a.test', title: 'A', snippet: 'caption text', publishedAt: '2025-03-04T00:00:00.000Z' },
      { url: 'https://b.test', publishedAt: '2025-04-30T08:00:00.000Z' },
    ], truncated: false })
  })

  it('fails when the model did not search, or its search tool failed', () => {
    for (const [protocol, payload] of [['anthropic-messages', { content: [] }], ['openai-responses', { output: [] }], ['openai-chat-completions', { choices: [] }]] as const) {
      expect(() => parseModelResponse(protocol, payload)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_RESPONSE_INVALID', message: expect.stringContaining('server-side web search') }))
    }
    expect(() => parseModelResponse('anthropic-messages', { content: [{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }] }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(() => parseModelResponse('openai-responses', { output: [{ type: 'web_search_call', status: 'failed' }] })).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('model search dispatch', () => {
  it('resolves the route credential per search and keeps it out of results', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://source.test' }] } }] }))
    vi.stubGlobal('fetch', fetch)
    const credential = vi.fn(async () => 'fixture-key')
    const target = { kind: 'model', label: 'Fixed', route: route('openai-responses', 'https://model.test/v1'), options: {} } as const
    const result = await executeSearch(target, { query: 'q' }, { credential })
    expect(result.sources).toEqual([{ url: 'https://source.test' }])
    expect(credential).toHaveBeenCalledWith('MODEL_KEY')
    expect(fetch.mock.calls[0]![0]).toBe('https://model.test/v1/responses')
    expect(JSON.stringify(result)).not.toContain('fixture-key')
    await expect(executeSearch(target, { query: 'q' }, { credential: async () => undefined })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(fetch).toHaveBeenCalledOnce()
  })
})