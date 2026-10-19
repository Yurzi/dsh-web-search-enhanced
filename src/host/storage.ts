/** The plugin's storage-domain: session selections and model pairings. */
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { FRESHNESS } from '../catalog.ts'
import { searchError } from '../search/errors.ts'

/** `freshness` is absent in records written before 0.1.7; reads fill it once. */
const storedSelection = z.object({
  connectionId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  freshness: z.enum(FRESHNESS).optional(),
}).strict()

/** Connection a model was last paired with; `null` pairs it with search off. */
const pairing = z.object({ connectionId: z.string().nullable() }).strict()

export type StoredSelection = z.output<typeof storedSelection>
export type Pairing = z.output<typeof pairing>

export const searchDomain = defineDomain({
  name: 'web_search_enhanced',
  version: 1,
  tables: {
    selections: domainTable<string, StoredSelection>(storedSelection),
    pairings: domainTable<string, Pairing>(pairing),
  },
})

export type SearchDomain = Domain<typeof searchDomain>

/**
 * Opens the domain on first use through whichever storage-domain facility is
 * mounted now, so a late or remounted facility is picked up and a failed open
 * is retried by the next caller.
 */
export class SearchStorage {
  private opened: { readonly facility: DomainFacility; readonly domain: Promise<SearchDomain> } | undefined

  constructor(private readonly ctx: Context) {
    ctx.effect(() => async () => {
      await this.opened?.domain.then(domain => domain.close(), () => {})
      this.opened = undefined
    }, 'web-search-enhanced storage')
  }

  async domain(): Promise<SearchDomain> {
    const facility = this.ctx.get('storageDomain')
    if (facility === undefined) throw unavailable()
    if (this.opened?.facility !== facility) this.opened = { facility, domain: facility.open(searchDomain) }
    const { domain } = this.opened
    try {
      return await domain
    } catch (error) {
      if (this.opened?.domain === domain) this.opened = undefined
      this.ctx.logger.warn('web-search-enhanced: opening the search storage failed: %s', error instanceof Error ? error.message : String(error))
      throw unavailable()
    }
  }
}

const unavailable = () => searchError('WEB_SEARCH_STORAGE_UNAVAILABLE', 'the search selection storage is unavailable; the next request retries. If it persists, ask the user to check the DSH storage backend')
