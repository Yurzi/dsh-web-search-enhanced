/** Exa: REST search with bounded page text; keyless through the hosted MCP tool. */
import type { Freshness } from '../../catalog.ts'
import { invalidResponse } from '../http.ts'
import { toolRows, toolTexts, type McpToolResult } from '../mcp.ts'
import { collect, MAX_SNIPPET_LENGTH, type SourceFields } from '../sources.ts'
import { apiKeyHeader, count, postJson, rowsAt, type Adapter } from './types.ts'

const MAX_AGE_HOURS: Record<Freshness, number | undefined> = { auto: undefined, fresh: 24, realtime: 0 }

export const exa: Adapter = {
  request(input, endpoint, auth) {
    const maxAgeHours = MAX_AGE_HOURS[input.freshness]
    return postJson(endpoint, apiKeyHeader(auth), {
      ...input.options,
      query: input.query,
      ...count('numResults', input.maxResults, 100),
      // Bounded source text rather than a generated summary or highlights.
      contents: { text: { maxCharacters: MAX_SNIPPET_LENGTH }, ...(maxAgeHours === undefined ? {} : { maxAgeHours }) },
    })
  },
  parse: payload => collect(rowsAt(payload, 'results'), row => ({
    url: row.url,
    title: row.title,
    snippet: row.text ?? joined(row.highlights),
    publishedAt: row.publishedDate,
  })),
  keyless: {
    url: 'https://mcp.exa.ai/mcp',
    tool: 'web_search_exa',
    handshake: true,
    arguments: input => ({ query: input.query, ...count('numResults', input.maxResults, 100) }),
    parse: parseTool,
  },
}

function parseTool(result: McpToolResult) {
  const structured = toolRows(result)
  const rows = structured ?? textRows(toolTexts(result).join('\n\n'))
  if (structured === undefined && rows.length === 0) throw invalidResponse('an unrecognized Exa tool result')
  return collect(rows, row => ({
    url: row.url,
    title: row.title,
    snippet: row.text ?? row.snippet ?? joined(row.highlights),
    publishedAt: row.publishedDate ?? row.publishedAt,
  }))
}

/** Exa's text format: blocks of `Title:`, `URL:`, `Published Date:` and `Text:`/`Highlights:` lines. */
function textRows(value: string): SourceFields[] {
  return value.split(/(?=^Title:[ \t]*)/mu).flatMap(block => {
    const field = (name: string) => new RegExp(`^${name}:[ \\t]*(.*)$`, 'mu').exec(block)?.[1]?.trim()
    const url = field('URL')
    if (url === undefined || url === '') return []
    const snippet = /^(?:Text|Highlights):[ \t]*([\s\S]*)/mu.exec(block)?.[1]?.replace(/\n\s*---\s*$/u, '')
    return [{ url, title: field('Title'), publishedAt: field('Published(?: Date)?'), snippet }]
  })
}

function joined(value: unknown): string | undefined {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').join('\n') : undefined
}
