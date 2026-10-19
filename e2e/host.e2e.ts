/**
 * The plugin inside a real DSH 0.2.1 composition: installed by the plugin
 * manager into a fresh `web` profile after dsh-web-fetch-enhanced, composed
 * with the shipped base bundle, and booted through the CLI's own steps. Unit
 * tests cover the plugin's parts; these tests cover what only the real
 * composition can show — that the bundle patch lands where it should, that
 * `ctx.web` routes web_search to this plugin, and that web_fetch still reaches
 * the fetch plugin beside it.
 */
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { composedRows, enterIsolatedEnvironment } from './support/environment.ts'
import { type Host, bootHost } from './support/host.ts'

const e2e = inject('e2e')
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name)
const allowLoopback = fixture('allow-loopback.yml')
const coexist = fixture('coexist.yml')

/** A local page that echoes the User-Agent it received. */
const page = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end(`user-agent=${request.headers['user-agent'] ?? ''}`)
})
let url = ''

beforeAll(async () => {
  enterIsolatedEnvironment(e2e.env)
  await new Promise<void>((resolve) => { page.listen(0, '127.0.0.1', resolve) })
  const address = page.address()
  if (address === null || typeof address === 'string') throw new Error('no page address')
  url = `http://127.0.0.1:${address.port}/page`
})

afterAll(async () => {
  page.closeAllConnections()
  await new Promise(resolve => page.close(resolve))
})

/** Outside a session's model request this plugin answers with its own code; the seam's would be WEB_PROVIDER_*. */
const searchOutcome = (host: Host) => host.web.search({ query: 'deepseek harness' }, AbortSignal.timeout(15_000))
  .then(() => 'ok', (error: { code?: string }) => error.code)

describe('composition', () => {
  it('takes the native search seat and leaves the shared web row whole', () => {
    const rows = composedRows(e2e)
    const row = (id: string) => rows.find(entry => entry.id === id)
    // A patch replaces a row's whole config. 0.1.9 rewrote `web` with only
    // searchProvider, dropping fetchProvider and the fetch plugin's seat.
    expect(row('web')?.config).toEqual({ searchProvider: 'deepseek-official', fetchProvider: 'http' })
    expect(row('web-search-deepseek')).toMatchObject({ disabled: true })
    expect(row('web-deepseek-api')?.disabled).toBeFalsy()
    expect(row('web-search-enhanced')).toMatchObject({ name: 'dsh-web-search-enhanced', config: { defaultConnection: 'builtin:exa' } })
    expect(row('web-search-enhanced')?.disabled).toBeFalsy()
    // dsh-web-fetch-enhanced, installed first, keeps the fetch seat.
    expect(row('web-fetch-http')).toMatchObject({ disabled: true })
    expect(row('web-fetch-enhanced')?.disabled).toBeFalsy()
  })
})

describe('runtime', () => {
  let host: Host | undefined
  afterEach(async () => {
    await host?.dispose()
    host = undefined
  })

  it('routes web_search to this plugin and web_fetch to the fetch plugin beside it', async () => {
    host = await bootHost(e2e, [allowLoopback])
    expect(await searchOutcome(host)).toBe('WEB_SEARCH_CONTEXT_UNAVAILABLE')
    // The native provider would refuse loopback; the fetch plugin serves it with its own User-Agent.
    await expect(host.web.fetch({ url }, AbortSignal.timeout(15_000))).resolves.toMatchObject({
      statusCode: 200,
      body: { kind: 'text', content: 'user-agent=wse-e2e/1.0' },
    })
  })

  it('coexists with the native DeepSeek search under another providerId', () => {
    const rows = composedRows(e2e, [coexist])
    const row = (id: string) => rows.find(entry => entry.id === id)
    expect(row('web-search-deepseek')?.disabled).toBeFalsy()
    expect(row('web-search-enhanced')?.config).toMatchObject({ providerId: 'enhanced-search' })
    expect(row('web')?.config).toEqual({ searchProvider: 'enhanced-search', fetchProvider: 'http' })
  })

  it('serves web_search under that providerId without a duplicate registration', async () => {
    host = await bootHost(e2e, [coexist])
    // WEB_PROVIDER_CONFIGURED_MISSING here would mean the plugin failed to register beside the native row.
    expect(await searchOutcome(host)).toBe('WEB_SEARCH_CONTEXT_UNAVAILABLE')
    await expect(host.web.fetch({ url }, AbortSignal.timeout(15_000))).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })
})
