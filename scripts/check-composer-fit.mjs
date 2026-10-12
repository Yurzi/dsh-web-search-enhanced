/**
 * Isolated real-browser check for the selector's narrow-width degradation:
 * L2.5 (28px icon seat) and L3 (yield the seat before DSH's control row wraps),
 * on both DSH's desktop row and the dsh-mobile >=0.6.3 flex toolbar. Never
 * connects to a running DSH.
 * Usage: node scripts/check-composer-fit.mjs [--screenshots <dir>]
 */
import { build } from 'tsdown'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(join(tmpdir(), 'dsh-search-fit-'))
const shotIndex = process.argv.indexOf('--screenshots')
const shots = shotIndex < 0 ? undefined : resolve(process.argv[shotIndex + 1] ?? join(root, '.dsh-smoke-home/composer-fit'))
const RESHOW_MARGIN = 4

// DSH ui-conversation InputBar and ui-model-selection ModelSelect rules, with readable class names.
const dshCss = `
.frame{width:760px;margin:0 auto}
.card{box-sizing:border-box;width:100%;border-radius:24px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 .5px var(--dsw-alias-border-l2);font-size:14px;line-height:24px;display:flex;flex-direction:column;gap:12px;padding-top:8px}
.input{min-height:52px;padding:4px 8px 0 14px;color:var(--dsw-alias-label-caption)}
.row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex;container-type:inline-size}
.row[data-model-compact]{--dsh-composer-model-text-display:none;--dsh-composer-model-icon-display:block}
.tools,.modes,.trailing{align-items:center;min-width:0;display:flex}
.tools,.modes{gap:12px}
.trailing{flex:none;gap:12px;margin-left:auto}
@container (width<=560px){.tools,.modes,.trailing{gap:8px}}
.add{background:var(--dsw-specific-selector,var(--dsw-alias-interactive-bg-hover));width:28px;height:28px;color:inherit;border:none;border-radius:999px;flex:none;place-items:center;display:grid;padding:0}
.standardControls{align-items:center;gap:12px;min-width:0;display:flex}
.tools[hidden],.standardControls[hidden]{display:none}
.activity{flex:none;align-items:center;display:flex}
.primary{background:var(--dsw-alias-button-info-fill,#4d6bfe);color:#fff;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;display:grid;transform:translateY(-2px);padding:0}
.mode{display:flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary)}
.icon{width:28px;height:28px;display:grid;place-items:center;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary)}
.otherPlugin{display:inline-flex}
.modelRoot{min-width:0;position:relative}
.modelTrigger{border-radius:8px;min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;line-height:20px;display:flex}
.modelLabel,.modelEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden;display:var(--dsh-composer-model-text-display,block)}
.modelEffort{flex-shrink:1000;color:var(--dsw-alias-label-caption)}
.modelIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}
`
// Adapted from saya-ch/dsh-mobile 0.6.4 src/mobile-composer-toolbar.ts (Apache-2.0), test fixture only.
const dshMobileCss = `
[data-dsh-mobile-composer-row] { min-width:0 !important; max-width:100% !important; }
[data-dsh-mobile-composer-tools]:not([hidden]),[data-dsh-mobile-composer-controls]:not([hidden]) { flex-wrap:wrap !important; min-width:0 !important; max-width:100% !important; }
[data-dsh-mobile-composer-tools] > :not(:where(dialog,[popover],[role="dialog"],[role="menu"],[role="listbox"],[data-trigger-menu])),
[data-dsh-mobile-composer-tools] > [data-slot] > :not(:where(dialog,[popover],[role="dialog"],[role="menu"],[role="listbox"],[data-trigger-menu])),
[data-dsh-mobile-composer-controls] > :not(:where(dialog,[popover],[role="dialog"],[role="menu"],[role="listbox"],[data-trigger-menu])),
[data-dsh-mobile-composer-controls] > [data-slot] > :not(:where(dialog,[popover],[role="dialog"],[role="menu"],[role="listbox"],[data-trigger-menu])) { min-width:0 !important; max-width:100% !important; }
[data-dsh-mobile-composer-tools] button:not(:where(dialog *,[popover] *,[role="dialog"] *,[role="menu"] *,[role="listbox"] *,[data-trigger-menu] *)),
[data-dsh-mobile-composer-controls] button:not(:where(dialog *,[popover] *,[role="dialog"] *,[role="menu"] *,[role="listbox"] *,[data-trigger-menu] *)) { white-space:normal !important; overflow-wrap:anywhere !important; }
@media (max-width:720px) {
  [data-dsh-mobile-composer-row] button:not([role="switch"]):not(:where(dialog *,[popover] *,[role="dialog"] *,[role="menu"] *,[role="listbox"] *,[data-trigger-menu] *)) { min-width:44px !important; min-height:44px !important; touch-action:manipulation; }
  :is([data-dsh-mobile-composer-tools],[data-dsh-mobile-composer-controls]) > :is([data-slot="conversation.input.left"],[data-slot="conversation.input.right"]) > :where(span,div):not(:where(dialog,[popover],[role="dialog"],[role="menu"],[role="listbox"],[data-trigger-menu])):has(> button:not([role="switch"])) { min-width:44px !important; min-height:44px !important; flex-shrink:0 !important; }
  [data-dsh-mobile-composer-trailing] > button[class*="primary"] { min-width:44px !important; flex-shrink:0 !important; }
  [data-dsh-mobile-composer-row] { display:flex !important; flex-wrap:wrap !important; align-items:center !important; gap:4px 8px !important; min-width:0 !important; max-width:100% !important; }
  [data-dsh-mobile-composer-tools]:not([hidden]) { display:flex !important; flex:0 1 auto !important; flex-wrap:wrap !important; width:auto !important; min-width:0 !important; max-width:100% !important; gap:6px !important; }
  [data-dsh-mobile-composer-trailing] { display:flex !important; flex:1 0 auto !important; flex-wrap:nowrap !important; width:auto !important; min-width:0 !important; max-width:100% !important; gap:6px !important; margin-left:0 !important; justify-content:flex-end !important; }
  [data-dsh-mobile-composer-controls]:not([hidden]) { display:flex !important; flex:1 1 0 !important; flex-wrap:wrap !important; justify-content:flex-end !important; min-width:44px !important; max-width:100% !important; gap:6px !important; }
  [data-dsh-mobile-composer-model] { flex:0 1 auto !important; width:auto !important; min-width:44px !important; max-width:100% !important; }
  [data-dsh-mobile-composer-model-trigger] { box-sizing:border-box !important; width:100% !important; max-width:100% !important; min-width:0 !important; padding-left:6px !important; padding-right:4px !important; }
  [data-dsh-mobile-composer-model-label] { flex:1 1 auto !important; max-width:none !important; min-width:0 !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
}
`

