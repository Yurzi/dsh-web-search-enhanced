/** OpenAlex works search: scholarly metadata, anonymous by default. */
import { authors, collect, isRecord, summary, text } from '../sources.ts'
import { getJson, rowsAt, type Adapter } from './types.ts'

/** OpenAlex asks anonymous clients to identify themselves for the polite pool. */
const DEFAULT_MAILTO = 'dsh-web-search@users.noreply.github.com'

export const openalex: Adapter = {
  request(input, endpoint, auth) {
    const { filter, is_oa: openAccess, mailto, sort } = input.options
    const url = new URL(endpoint)
    url.searchParams.set('search', input.query)
    if (input.maxResults !== undefined) url.searchParams.set('per-page', String(Math.min(input.maxResults, 100)))
    url.searchParams.set('mailto', typeof mailto === 'string' ? mailto : DEFAULT_MAILTO)
    if (auth.kind === 'api-key') url.searchParams.set('api_key', auth.key)
    const filters = [text(filter), typeof openAccess === 'boolean' ? `is_oa:${openAccess}` : undefined].filter(value => value !== undefined)
    if (filters.length > 0) url.searchParams.set('filter', filters.join(','))
    if (typeof sort === 'string') url.searchParams.set('sort', sort)
    return getJson(url)
  },
  parse: payload => collect(rowsAt(payload, 'results'), row => {
    const openAccessUrl = isRecord(row.open_access) ? text(row.open_access.oa_url) : undefined
    const landingPage = isRecord(row.primary_location) ? text(row.primary_location.landing_page_url) : undefined
    const url = text(row.url) ?? httpUrl(row.doi) ?? openAccessUrl ?? landingPage ?? httpUrl(row.id)
    return {
      url,
      title: row.title ?? row.display_name,
      snippet: row.snippet ?? summary([
        typeof row.cited_by_count === 'number' ? `[Citations: ${row.cited_by_count}]` : undefined,
        authors(row.authorships, item => isRecord(item.author) ? item.author.display_name : undefined),
        openAccessUrl !== undefined && openAccessUrl !== url ? `[OA PDF: ${openAccessUrl}]` : undefined,
        invertedAbstract(row.abstract_inverted_index) ?? text(row.description),
      ]),
      publishedAt: row.publication_date ?? (typeof row.publication_year === 'number' ? `${row.publication_year}-01-01` : undefined),
    }
  }),
  keyless: 'rest',
}

function httpUrl(value: unknown): string | undefined {
  const url = text(value)
  return url?.startsWith('http') ? url : undefined
}

/** Rebuild abstract text from OpenAlex's `{ word: [positions] }` index. */
function invertedAbstract(index: unknown): string | undefined {
  if (!isRecord(index)) return undefined
  const words: [number, string][] = []
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue
    for (const position of positions) if (Number.isSafeInteger(position) && position >= 0) words.push([position, word])
  }
  return words.length === 0 ? undefined : words.sort((left, right) => left[0] - right[0]).map(([, word]) => word).join(' ')
}