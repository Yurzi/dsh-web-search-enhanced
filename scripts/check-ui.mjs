/**
 * Real-browser checks of the composer search seat and the settings page,
 * rendered with the DSH theme sheets at desktop, 390px and dark sizes. Runs an
 * isolated fixture (scripts/fixtures/ui.tsx); never connects to a DSH.
 * Usage: node scripts/check-ui.mjs [--screenshots <dir>] [--lang en]
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'tsdown'
import { cssModules, primitivesStub } from './client-build.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const shots = argument('--screenshots') && resolve(argument('--screenshots'))
const lang = argument('--lang') ?? 'zh'
const temp = await mkdtemp(join(tmpdir(), 'dsh-search-ui-'))

const deadline = (promise, label, ms = 30000) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]).finally(() => clearTimeout(timer))
}

/** One headless Chromium page driven over the DevTools protocol. */
async function openPage({ name, width, height, dark, query }) {
  const child = spawn(process.env.CHROMIUM ?? 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-sync', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + join(temp, 'profile-' + name), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve) })
  let stderr = ''
  let socket
  let sequence = 0
  let sessionId
  const pending = new Map()
  const close = async () => {
    if (socket && socket.readyState < 2) socket.close()
    for (const call of pending.values()) call.reject(Error('browser closed'))
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    try { await deadline(exited, 'Chromium shutdown', 3000) } catch { child.kill('SIGKILL') }
  }
  try {
    const endpoint = await deadline(new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => reject(Error('Chromium exited before CDP startup: ' + stderr)))
      child.stderr.on('data', data => {
        stderr = (stderr + data).slice(-16384)
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
        if (match) resolve(match[1])
      })
    }), 'Chromium startup')
    socket = new WebSocket(endpoint)
    await deadline(once(socket, 'open'), 'CDP connection')
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      if (message.error) call.reject(Error(JSON.stringify(message.error)))
      else call.resolve(message.result)
    })
    const send = (method, params = {}) => {
      const id = ++sequence
      const result = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
      return deadline(result, method)
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
    await send('Page.navigate', { url: pathToFileURL(join(temp, 'index.html')).href + '?' + new URLSearchParams({ ...query, lang, ...(dark ? { dark: '1' } : {}) }) })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await deadline((async () => {
      while (await evaluate("document.getElementById('result')?.textContent") !== 'ready') await new Promise(r => setTimeout(r, 50))
    })(), 'fixture ready')
    const screenshot = async (file, fullPage = false) => {
      if (!shots) return
      const { cssContentSize } = await send('Page.getLayoutMetrics')
      const clip = fullPage ? { x: 0, y: 0, width, height: Math.ceil(cssContentSize.height), scale: 1 } : undefined
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, ...(clip ? { clip } : {}) })
      await writeFile(join(shots, file), Buffer.from(data, 'base64'))
    }
    return { evaluate, screenshot, close }
  } catch (error) { await close(); throw error }
}

const checks = []
const check = (ok, label, detail) => { assert.ok(ok, label + (detail === undefined ? '' : ': ' + JSON.stringify(detail))); checks.push(label) }

/** In-page helpers shared by both views. */
const helpers = String.raw`
  window.wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
  window.q = s => document.querySelector(s);
  window.qa = s => [...document.querySelectorAll(s)];
  window.byText = (s, text) => qa(s).find(e => e.textContent.includes(text));
  window.rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } };
  window.press = (key, target = document.activeElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
`

