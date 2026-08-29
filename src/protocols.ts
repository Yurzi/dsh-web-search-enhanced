import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'

/** Upstream HTTP envelope used for one server-side web search. */
export type SearchProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-chat-completions'
/** Select whether the search route is fixed or follows the active model. */
export type ModelMode = 'configured' | 'current-session'
/** Search context size accepted by OpenAI-compatible search endpoints. */
export type SearchContextSize = 'low' | 'medium' | 'high'
/** Chat Completions search activation: official search-model semantics or an explicit vendor extension. */
export type ChatSearchMode = 'search-model' | 'vendor-options'

/** Fully resolved settings captured at one search operation's entry. */
export interface ResolvedConfig {
  readonly providerId: string
  readonly modelMode: ModelMode
  readonly protocol: SearchProtocol
  readonly baseURL: string
  readonly model: string
  readonly fallbackModel: string | undefined
  readonly apiKey: string | undefined
  readonly apiKeyEnv: string
  readonly apiVersion: string
  readonly toolIdentifier: string
  readonly maxTokens: number
  readonly maxUses: number
  readonly chatSearchMode: ChatSearchMode
  readonly searchContextSize: SearchContextSize | undefined
}

/** Secret-bearing HTTP request produced immediately before dispatch. */
interface WireRequest {
  readonly endpoint: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Readonly<Record<string, unknown>>
}


const ENDPOINT_SUFFIX: Record<SearchProtocol, string> = {
  'anthropic-messages': '/messages',
  'openai-responses': '/responses',
  'openai-chat-completions': '/chat/completions',
}

/** Return the protocol-specific built-in search identifier. */
export function defaultToolIdentifier(protocol: SearchProtocol): string {
  switch (protocol) {
    case 'anthropic-messages': return 'web_search_20250305'
    case 'openai-responses': return 'web_search'
    case 'openai-chat-completions': return 'web_search_options'
  }
}

/** Build one protocol request from resolved settings and a model-facing search query. */
export function buildWireRequest(config: ResolvedConfig, query: string, apiKey: string): WireRequest {
  const prompt = `Perform a web search for the query: ${query}`
  const commonHeaders = { 'accept': 'application/json', 'content-type': 'application/json', 'user-agent': 'dsh-web-search-enhanced/0.0.1' }
  switch (config.protocol) {
    case 'anthropic-messages': return {
      endpoint: appendEndpoint(config.baseURL, ENDPOINT_SUFFIX[config.protocol]),
      headers: { ...commonHeaders, 'anthropic-version': config.apiVersion, 'authorization': `Bearer ${apiKey}`, 'x-api-key': apiKey },
      body: {
        model: config.model,
        max_tokens: config.maxTokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        tools: [{ type: config.toolIdentifier, name: 'web_search', max_uses: config.maxUses }],
      },
    }
    case 'openai-responses': return {
      endpoint: appendEndpoint(config.baseURL, ENDPOINT_SUFFIX[config.protocol]),
      headers: { ...commonHeaders, authorization: `Bearer ${apiKey}` },
      body: {
        model: config.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        tools: [{ type: config.toolIdentifier, ...(config.searchContextSize === undefined ? {} : { search_context_size: config.searchContextSize }) }],
        tool_choice: { type: config.toolIdentifier },
        max_output_tokens: config.maxTokens,
        stream: false,
      },
    }
    case 'openai-chat-completions': {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: config.maxTokens,
        stream: false,
      }
      const optionsField = config.chatSearchMode === 'search-model' ? 'web_search_options' : config.toolIdentifier
      body[optionsField] = config.searchContextSize === undefined ? {} : { search_context_size: config.searchContextSize }
      return {
        endpoint: appendEndpoint(config.baseURL, ENDPOINT_SUFFIX[config.protocol]),
        headers: { ...commonHeaders, authorization: `Bearer ${apiKey}` },
        body,
      }
    }
  }
}

/** Parse a protocol response into DSH's provider-neutral search result. */
export function parseSearchResponse(protocol: SearchProtocol, payload: unknown): WebSearchResult {
  switch (protocol) {
    case 'anthropic-messages': return parseAnthropicResponse(payload)
    case 'openai-responses': return parseResponsesResponse(payload)
    case 'openai-chat-completions': return parseChatCompletionsResponse(payload)
  }
}

