/**
 * Bundle composition against the shipped base profile.
 *
 * A Loader patch replaces the whole `config` of the row it targets, so the
 * plugin's `web` row decides which capabilities fall back to auto-selection.
 * These tests apply the real include patch algorithm to the base rows that
 * register web providers and resolve both capabilities through the real
 * WebRuntime, with every provider reporting available() like
 * dsh-web-deepseek-api does when no key is configured.
 */
import { readFileSync } from 'node:fs'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface Row { id: string; name?: string; disabled?: boolean | null; config?: Record<string, unknown> }

/** Web rows of @deepseek-ai/dsh-base 0.2.1-rc.2 (packages/bundle/base/cordis.patch.yml). */
const BASE: Row[] = [
  { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
  { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-fetch-http', name: '@deepseek-ai/dsh-web-fetch-http' },
]
/** Provider ids each row registers. */
const PROVIDERS: Record<string, { search?: string[]; fetch?: string[] }> = {
  'web-search-deepseek': { search: ['deepseek-official'] },
  'web-deepseek-api': { search: ['deepseek-search-api'], fetch: ['deepseek-fetch-api'] },
  'web-fetch-http': { fetch: ['http'] },
  'web-search-enhanced': { search: ['enhanced-search'] },
  // dsh-web-fetch-enhanced replaces web-fetch-http and registers under the same id.
  'web-fetch-enhanced': { fetch: ['http'] },
}
const OWN = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as PatchOptions[]
const FETCH_ENHANCED: PatchOptions[] = [
  { id: 'web-fetch-http', disabled: true },
  { insert: [{ id: 'web-fetch-enhanced', name: 'dsh-web-fetch-enhanced' }] },
]

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function compose(...layers: PatchOptions[][]) {
  const warnings: string[] = []
  const rows = applyEntryPatches(structuredClone(BASE) as never, layers.flat(), message => { warnings.push(message) }) as Row[]
  const web = rows.find(row => row.id === 'web')!
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WebRuntime, web.config ?? {})
  for (const row of rows) {
    if (row.disabled) continue
    for (const id of PROVIDERS[row.id]?.search ?? []) {
      ctx.web.registerSearchProvider({ id, available: () => true, search: async () => ({ sources: [{ url: 'https://' + id + '.invalid/' }], truncated: false }) })
    }
    for (const id of PROVIDERS[row.id]?.fetch ?? []) {
      ctx.web.registerFetchProvider({ id, available: () => true, fetch: async request => ({ url: request.url, statusCode: 200, body: { kind: 'text', content: id }, truncated: false }) })
    }
  }
  const search = async () => (await ctx.web.search({ query: 'q' })).sources[0]!.url
  const fetch = async () => { const result = await ctx.web.fetch({ url: 'https://example.invalid/' }); return result.body.kind === 'text' ? result.body.content : undefined }
  return { rows, warnings, search, fetch }
}

describe('bundle composition over the base profile', () => {
  it('routes search to enhanced-search and keeps fetch unambiguous', async () => {
    const { rows, warnings, search, fetch } = await compose(OWN)
    expect(warnings).toEqual([])
    expect(rows.find(row => row.id === 'web')?.config).toEqual({ searchProvider: 'enhanced-search' })
    await expect(search()).resolves.toBe('https://enhanced-search.invalid/')
    await expect(fetch()).resolves.toBe('http')
  })

  it.each([['search plugin first', [OWN, FETCH_ENHANCED]], ['fetch plugin first', [FETCH_ENHANCED, OWN]]] as const)(
    'composes with dsh-web-fetch-enhanced (%s)', async (_order, layers) => {
      const { search, fetch } = await compose(...layers)
      await expect(search()).resolves.toBe('https://enhanced-search.invalid/')
      await expect(fetch()).resolves.toBe('http')
    })
})