async function selectorChecks({ name, width, height, dark }) {
  const page = await openPage({ name: 'selector-' + name, width, height, dark, query: { view: 'selector' } })
  try {
    await page.evaluate(helpers)
    const closed = await page.evaluate("({ trigger: rect(q('[aria-haspopup=menu]')), label: getComputedStyle(q('[aria-haspopup=menu] span')).display, row: rect(q('#row')) })")
    check(Math.round(closed.trigger.height) === 28, name + ': trigger is a 28px seat', closed)
    if (width <= 420) check(Math.round(closed.trigger.width) === 28 && closed.label === 'none', name + ': narrow row collapses the seat to its icon', closed)
    else check(closed.label !== 'none' && closed.trigger.width > 28, name + ': wide row shows the connection name', closed)

    const opened = await page.evaluate("(async () => { q('[aria-haspopup=menu]').click(); await wait(120); const menu = q('[role=group][aria-busy]'); return { menu: menu && rect(menu), viewport: [innerWidth, innerHeight], focused: document.activeElement.textContent, inBody: menu?.parentElement === document.body || !q('#row').contains(menu) } })()")
    check(opened.menu && opened.menu.left >= 0 && opened.menu.right <= width && opened.menu.top >= 0 && opened.menu.bottom <= height, name + ': menu fits the viewport', opened)
    check(opened.inBody, name + ': menu is portaled out of the composer', opened)
    check(opened.focused.startsWith('Exa'), name + ': opening focuses the row in use', opened)
    const moved = await page.evaluate("(press('ArrowDown'), document.activeElement.textContent)")
    check(moved.startsWith('Firecrawl'), name + ': arrow keys walk the rows', moved)
    if (shots) await page.screenshot('selector-' + name + '.png')

    const chosen = await page.evaluate("(async () => { byText('[role=menuitemradio]', 'Firecrawl').click(); await wait(120); return { writes: fixture.writes, open: !!q('[role=menu]'), label: q('[aria-haspopup=menu]').textContent, focus: document.activeElement === q('[aria-haspopup=menu]') } })()")
    check(chosen.writes.length === 1 && chosen.writes[0].connectionId === 'builtin:firecrawl' && chosen.writes[0].expectedRevision === 0, name + ': a choice writes with the shown revision', chosen)
    check(!chosen.open && chosen.focus, name + ': a choice closes the menu and returns focus', chosen)

    const fresh = await page.evaluate("(async () => { q('[aria-haspopup=menu]').click(); await wait(120); qa('[role=tab]')[2].click(); await wait(120); return { write: fixture.writes.at(-1), hint: q('[role=tablist]').parentElement.textContent, label: q('[aria-haspopup=menu]').textContent } })()")
    check(fresh.write.freshness === 'realtime' && !('connectionId' in fresh.write), name + ': freshness writes only freshness', fresh)
    const escaped = await page.evaluate("(async () => { press('Escape'); await wait(60); return { open: !!q('[role=menu]'), focus: document.activeElement === q('[aria-haspopup=menu]') } })()")
    check(!escaped.open && escaped.focus, name + ': Escape closes and restores focus', escaped)

    const conflict = await page.evaluate("(async () => { fixture.refuseNext(); q('[aria-haspopup=menu]').click(); await wait(120); byText('[role=menuitemradio]', 'Tavily').click(); await wait(200); return document.body.textContent })()")
    check(/已在别处更改|changed elsewhere/.test(conflict), name + ': a conflict is announced', conflict.slice(-200))
    await page.evaluate("(async () => { press('Escape'); await fixture.setView({ connectionId: 'builtin:semanticscholar', freshness: 'auto' }); await wait(80) })()")
    const issue = await page.evaluate("({ title: q('[aria-haspopup=menu]').title, dot: !!q('[aria-haspopup=menu] [class*=attention]') })")
    check(/Semantic Scholar/.test(issue.title) && issue.dot, name + ': a connection that cannot search is flagged with its reason', issue)
    if (shots && name === 'desktop') {
      await page.evaluate("(async () => { q('[aria-haspopup=menu]').click(); await wait(150) })()")
      await page.screenshot('selector-not-ready.png')
    }
  } finally { await page.close() }
}

