/**
 * Bundle composition against the shipped base profile.
 *
 * A Loader patch replaces the whole `config` of the row it targets, so a bundle
 * that rewrites one field of the shared `web` row drops the other. The plugin
 * takes the seat the base row already selects instead. These tests apply the
 * real include patch algorithm to the base rows that register web providers and
 * resolve both capabilities through the real WebRuntime, with every provider
 * reporting available() like dsh-web-deepseek-api does when no key is
 * configured. Each provider answers with the id of the row that registered it.
 */
import { readFileSync } from 'node:fs'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { DEFAULT_PROVIDER_ID } from '../src/host/runtime.ts'

interface Row { id: string; name?: string; disabled?: boolean | null; config?: Record<string, unknown> }

/** The shipped `web` row's provider selection. */
const WEB_CONFIG = { searchProvider: 'deepseek-official', fetchProvider: 'http' }
/** Web rows of @deepseek-ai/dsh-base 0.2.1-rc.2 (packages/bundle/base/cordis.patch.yml). */
const BASE: Row[] = [
  { id: 'web', name: '@deepseek-ai/dsh-web', config: WEB_CONFIG },
  { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-fetch-http', name: '@deepseek-ai/dsh-web-fetch-http' },
]
/** Provider ids each row registers. */
const PROVIDERS: Record<string, { search?: string[]; fetch?: string[] }> = {
  'web-search-deepseek': { search: ['deepseek-official'] },
  'web-deepseek-api': { search: ['deepseek-search-api'], fetch: ['deepseek-fetch-api'] },
  'web-fetch-http': { fetch: ['http'] },
  'web-search-enhanced': { search: [DEFAULT_PROVIDER_ID] },
  // dsh-web-fetch-enhanced replaces web-fetch-http and registers under the same id.
  'web-fetch-enhanced': { fetch: ['http'] },
}
const OWN = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')) as PatchOptions[]
/** The bundle patch of dsh-web-fetch-enhanced 0.1.0. */
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
      ctx.web.registerSearchProvider({ id, available: () => true, search: async () => ({ sources: [{ url: 'https://example.invalid/', title: row.id }], truncated: false }) })
    }
    for (const id of PROVIDERS[row.id]?.fetch ?? []) {
      ctx.web.registerFetchProvider({ id, available: () => true, fetch: async request => ({ url: request.url, statusCode: 200, body: { kind: 'text', content: row.id }, truncated: false }) })
    }
  }
  const search = async () => (await ctx.web.search({ query: 'q' })).sources[0]!.title
  const fetch = async () => { const result = await ctx.web.fetch({ url: 'https://example.invalid/' }); return result.body.kind === 'text' ? result.body.content : undefined }
  return { rows, warnings, web: web.config, search, fetch }
}

describe('bundle composition over the base profile', () => {
  it('takes the native search seat and leaves the shared web row untouched', async () => {
    const { rows, warnings, web, search, fetch } = await compose(OWN)
    expect(warnings).toEqual([])
    expect(web).toEqual(WEB_CONFIG)
    expect(rows.filter(row => row.disabled).map(row => row.id)).toEqual(['web-search-deepseek'])
    await expect(search()).resolves.toBe('web-search-enhanced')
    // Both selections stay pinned, so the always-available DeepSeek API providers never make either ambiguous.
    await expect(fetch()).resolves.toBe('web-fetch-http')
  })

  it.each([['search plugin first', [OWN, FETCH_ENHANCED]], ['fetch plugin first', [FETCH_ENHANCED, OWN]]] as const)(
    'composes with dsh-web-fetch-enhanced (%s)', async (_order, layers) => {
      const { web, search, fetch } = await compose(...layers)
      expect(web).toEqual(WEB_CONFIG)
      await expect(search()).resolves.toBe('web-search-enhanced')
      await expect(fetch()).resolves.toBe('web-fetch-enhanced')
    })

  it('keeps a provider selection written in a later layer usable', async () => {
    // What the built-in Web search page stored when its Search API switch was on.
    const user: PatchOptions[] = [{ id: 'web', config: { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' } }]
    const { search, fetch } = await compose(OWN, FETCH_ENHANCED, user)
    await expect(search()).resolves.toBe('web-deepseek-api')
    await expect(fetch()).resolves.toBe('web-deepseek-api')
  })
})
