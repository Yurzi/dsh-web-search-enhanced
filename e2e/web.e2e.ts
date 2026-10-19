/**
 * The settings pages in the real DSH Web GUI, driven like a user in headless
 * Chromium: open the plugin, flip a service, confirm the Profile on disk
 * changed sparsely, then route web_search elsewhere in the Profile and see the
 * page say so. dsh-web-fetch-enhanced's page is opened too: it warns when the
 * `web` row stops pinning web_fetch, which is what this plugin's 0.1.9 bundle
 * caused. Each test puts the Profile back the way it found it.
 *
 * Needs a Chromium or Chrome binary: set DSH_E2E_CHROMIUM, otherwise common
 * system paths are tried and the suite is skipped when none exists.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { type BrowserPage, launchBrowser } from './support/browser.ts'
import { artifacts, composedRows } from './support/environment.ts'
import { type WebServer, startWeb } from './support/web.ts'

const e2e = inject('e2e')
const executablePath = [process.env.DSH_E2E_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((path): path is string => path !== undefined && existsSync(path))

const SEARCH = 'dsh-web-search-enhanced'
const FETCH = 'dsh-web-fetch-enhanced'
/** In-page expressions for a plugin's card on the list and its detail view. */
const card = (pkg: string) => `document.querySelector('[data-plugin-package="${pkg}"]')`
const detail = (pkg: string) => `document.querySelector('[data-plugin-detail="${pkg}"]')`
/** The fetch plugin's notice when the `web` row pins no web_fetch provider. */
const UNPINNED_FETCH = 'does not pin a web_fetch provider'

describe.skipIf(executablePath === undefined)('settings pages in DSH Web', () => {
  let server: WebServer
  let page: BrowserPage
  const profilePatch = join(e2e.env.DSH_HOME!, 'profiles/web/cordis.patch.yml')
  const searchConfig = () => composedRows(e2e).find(row => row.id === 'web-search-enhanced')?.config ?? {}
  const shoot = (name: string) => page.screenshot(join(artifacts, `${name}.png`))
  /** Text of the status notices on a plugin's detail view. */
  const notices = (pkg: string) => page.evaluate<string[]>(`e2e.all('status', undefined, ${detail(pkg)}).map(e2e.text)`)

  async function openPluginPage(pkg: string) {
    await page.waitFor("e2e.one('button', 'Plugins', e2e.one('navigation', 'Global panels'))", 'the Plugins panel button', 60_000)
    // From a plugin's detail view the crumb leads back to the list; its accessible name differs from its visible text.
    await page.evaluate(`(() => {
      const open = document.querySelector('[data-plugin-detail]')
      if (open) return e2e.click([...open.querySelectorAll('button')].find(button => button.innerText.trim() === 'Plugins'))
      if (!document.querySelector('[data-plugin-package]')) e2e.click(e2e.one('button', 'Plugins', e2e.one('navigation', 'Global panels')))
    })()`)
    await page.waitFor(`e2e.click(e2e.one('button', /^View /, ${card(pkg)}))`, `${pkg} on the Plugins page`)
    await page.waitFor(`${detail(pkg)}?.querySelector('[data-plugin-config]')`, `${pkg} settings`)
  }

  /** Wait until the Profile on disk satisfies a check, as the Host writes it after the page saved. */
  async function profileSettles(check: () => boolean, label: string) {
    const deadline = Date.now() + 30_000
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for the Profile: ${label}`)
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  beforeAll(async () => {
    server = await startWeb(e2e)
    page = await launchBrowser(executablePath!, { width: 1280, height: 900 })
    await page.goto(server.url)
  })

  afterAll(async () => {
    await page?.close()
    await server?.stop()
  })

  it('shows the plugin with its own title, its settings and no routing notice', async () => {
    await openPluginPage(SEARCH)
    await page.waitFor(`e2e.one('heading', 'Web Search Enhanced', ${detail(SEARCH)})`, 'the plugin title')
    await page.waitFor(`e2e.one('heading', 'Search services', ${detail(SEARCH)}) && e2e.one('switch', 'Enable Tavily', ${detail(SEARCH)})`, 'the services section')
    expect(await notices(SEARCH)).toEqual([])
    await shoot('settings-default')
  })

  it('leaves web_fetch pinned for the fetch plugin installed beside it', async () => {
    await openPluginPage(FETCH)
    await page.waitFor(`e2e.one('heading', 'Web Fetch Enhanced', ${detail(FETCH)})`, 'the fetch plugin title')
    expect(await page.evaluate<string>(`e2e.text(${detail(FETCH)})`)).not.toContain(UNPINNED_FETCH)
    await shoot('fetch-plugin-settings')
  })

  it('writes a service switch to the Profile as a sparse override and removes it again', async () => {
    await openPluginPage(SEARCH)
    const tavily = `e2e.one('switch', 'Enable Tavily', ${detail(SEARCH)})`
    await page.evaluate(`e2e.click(${tavily})`)
    await page.waitFor(`${tavily}?.getAttribute('aria-checked') === 'false'`, 'Tavily turned off')
    await profileSettles(() => (searchConfig().connections as Record<string, unknown> | undefined)?.['builtin:tavily'] !== undefined, 'Tavily override written')
    // The bundle's default connection survives the page's write.
    expect(searchConfig()).toMatchObject({ defaultConnection: 'builtin:exa', connections: { 'builtin:tavily': { disabled: true } } })

    await page.evaluate(`e2e.click(${tavily})`)
    await page.waitFor(`${tavily}?.getAttribute('aria-checked') === 'true'`, 'Tavily turned on')
    await profileSettles(() => (searchConfig().connections as Record<string, unknown> | undefined)?.['builtin:tavily'] === undefined, 'Tavily override removed')
    expect(searchConfig()).toMatchObject({ defaultConnection: 'builtin:exa' })
  })

  it('says so when the Profile routes web_search to the DeepSeek Search API', async () => {
    const original = readFileSync(profilePatch, 'utf8')
    // What the built-in Web search page's switch leaves in the user layer.
    writeFileSync(profilePatch, `${original}\n- id: web\n  config:\n    searchProvider: deepseek-search-api\n    fetchProvider: http\n`)
    try {
      await openPluginPage(SEARCH)
      await page.waitFor(`e2e.all('status', undefined, ${detail(SEARCH)}).some(element => /DeepSeek Search API/.test(e2e.text(element)))`, 'the routing notice', 60_000)
      expect((await notices(SEARCH)).join(' ')).toContain('back to deepseek-official')
      await shoot('settings-routing-notice')
    } finally {
      writeFileSync(profilePatch, original)
    }
    await page.waitFor(`!e2e.all('status', undefined, ${detail(SEARCH)}).some(element => /DeepSeek Search API/.test(e2e.text(element)))`, 'the notice to clear', 60_000)
  })

  it('logs no browser errors', () => {
    writeFileSync(join(artifacts, 'console-errors.json'), JSON.stringify(page.errors, null, 2))
    expect(page.errors).toEqual([])
  })
})