async function settingsChecks({ name, width, height, dark }) {
  const page = await openPage({ name: 'settings-' + name, width, height, dark, query: { view: 'settings' } })
  try {
    await page.evaluate(helpers)
    const layout = await page.evaluate("({ sections: qa('[data-plugin-config] h4').length, overflow: document.documentElement.scrollWidth - innerWidth })")
    check(layout.sections === 4, name + ': settings render their four titled sections', layout)
    check(layout.overflow <= 0, name + ': no horizontal overflow', layout)
    const routed = await page.evaluate("(async () => { const before = qa('[data-plugin-config] [role=status]').length; fixture.setRoute({ kind: 'other', provider: 'deepseek-search-api', providerId: 'deepseek-official' }); await wait(60); const notice = byText('[data-plugin-config] [role=status]', 'deepseek-official'); const result = { before, notice: notice && rect(notice), frame: rect(q('[data-plugin-config]')), overflow: document.documentElement.scrollWidth - innerWidth }; fixture.setRoute({ kind: 'this' }); await wait(60); return result })()")
    check(routed.before === 0 && routed.notice && routed.notice.right <= routed.frame.right + 0.5 && routed.overflow <= 0, name + ': a provider notice wraps inside the page', routed)
    const toggled = await page.evaluate("(async () => { byText('li', 'Tavily').querySelector('[role=switch]').click(); await wait(80); return { write: fixture.writes.at(-1), checked: byText('li', 'Tavily').querySelector('[role=switch]').getAttribute('aria-checked') } })()")
    check(JSON.stringify(toggled.write.ops) === JSON.stringify([{ op: 'set', path: ['connections', 'builtin:tavily', 'disabled'], value: true }]) && toggled.checked === 'false', name + ': a service switch writes one sparse operation', toggled)
    const opened = await page.evaluate("(async () => { byText('li', 'Semantic Scholar').querySelector('button[aria-expanded]').click(); await wait(80); return !!byText('li', 'Semantic Scholar').querySelector('input[type=password]') })()")
    check(opened, name + ': configuring a key-only service shows the key editor')
    const saved = await page.evaluate("(async () => { const before = fixture.writes.length; const input = byText('li', 'Semantic Scholar').querySelector('input[type=password]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'key-value'); input.dispatchEvent(new Event('input', { bubbles: true })); await wait(30); input.form.requestSubmit(); await wait(80); return { keys: fixture.keys, writes: fixture.writes.length - before } })()")
    check(saved.keys.join() === 'SEMANTIC_SCHOLAR_API_KEY' && saved.writes === 0, name + ': saving a key never writes settings', saved)
    await page.evaluate("(async () => { byText('li', 'Semantic Scholar').querySelector('button[aria-expanded]').click(); byText('li', 'Firecrawl').querySelector('button[aria-expanded]').click(); await wait(120); window.scrollTo(0, 0) })()")
    await page.screenshot('settings-' + name + '.png', true)

    const editor = await page.evaluate("(async () => { const add = qa('[data-plugin-config] button').find(b => /添加搜索模型|Add search model/.test(b.textContent)); add.click(); await wait(100); const form = q('form[aria-labelledby]'); const field = suffix => [...form.querySelectorAll('input')].find(i => i.id.endsWith(suffix)); const type = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }; const before = !!form.querySelector('input[type=checkbox]'); type(field('-label'), 'Team search'); type(field('-id'), 'team-search'); type(field('-model'), 'search-1'); type(field('-base'), 'https://gateway.example/v1'); await wait(60); const save = form.querySelector('button[type=submit]'); return { before, after: !!form.querySelector('input[type=checkbox]'), ref: field('-ref').value, saveDisabled: save.disabled, columns: getComputedStyle(form.querySelector('[class*=formGrid]')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth - innerWidth } })()")
    check(!editor.before && editor.after && editor.saveDisabled, name + ': trust is asked once a Base URL is entered and gates saving', editor)
    check(editor.ref === 'CUSTOM_TEAM_SEARCH_API_KEY', name + ': the credential reference follows the id', editor)
    check(editor.columns === (width <= 420 ? 1 : 2), name + ': the connection form uses a regular grid', editor)
    check(editor.overflow <= 0, name + ': the connection form fits the page', editor)
    if (name === 'desktop') {
      await page.evaluate("(async () => { byText('li', 'Firecrawl').querySelector('button[aria-expanded]').click(); await wait(80); window.scrollTo(0, q('form[aria-labelledby]').getBoundingClientRect().top + scrollY - 120) })()")
      await page.screenshot('settings-editor.png')
    }
  } finally { await page.close() }
}

try {
  if (shots) await mkdir(shots, { recursive: true })
  await build({
    config: false, cwd: root, entry: { ui: join(root, 'scripts/fixtures/ui.tsx') }, outDir: temp, format: 'iife', platform: 'browser',
    dts: false, logLevel: 'warn', deps: { alwaysBundle: () => true, onlyBundle: false },
    plugins: [cssModules('dsh-web-search-enhanced'), primitivesStub()],
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.MODE': '"production"', 'import.meta.env': '{"MODE":"production"}' },
  })
  const theme = await readFile(join(root, 'scripts/fixtures/dsh-theme.css'), 'utf8')
  const shell = await readFile(join(root, 'scripts/fixtures/shell.css'), 'utf8')
  await writeFile(join(temp, 'index.html'), '<!doctype html><html lang="' + lang + '"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + theme + shell
    + '</style><body><script>if (location.search.includes("dark=1")) document.body.setAttribute("data-ds-dark-theme", "")</script><pre id="result">waiting</pre><div id="app"></div><script src="ui.iife.js"></script></body></html>')
  const sizes = [
    { name: 'desktop', width: 1280, height: 820, dark: false },
    { name: 'narrow', width: 390, height: 844, dark: false },
    { name: 'dark', width: 1280, height: 820, dark: true },
  ]
  for (const size of sizes) await selectorChecks(size)
  for (const size of sizes) await settingsChecks(size)
  console.log(checks.length + ' browser checks passed' + (shots ? '; screenshots in ' + shots : ''))
} finally {
  await rm(temp, { recursive: true, force: true })
}