function deadline(promise, label, ms = 60000) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms) })]).finally(() => clearTimeout(timer))
}

async function chromium(name, width, height, dark = false) {
  const child = spawn(process.env.CHROMIUM ?? 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-sync', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + join(temp, 'profile-' + name), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve) })
  let stderr = '', socket, sequence = 0, sessionId
  const pending = new Map()
  const close = async () => {
    if (socket && socket.readyState < 2) socket.close()
    for (const call of pending.values()) call.reject(Error('Browser cleanup'))
    pending.clear()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    try { await deadline(exited, 'Chromium shutdown', 3000) } catch { child.kill('SIGKILL'); await deadline(exited, 'Chromium forced shutdown', 3000) }
  }
  try {
    const endpoint = await deadline(new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => reject(Error('Chromium exited before CDP startup: ' + stderr)))
      child.stderr.on('data', data => {
        stderr = (stderr + data.toString()).slice(-16384)
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
        if (match) resolve(match[1])
      })
    }), 'Chromium CDP startup', 30000)
    socket = new WebSocket(endpoint)
    await deadline(once(socket, 'open'), 'CDP connection')
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)), call = pending.get(message.id)
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
      return deadline(result, method).finally(() => pending.delete(id))
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
    await send('Page.navigate', { url: pathToFileURL(join(temp, 'index.html')).href })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await deadline((async () => { while (await evaluate("document.getElementById('result')?.textContent") !== 'ready') await new Promise(r => setTimeout(r, 50)) })(), 'Fixture ready', 20000)
    const screenshot = async file => {
      if (!shots) return
      const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
      await writeFile(join(shots, file), Buffer.from(data, 'base64'))
    }
    return { evaluate, screenshot, close }
  } catch (error) { await close(); throw error }
}

