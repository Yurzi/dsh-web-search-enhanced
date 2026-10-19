/**
 * One headless Chromium page driven over the DevTools protocol, the same way
 * scripts/check-ui.mjs drives its fixture, so the suite needs no browser
 * automation dependency. Page code is plain JavaScript strings: helpers on
 * `window.e2e` find elements by role and accessible name the way a user reads
 * the page, and every wait first dismisses the dialogs a fresh DSH home shows.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from './environment.ts'

/** Installed into every document before its own scripts run. */
const PAGE_HELPERS = String.raw`
  window.e2e = (() => {
    const text = element => (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    const nameOf = (element) => {
      const label = element.getAttribute('aria-label')
      if (label) return label.trim()
      const ids = element.getAttribute('aria-labelledby')
      if (ids) return ids.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(text).join(' ')
      return text(element)
    }
    const ROLES = { button: 'button,[role=button]', switch: '[role=switch]', dialog: '[role=dialog],dialog', heading: 'h1,h2,h3,h4,h5,h6,[role=heading]', navigation: 'nav,[role=navigation]', status: '[role=status]' }
    const matches = (element, name) => name === undefined || (name instanceof RegExp ? name.test(nameOf(element)) : nameOf(element) === name)
    const visible = element => element.getClientRects().length > 0
    // A scope that has not rendered yet (null) contains nothing, so waits keep polling.
    const all = (role, name, scope = document) => scope ? [...scope.querySelectorAll(ROLES[role] ?? role)].filter(element => visible(element) && matches(element, name)) : []
    const one = (role, name, scope) => all(role, name, scope)[0]
    const click = (element) => { if (!element) return false; element.click(); return true }
    /** What a fresh home greets the user with; each would cover the page. */
    const dismiss = () => {
      for (const [dialog, button] of [['Preview Notice', 'Continue'], ['Get started', 'Close']]) {
        const found = one('dialog', dialog)
        if (found) click(one('button', button, found))
      }
      click(one('button', 'Configure later'))
    }
    return { text, nameOf, all, one, click, dismiss }
  })()
`

export interface BrowserPage {
  /** Navigate and wait for the document to load. */
  goto(url: string): Promise<void>
  /** Evaluate a JavaScript expression in the page; promises are awaited. */
  evaluate<T>(expression: string): Promise<T>
  /** Poll an expression until it is truthy, dismissing first-run dialogs between tries; an element resolves as `true`. */
  waitFor<T>(expression: string, label: string, timeoutMs?: number): Promise<T>
  screenshot(file: string): Promise<void>
  /** Console errors and uncaught exceptions seen so far. */
  readonly errors: readonly string[]
  close(): Promise<void>
}

/**
 * @param executablePath - Chromium or Chrome.
 * @param viewport - page size in CSS pixels.
 * @returns a blank page with the helpers installed and English locale.
 */
export async function launchBrowser(executablePath: string, viewport: { width: number; height: number }): Promise<BrowserPage> {
  const child = spawn(executablePath, [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-sync', '--no-first-run', '--no-default-browser-check', '--lang=en-US',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(run, 'chromium')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const exited = once(child, 'exit')
  const endpoint = await new Promise<string>((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => { reject(new Error('Chromium printed no DevTools endpoint: ' + stderr)) }, 30_000)
    child.once('error', reject)
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-16_384)
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)
      if (match !== null) {
        clearTimeout(timer)
        resolve(match[1]!)
      }
    })
  })

  const socket = new WebSocket(endpoint)
  await once(socket, 'open')
  let sequence = 0
  let sessionId: string | undefined
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, (params: any) => void>()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }
    if (message.id === undefined) {
      if (message.method !== undefined) listeners.get(message.method)?.(message.params)
      return
    }
    const call = pending.get(message.id)
    pending.delete(message.id)
    if (message.error !== undefined) call?.reject(new Error(JSON.stringify(message.error)))
    else call?.resolve(message.result)
  })
  const send = <T = any>(method: string, params: object = {}): Promise<T> => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
  })

  const { targetId } = await send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
  sessionId = (await send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })).sessionId
  const errors: string[] = []
  listeners.set('Runtime.consoleAPICalled', (params: { type: string; args: { value?: unknown; description?: string }[] }) => {
    if (params.type === 'error') errors.push(params.args.map(arg => String(arg.value ?? arg.description ?? '')).join(' '))
  })
  listeners.set('Runtime.exceptionThrown', (params: { exceptionDetails: { exception?: { description?: string }; text: string } }) => {
    errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text)
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS })
  await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setLocaleOverride', { locale: 'en-US' })

  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await send<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } }>(
      'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true },
    )
    if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  return {
    errors,
    async goto(url) {
      const loaded = new Promise<void>((resolve) => { listeners.set('Page.loadEventFired', () => { resolve() }) })
      await send('Page.navigate', { url })
      await loaded
    },
    evaluate,
    async waitFor<T>(expression: string, label: string, timeoutMs = 30_000): Promise<T> {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        // The helpers exist once the document has started; a navigation in flight may not have them yet.
        // A found element stands for itself as `true`: nodes cannot cross the protocol by value.
        const value = await evaluate<T>(`window.e2e ? (e2e.dismiss(), ((value) => value instanceof Node ? true : value)(${expression})) : undefined`)
        if (value) return value
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    },
    async screenshot(file) {
      const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      await writeFile(file, Buffer.from(data, 'base64'))
    },
    async close() {
      socket.close()
      if (child.exitCode === null) child.kill('SIGTERM')
      await exited
    },
  }
}
