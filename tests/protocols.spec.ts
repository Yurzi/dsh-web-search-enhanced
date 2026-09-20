import { describe, expect, it } from 'vitest'
import { appendEndpoint, buildWireRequest, parseAnthropicResponse, parseChatCompletionsResponse, parseResponsesResponse } from '../src/protocols.ts'
import type { ResolvedConfig, SearchProtocol } from '../src/protocols.ts'

function config(protocol: SearchProtocol, toolIdentifier: string, baseURL = 'https://api.example/v1/'): ResolvedConfig {
  return { providerId: 'enhanced-search', modelMode: 'configured', protocol, baseURL, model: 'search-model', fallbackModel: undefined, apiKey: undefined, apiKeyEnv: 'KEY', apiVersion: '2023-06-01', toolIdentifier, maxTokens: 1234, maxUses: 7, chatSearchMode: 'search-model', searchContextSize: 'high' }
}

describe('protocol request adapters', () => {
  it('builds Anthropic Messages v1 with configurable tool type and max_tokens', () => {
    const wire = buildWireRequest(config('anthropic-messages', 'web_search_20990101'), 'latest news', 'secret')
    expect(wire.endpoint).toBe('https://api.example/v1/messages')
    expect(wire.headers).toMatchObject({ 'anthropic-version': '2023-06-01', 'x-api-key': 'secret', 'user-agent': 'dsh-web-search-enhanced/0.0.6' })
    expect(wire.body).toMatchObject({ max_tokens: 1234, tools: [{ type: 'web_search_20990101', name: 'web_search', max_uses: 7 }] })
  })

  it('normalizes Anthropic baseURL root and /v1 segments correctly', () => {
    expect(appendEndpoint('https://api.anthropic.com', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages')
    expect(appendEndpoint('https://api.anthropic.com/v1', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages')
    expect(appendEndpoint('https://api.anthropic.com/v1/', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages')
    expect(appendEndpoint('https://api.anthropic.com/v1/messages', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages')
    expect(appendEndpoint('https://api.deepseek.com/anthropic/v1', 'anthropic-messages')).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(appendEndpoint('https://gateway.example/tenant', 'anthropic-messages')).toBe('https://gateway.example/tenant/v1/messages')
  })

  it('builds OpenAI Responses with configurable tool type and max_output_tokens', () => {
    const wire = buildWireRequest(config('openai-responses', 'web_search_preview'), 'latest news', 'secret')
    expect(wire.endpoint).toBe('https://api.example/v1/responses')
    expect(wire.body).toMatchObject({ max_output_tokens: 1234, tools: [{ type: 'web_search_preview', search_context_size: 'high' }], tool_choice: { type: 'web_search_preview' } })
  })

  it('builds official Chat Completions search options under the fixed official field', () => {
    const wire = buildWireRequest(config('openai-chat-completions', 'custom_field'), 'latest news', 'secret')
    expect(wire.endpoint).toBe('https://api.example/v1/chat/completions')
    expect(wire.body).toMatchObject({ max_tokens: 1234, web_search_options: { search_context_size: 'high' } })
    expect(wire.body).not.toHaveProperty('custom_field')
  })

  it('uses the configured Chat options field only for an explicit vendor extension', () => {
    const base = config('openai-chat-completions', 'vendor_web_search')
    const wire = buildWireRequest({ ...base, chatSearchMode: 'vendor-options' }, 'latest news', 'secret')
    expect(wire.body).toMatchObject({ vendor_web_search: { search_context_size: 'high' } })
    expect(wire.body).not.toHaveProperty('web_search_options')
  })
})

describe('protocol response adapters', () => {
  it('joins Anthropic result metadata with citation snippets', () => {
    expect(parseAnthropicResponse({ content: [
      { type: 'text', citations: [{ url: 'https://a.test', cited_text: 'excerpt' }] },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A', page_age: '2026-01-01' }] },
    ] })).toEqual({ sources: [{ url: 'https://a.test', title: 'A', snippet: 'excerpt', publishedAt: '2026-01-01' }], truncated: false })
  })

  it('parses Responses calls, answer text, and deduplicated annotations', () => {
    expect(parseResponsesResponse({ output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://a.test', title: 'A' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'answer', annotations: [{ type: 'url_citation', url: 'https://a.test' }] }] },
    ] })).toEqual({ content: 'answer', sources: [{ url: 'https://a.test', title: 'A' }], truncated: false })
  })

  it('parses Chat Completions annotations and top-level citations', () => {
    expect(parseChatCompletionsResponse({
      choices: [{ message: { content: 'answer', annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.test', title: 'A' } }] } }],
      citations: ['https://b.test'],
    })).toEqual({ content: 'answer', sources: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test' }], truncated: false })
  })

  it('fails loudly when server-side search did not run', () => {
    expect(() => parseAnthropicResponse({ content: [] })).toThrow('web_search_tool_result')
    expect(() => parseResponsesResponse({ output: [] })).toThrow('web_search_call')
  })
})

describe('model search error envelopes', () => {
  it('does not report an Anthropic server tool error as a successful empty search', () => {
    expect(() => parseAnthropicResponse({ content: [{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'rate_limit_exceeded'}}] })).toThrow('error or invalid result')
  })
})
