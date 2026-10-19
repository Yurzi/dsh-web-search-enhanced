/** DeepSeek Search API, authenticated by an API key or a DeepSeek account sign-in. */
import { collect } from '../sources.ts'
import { bearer, postJson, rowsAt, type Adapter } from './types.ts'

const DEFAULT_COUNT = 10

export const deepseek: Adapter = {
  request(input, endpoint, auth) {
    return postJson(endpoint, bearer(auth), {
      query: input.query,
      count: Math.min(input.maxResults ?? DEFAULT_COUNT, 50),
      need_content: false,
    })
  },
  parse: payload => collect(rowsAt(payload, 'results'), row => ({ url: row.url, title: row.title, snippet: row.snippet, publishedAt: row.date })),
}
