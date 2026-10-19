/**
 * Search through a model's server-side web search tool: build one request per
 * wire protocol and read its citations back as sources.
 */
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import type { ModelProtocol } from '../catalog.ts'
import type { ModelSearchOptions } from '../settings/resolve.ts'
import type { FixedModelBinding } from '../settings/types.ts'
import { searchError } from './errors.ts'
import type { HttpRequest } from './http.ts'
import { isoDate, isRecord, SourceList, text, type SourceFields } from './sources.ts'

const DEFAULT_TOOL: Record<ModelProtocol, string> = {
  'anthropic-messages': 'web_search_20260209',
  'openai-responses': 'web_search',
  'openai-chat-completions': 'web_search_options',
}
const PATH: Record<ModelProtocol, string> = {
  'anthropic-messages': '/messages',
  'openai-responses': '/responses',
  'openai-chat-completions': '/chat/completions',
}
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_MAX_USES = 5
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'

export function defaultToolIdentifier(protocol: ModelProtocol): string {
  return DEFAULT_TOOL[protocol]
}

/** The protocol endpoint under `baseURL`; Anthropic bases may omit their `/v1`. */
export function modelEndpoint(baseURL: string, protocol: ModelProtocol): string {
  const base = baseURL.replace(/\/+$/u, '')
  const path = PATH[protocol]
  if (base.toLowerCase().endsWith(path)) return base
  if (protocol === 'anthropic-messages') return `${base.replace(/\/v1$/u, '')}/v1${path}`
  return base + path
}

export function modelRequest(route: FixedModelBinding, options: ModelSearchOptions, query: string, apiKey: string): HttpRequest {
  const prompt = `Perform a web search for the query: ${query}`
  const tool = options.toolIdentifier ?? DEFAULT_TOOL[route.protocol]
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const contextSize = options.searchContextSize === undefined ? {} : { search_context_size: options.searchContextSize }
  const url = modelEndpoint(route.baseURL, route.protocol)
  const headers = { 'accept': 'application/json', 'content-type': 'application/json', 'user-agent': `dsh-web-search-enhanced/${__PLUGIN_VERSION__}`, 'authorization': `Bearer ${apiKey}` }
  switch (route.protocol) {
    case 'anthropic-messages': return {
      url, method: 'POST',
      headers: { ...headers, 'anthropic-version': options.apiVersion ?? DEFAULT_ANTHROPIC_VERSION, 'x-api-key': apiKey },
      body: {
        model: route.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        tools: [{ type: tool, name: 'web_search', max_uses: options.maxUses ?? DEFAULT_MAX_USES }],
      },
    }
    case 'openai-responses': return {
      url, method: 'POST', headers,
      body: {
        model: route.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        tools: [{ type: tool, ...contextSize }],
        tool_choice: { type: tool },
        max_output_tokens: maxTokens,
        stream: false,
      },
    }
    case 'openai-chat-completions': {
      // The official search models read `web_search_options`; a vendor extension names its own field.
      const field = options.chatSearchMode === 'vendor-options' ? tool : 'web_search_options'
      return {
        url, method: 'POST', headers,
        body: { model: route.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false, [field]: contextSize },
      }
    }
  }
}

export function parseModelResponse(protocol: ModelProtocol, payload: unknown): WebSearchResult {
  switch (protocol) {
    case 'anthropic-messages': return parseAnthropic(payload)
    case 'openai-responses': return parseResponses(payload)
    case 'openai-chat-completions': return parseChatCompletions(payload)
  }
}

/** Server-tool result blocks, with snippets taken from the citations that quote them. */
function parseAnthropic(payload: unknown): WebSearchResult {
  const blocks = records(isRecord(payload) ? payload.content : undefined)
  const quotes = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'text') continue
    for (const citation of records(block.citations)) {
      const url = text(citation.url)
      const quote = text(citation.cited_text)
      if (url !== undefined && quote !== undefined && !quotes.has(url)) quotes.set(url, quote)
    }
  }
  const results = blocks.filter(block => block.type === 'web_search_tool_result')
  if (results.length === 0) throw notSearched('no web_search_tool_result block')
  const sources = new SourceList()
  for (const block of results) {
    if (!Array.isArray(block.content)) throw searchError('WEB_PROVIDER_ERROR', "the model's web search tool reported an error; retry later or choose another search connection")
    for (const item of records(block.content)) {
      if (item.type !== 'web_search_result') continue
      sources.add(source(item, quotes.get(text(item.url) ?? '')))
    }
  }
  return { sources: sources.sources, truncated: false }
}

/** `web_search_call` items plus the answer text and its URL annotations. */
function parseResponses(payload: unknown): WebSearchResult {
  const root = isRecord(payload) ? payload : {}
  const sources = new SourceList()
  const answer: string[] = []
  let searched = false
  for (const result of records(root.results)) sources.add(source(result))
  for (const item of records(root.output)) {
    if (item.type === 'web_search_call') {
      searched = true
      if (item.status === 'failed') throw searchError('WEB_PROVIDER_ERROR', "the model's web search call failed; retry later or choose another search connection")
      for (const result of records(item.results)) sources.add(source(result))
      for (const cited of records(isRecord(item.action) ? item.action.sources : undefined)) sources.add(source(cited))
    } else if (item.type === 'message') {
      for (const block of records(item.content)) {
        if (block.type !== 'output_text' && block.type !== 'text') continue
        const part = text(block.text)
        if (part !== undefined) answer.push(part)
        for (const annotation of records(block.annotations)) sources.add(source(citation(annotation)))
      }
    }
  }
  if (!searched) throw notSearched('no web_search_call item')
  return { ...(answer.length === 0 ? {} : { content: answer.join('\n') }), sources: sources.sources, truncated: false }
}

/** The assistant message, its URL citations and any top-level `citations`. */
function parseChatCompletions(payload: unknown): WebSearchResult {
  const root = isRecord(payload) ? payload : {}
  const choice = records(root.choices)[0]
  const message = isRecord(choice?.message) ? choice.message : undefined
  if (message === undefined) throw notSearched('no assistant message')
  const sources = new SourceList()
  for (const annotation of records(message.annotations)) sources.add(source(citation(annotation)))
  for (const entry of Array.isArray(root.citations) ? root.citations : []) sources.add(isRecord(entry) ? source(entry) : { url: entry })
  const content = text(message.content)
  return { ...(content === undefined ? {} : { content }), sources: sources.sources, truncated: false }
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/**
 * Source fields under the names model vendors use: `source_website_url`,
 * `caption`, and `page_age` / `published_at` besides the usual ones.
 */
function source(item: Record<string, unknown>, quote?: string): SourceFields {
  return {
    url: text(item.url) ?? item.source_website_url,
    title: item.title,
    snippet: quote ?? text(item.snippet) ?? item.caption,
    publishedAt: isoDate(item.page_age) ?? item.published_at,
  }
}

/** Chat Completions nest the cited source under `url_citation`; Responses inline it. */
function citation(annotation: Record<string, unknown>): Record<string, unknown> {
  return isRecord(annotation.url_citation) ? annotation.url_citation : annotation
}

function notSearched(detail: string) {
  return searchError('WEB_PROVIDER_RESPONSE_INVALID', `the model response has ${detail}; check that the model supports server-side web search`)
}