const checks = []
function check(ok, name, detail) {
  assert.ok(ok, name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)))
  checks.push(name)
}

async function desktop() {
  const page = await chromium('desktop', 1000, 420)
  try {
    const wide = await page.evaluate('fit.width(760)')
    check(wide.selectorVisible && wide.label && wide.chevron && !wide.compact && !wide.wrapped, 'wide composer keeps the full selector on one line', wide)
    await page.screenshot('desktop-760-full.png')
    const down = await page.evaluate('fit.sweep(560, 220, -2)')
    for (const s of down) {
      if (s.selectorVisible) check(s.oneLine && !s.wrapped, 'visible selector never shares a wrapped row @' + s.width, s)
      if (s.selectorVisible && !s.label) check(!s.chevron && Math.abs(s.triggerWidth - 28) < 0.5, 'icon-only trigger is a 28px seat without chevron @' + s.width, s)
    }
    const firstHidden = down.findIndex(s => s.hidden)
    check(firstHidden > 0, 'selector collapses within the sweep', down.at(-1))
    const collapseAt = down[firstHidden].width
    check(down.slice(firstHidden).every(s => s.hidden), 'collapse is monotonic while narrowing')
    const before = down[firstHidden - 1]
    check(before.selectorVisible && before.compact && !before.label, 'L2.5 icon seat precedes L3 collapse', before)
    check(down.at(-1).toggles === 1, 'narrowing toggles hidden exactly once', down.at(-1))
    await page.evaluate('fit.width(' + (collapseAt + 6) + ')')
    await page.screenshot('desktop-' + (collapseAt + 6) + '-compact.png')
    await page.evaluate('fit.width(' + (collapseAt - 6) + ')')
    await page.screenshot('desktop-' + (collapseAt - 6) + '-collapsed.png')

    const { toggles: beforeUp } = await page.evaluate('fit.state()')
    const up = await page.evaluate('fit.sweep(220, 560, 1)')
    const firstShown = up.findIndex(s => !s.hidden)
    check(firstShown > 0, 'selector returns while widening', up.at(-1))
    const returnAt = up[firstShown].width
    check(returnAt >= collapseAt && returnAt <= collapseAt + 3, 'selector returns as soon as its compact seat fits', { collapseAt, returnAt })
    check(up.slice(firstShown).every(s => !s.hidden && s.oneLine), 'returned selector stays visible on one line', up.at(-1))
    check(up.at(-1).toggles - beforeUp === 1, 'widening toggles hidden exactly once', up.at(-1))

    for (const width of [collapseAt - 1, collapseAt, returnAt - 1, returnAt]) {
      const settled = await page.evaluate('fit.width(' + width + ').then(async s => { await new Promise(r => setTimeout(r, 300)); return [s, fit.state()] })')
      check(settled[1].toggles === settled[0].toggles && settled[1].hidden === settled[0].hidden, 'no flapping at the boundary @' + width, settled)
    }

    const narrow = collapseAt - 20
    const healthy = await page.evaluate('fit.width(' + narrow + ')')
    check(healthy.hidden, 'healthy selector is collapsed in a crowded row', healthy)
    const error = await page.evaluate("fit.props({ error: '保存失败' })")
    check(error.selectorVisible && error.errorBadge && Math.abs(error.triggerWidth - 28) < 0.5, 'errors pin the selector with a corner badge', error)
    await page.screenshot('desktop-' + narrow + '-pinned-error.png')
    const cleared = await page.evaluate("fit.props({ error: '' })")
    check(cleared.hidden, 'clearing the error collapses it again', cleared)
    const saving = await page.evaluate('fit.props({ pending: true })')
    check(saving.selectorVisible, 'saving pins the selector', saving)
    await page.evaluate('fit.props({ pending: false })')
    const missing = await page.evaluate("fit.props({ connectionId: 'builtin:removed' })")
    check(missing.selectorVisible, 'an unavailable connection pins the selector', missing)
    const off = await page.evaluate('fit.props({ connectionId: null })')
    check(off.hidden, 'a deliberate off selection may collapse', off)
    return { collapseAt, returnAt }
  } finally { await page.close() }
}