/** Parse Anthropic Messages server-tool result blocks and citation snippets. */
export function parseAnthropicResponse(payload: unknown): WebSearchResult {
  const blocks = asArray(asRecord(payload)?.content)
  const snippets = new Map<string, string>()
  for (const blockValue of blocks) {
    const block = asRecord(blockValue)
    if (block?.type !== 'text') continue
    for (const citationValue of asArray(block.citations)) {
      const citation = asRecord(citationValue)
      const url = nonEmptyString(citation?.url)
      const snippet = nonEmptyString(citation?.cited_text)
      if (url !== undefined && snippet !== undefined && !snippets.has(url)) snippets.set(url, snippet)
    }
  }
  const sources = new Map<string, MutableSource>()
  let sawResultBlock = false
  for (const blockValue of blocks) {
    const block = asRecord(blockValue)
    if (block?.type !== 'web_search_tool_result') continue
    sawResultBlock = true
    for (const itemValue of asArray(block.content)) {
      const item = asRecord(itemValue)
      if (item?.type !== 'web_search_result') continue
      addSource(sources, item, snippets.get(nonEmptyString(item.url) ?? ''))
    }
  }
  if (!sawResultBlock) throw providerError('Anthropic Messages response contains no web_search_tool_result block')
  return { sources: [...sources.values()], truncated: false }
}

/** Parse Responses web_search_call items, message text, and URL annotations. */
export function parseResponsesResponse(payload: unknown): WebSearchResult {
  const output = asArray(asRecord(payload)?.output)
  const sources = new Map<string, MutableSource>()
  const contentParts: string[] = []
  for (const result of asArray(asRecord(payload)?.results)) addSource(sources, asRecord(result))
  let sawSearchCall = false
  for (const itemValue of output) {
    const item = asRecord(itemValue)
    if (item?.type === 'web_search_call') {
      sawSearchCall = true
      if (item.status === 'failed') throw providerError('Responses web_search_call failed')
      for (const result of asArray(item.results)) addSource(sources, asRecord(result))
      for (const source of asArray(asRecord(item.action)?.sources)) addSource(sources, asRecord(source))
      continue
    }
    if (item?.type !== 'message') continue
    for (const blockValue of asArray(item.content)) {
      const block = asRecord(blockValue)
      if (block?.type !== 'output_text' && block?.type !== 'text') continue
      const text = nonEmptyString(block.text)
      if (text !== undefined) contentParts.push(text)
      for (const annotation of asArray(block.annotations)) addSource(sources, citationRecord(annotation))
    }
  }
  if (!sawSearchCall) throw providerError('Responses payload contains no web_search_call item')
  const content = contentParts.length === 0 ? undefined : contentParts.join('\n')
  return { ...(content === undefined ? {} : { content }), sources: [...sources.values()], truncated: false }
}

/** Parse Chat Completions message text and URL citation annotations. */
export function parseChatCompletionsResponse(payload: unknown): WebSearchResult {
  const root = asRecord(payload)
  const message = asRecord(asRecord(asArray(root?.choices)[0])?.message)
  if (message === undefined) throw providerError('Chat Completions payload contains no assistant message')
  const content = nonEmptyString(message.content)
  const sources = new Map<string, MutableSource>()
  for (const annotation of asArray(message.annotations)) addSource(sources, citationRecord(annotation))
  for (const citation of asArray(root?.citations)) {
    if (typeof citation === 'string') addSource(sources, { url: citation })
    else addSource(sources, asRecord(citation))
  }
  return { ...(content === undefined ? {} : { content }), sources: [...sources.values()], truncated: false }
}

function appendEndpoint(baseURL: string, suffix: string): string {
  const trimmed = baseURL.replace(/\/+$/u, '')
  return trimmed.toLowerCase().endsWith(suffix) ? trimmed : trimmed + suffix
}

type MutableSource = { url: string; title?: string; snippet?: string; publishedAt?: string }
function addSource(target: Map<string, MutableSource>, value: Record<string, unknown> | undefined, forcedSnippet?: string): void {
  if (value === undefined) return
  const url = nonEmptyString(value.url) ?? nonEmptyString(value.source_website_url)
  if (url === undefined) return
  const title = nonEmptyString(value.title)
  const snippet = forcedSnippet ?? nonEmptyString(value.snippet) ?? nonEmptyString(value.caption)
  const publishedAt = nonEmptyString(value.page_age) ?? nonEmptyString(value.published_at)
  const existing = target.get(url)
  if (existing !== undefined) {
    if (existing.title === undefined && title !== undefined) existing.title = title
    if (existing.snippet === undefined && snippet !== undefined) existing.snippet = snippet
    if (existing.publishedAt === undefined && publishedAt !== undefined) existing.publishedAt = publishedAt
    return
  }
  const source: MutableSource = { url }
  if (title !== undefined) source.title = title
  if (snippet !== undefined) source.snippet = snippet
  if (publishedAt !== undefined) source.publishedAt = publishedAt
  target.set(url, source)
}
function citationRecord(value: unknown): Record<string, unknown> | undefined {
  const annotation = asRecord(value)
  return asRecord(annotation?.url_citation) ?? annotation
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function asArray(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function nonEmptyString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
function providerError(message: string): WebError { return new WebError(`dsh-web-search-enhanced: ${message}`, 'WEB_PROVIDER_ERROR') }