async function mobile() {
  // 700px still matches dsh-mobile's (max-width:720px) touch layout and starts with room to spare.
  const page = await chromium('mobile', 700, 640)
  try {
    const full = await page.evaluate('fit.mobile()')
    check(full.selectorVisible && full.oneLine, 'dsh-mobile row keeps the selector while it fits', full)
    check(full.triggerHeight >= 44, 'dsh-mobile touch target applies to the trigger', full)
    check(!full.label || full.labelHeight <= 22, 'label stays on one line inside dsh-mobile buttons', full)
    check(parseFloat(full.triggerMaxWidth) <= 180 || full.triggerMaxWidth.includes('180px'), 'mobile trigger keeps its width cap', full)
    await page.screenshot('mobile-700.png')
    const down = await page.evaluate('fit.sweep(668, 240, -2)')
    for (const s of down) {
      if (s.selectorVisible) check(s.oneLine, 'mobile selector never shares a wrapped row @' + s.width, s)
      if (s.selectorVisible && !s.label) check(!s.chevron && s.triggerWidth >= 44, 'mobile icon seat keeps the 44px target @' + s.width, s)
      if (s.selectorVisible && s.label) check(s.labelHeight <= 22, 'mobile label stays on one line @' + s.width, s)
    }
    const firstHidden = down.findIndex(s => s.hidden)
    check(firstHidden > 0, 'dsh-mobile row collapses the selector before wrapping', down.at(-1))
    const collapseAt = down[firstHidden].width
    check(down.slice(firstHidden).every(s => s.hidden), 'mobile collapse is monotonic while narrowing')
    await page.evaluate('fit.width(' + (collapseAt - 10) + ')')
    await page.screenshot('mobile-' + (collapseAt - 10) + '-collapsed.png')
    const { toggles: beforeUp } = await page.evaluate('fit.state()')
    const up = await page.evaluate('fit.sweep(240, 668, 1)')
    const firstShown = up.findIndex(s => !s.hidden)
    check(firstShown > 0, 'mobile selector returns while widening', up.at(-1))
    const returnAt = up[firstShown].width
    check(returnAt >= collapseAt && returnAt <= collapseAt + 3, 'mobile selector returns as soon as it fits', { collapseAt, returnAt })
    check(up.slice(firstShown).every(s => !s.hidden && s.oneLine), 'returned mobile selector stays on one line', up.at(-1))
    check(up.at(-1).toggles - beforeUp === 1, 'mobile widening toggles hidden exactly once', up.at(-1))
    await page.evaluate('fit.width(' + (returnAt + 4) + ')')
    await page.screenshot('mobile-' + (returnAt + 4) + '-returned.png')
    return { collapseAt, returnAt }
  } finally { await page.close() }
}

try {
  if (shots) await mkdir(shots, { recursive: true })
  await build({ config: false, cwd: root, entry: join(root, 'scripts/fixtures/composer-fit.tsx'), outDir: temp, format: 'iife', platform: 'browser', dts: false, logLevel: 'warn', deps: { alwaysBundle: () => true, onlyBundle: false }, define: { 'process.env.NODE_ENV': '"production"' } })
  const theme = await readFile(join(root, 'scripts/fixtures/dsh-theme.css'), 'utf8')
  await writeFile(join(temp, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${theme}
*{box-sizing:border-box}body{margin:16px;font-family:Arial,sans-serif;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}#result{display:none}
${dshCss}${dshMobileCss}</style><body><pre id="result">waiting</pre><div id="app"></div><script src="composer-fit.iife.js"></script></body></html>`)
  const result = await desktop()
  const phone = await mobile()
  console.log(checks.length + ' composer-fit browser checks passed; desktop collapse/return at ' + result.collapseAt + '/' + result.returnAt + 'px, dsh-mobile at ' + phone.collapseAt + '/' + phone.returnAt + 'px card width' + (shots ? '; screenshots in ' + shots : ''))
} finally { await rm(temp, { recursive: true, force: true }) }
