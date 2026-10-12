import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESHOW_MARGIN, findControlRow, observeCrowdedRow, rowOnOneLine } from '../src/client/crowded-row.ts'

type Layout = { width: number; top?: number; height?: number }
/** Minimal element with the DOM surface the observer reads; geometry comes from a layout model. */
class Box {
  parentElement: Box | null = null
  children: Box[] = []
  attrs = new Map<string, string>()
  writes = 0
  style = { display: 'block' }
  constructor(private layout: () => Layout = () => ({ width: 0 }), readonly tag = 'div') {}
  append(...boxes: Box[]) { for (const box of boxes) { box.parentElement = this; this.children.push(box) } return this }
  hasAttribute(name: string) { return this.attrs.has(name) }
  setAttribute(name: string, value: string) { this.writes++; this.attrs.set(name, value) }
  removeAttribute(name: string) { if (this.attrs.delete(name)) this.writes++ }
  get hidden() { return this.attrs.has('hidden') }
  set hidden(value: boolean) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden') }
  /** Supports `[attr]` lists, plus `dialog` as a tag, enough for the observer's selectors. */
  closest(selector: string) {
    const parts = selector.split(',')
    const matches = (box: Box) => parts.some(part => part === box.tag || (/^\[([\w-]+)\]$/.exec(part)?.[1] ?? '\0') !== '\0' && box.attrs.has(/^\[([\w-]+)\]$/.exec(part)![1]!))
    for (let box: Box | null = this; box; box = box.parentElement) if (matches(box)) return box
    return null
  }
  querySelectorAll(selector: string): Box[] {
    if (selector !== 'button') throw new Error('unsupported selector ' + selector)
    return this.children.flatMap(child => [...(child.tag === 'button' ? [child] : []), ...child.querySelectorAll('button')])
  }
  rendered() { for (let box: Box | null = this; box; box = box.parentElement) if (box.hidden) return false; return true }
  getBoundingClientRect() {
    if (!this.rendered()) return { width: 0, height: 0, top: 0, bottom: 0 }
    const { width, top = 0, height = 28 } = this.layout()
    return { width, height, top, bottom: top + height }
  }
}
const el = (box: Box) => box as unknown as HTMLElement
const COMPACT = 'data-model-compact'

/**
 * DSH InputBar shape: row(padding 8+8, gap 12) > tools | trailing > controls(gap 12) >
 * [display:contents slot anchor > selector] + model seat, then send. The trailing
 * group drops to a second line when the two groups cannot share one.
 */
function composer(width: number, sizes = { tools: 80, modelExpanded: 120 }) {
  const layout = { width, hostSlack: 0 }
  const compact = (): boolean => row.hasAttribute(COMPACT)
  const seat = (): number => compact() ? 28 : 80
  const model = (): number => compact() ? 44 : sizes.modelExpanded
  const controlsWidth = (): number => (node.rendered() ? seat() + 12 : 0) + model()
  const trailingWidth = (): number => (controls.rendered() ? controlsWidth() + 8 : 0) + 34
  const top = (): number => sizes.tools + 12 + trailingWidth() <= layout.width - 16 ? 0 : 40
  const node: Box = new Box(() => ({ width: seat(), top: top() }))
  node.append(new Box(() => ({ width: seat(), top: top() }), 'button'))
  const anchor = new Box()
  anchor.style.display = 'contents'
  const controls: Box = new Box(() => ({ width: controlsWidth(), top: top() }))
  controls.style.display = 'flex'
  const trailing: Box = new Box(() => ({ width: trailingWidth(), top: top() }))
  const tools: Box = new Box(() => ({ width: sizes.tools }))
  const row: Box = new Box(() => ({ width: layout.width, height: top() ? 74 : 34 }))
  const card = new Box()
  card.attrs.set('data-composer-card', '')
  card.append(new Box(), row)
  row.append(tools, trailing)
  tools.append(new Box(() => ({ width: 28 }), 'button'))
  trailing.append(controls, new Box(() => ({ width: 34, top: top() - 2, height: 34 }), 'button'))
  controls.append(anchor, new Box(() => ({ width: model(), top: top() })))
  anchor.append(node)
  /** DSH observeControlRow arithmetic; hostSlack simulates a host that misjudges the fit. */
  const host = () => {
    row.removeAttribute(COMPACT)
    const needed = tools.getBoundingClientRect().width + 12 + trailing.getBoundingClientRect().width
    if (needed > layout.width - 16 + layout.hostSlack) row.setAttribute(COMPACT, '')
  }
  return { layout, row, controls, node, host }
}

const observers: FakeResizeObserver[] = []
class FakeResizeObserver {
  targets = new Set<unknown>()
  constructor(readonly callback: () => void) { observers.push(this) }
  observe(target: unknown) { this.targets.add(target) }
  disconnect() { this.targets.clear() }
}
/** One ResizeObserver broadcast to every connected observer. */
const notify = () => { for (const observer of observers) if (observer.targets.size) observer.callback() }
let frames = new Map<number, () => void>()
let frameId = 0
const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); for (const run of pending) run() }
const disposers: (() => void)[] = []
function observe(node: Box, pinned = () => false) {
  const handle = observeCrowdedRow(el(node), { pinned })
  disposers.push(() => handle.dispose())
  return handle
}
/** A host frame: DSH re-measures, then ResizeObserver delivers. */
const frame = (c: ReturnType<typeof composer>) => { c.host(); notify() }

beforeEach(() => {
  observers.length = 0
  frames = new Map()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('getComputedStyle', (box: Box) => box.style)
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => { frames.set(++frameId, run); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  vi.unstubAllGlobals()
})

describe('crowded composer row collapse (L3)', () => {
  it('locates DSH control row through the stable composer-card attribute', () => {
    const c = composer(400)
    expect(findControlRow(el(c.node))).toBe(c.row)
    expect(findControlRow(el(new Box()))).toBeNull()
  })

  it('judges one line from rendered controls, ignoring popups and collapsed boxes', () => {
    const row = new Box(() => ({ width: 300 }))
    const popup = new Box()
    popup.attrs.set('popover', '')
    popup.append(new Box(() => ({ width: 28, top: 200 }), 'button'))
    row.append(new Box(() => ({ width: 28, top: 0 }), 'button'), new Box(() => ({ width: 34, top: -2, height: 34 }), 'button'), popup, new Box(() => ({ width: 0, top: 90 }), 'button'))
    expect(rowOnOneLine(el(row))).toBe(true)
    row.append(new Box(() => ({ width: 28, top: 40 }), 'button'))
    expect(rowOnOneLine(el(row))).toBe(false)
  })

  it('keeps the selector when the row fits, including after DSH compacts the model text', () => {
    const c = composer(400)
    c.host()
    observe(c.node)
    expect(c.node.hidden).toBe(false)
    c.layout.width = 300
    notify() // Expanded wrap before DSH has compacted: wait for the host instead of hiding.
    expect(c.node.hidden).toBe(false)
    expect(frames.size).toBe(1)
    frame(c)
    expect(c.row.hasAttribute(COMPACT)).toBe(true)
    expect(c.node.hidden).toBe(false)
    expect(frames.size).toBe(0)
  })

  it('collapses once even the compact row would wrap', () => {
    const c = composer(400)
    c.host()
    observe(c.node)
    c.layout.width = 220
    notify()
    expect(c.node.hidden).toBe(false)
    frame(c)
    expect(c.node.hidden).toBe(true)
    expect(frames.size).toBe(0)
  })

  it('falls back after one frame when the host never compacts', () => {
    const c = composer(220)
    observe(c.node)
    expect(c.node.hidden).toBe(false)
    flushFrames()
    expect(c.node.hidden).toBe(true)
  })

  it('returns exactly when the compact seat fits, leaving no probe state behind', () => {
    const c = composer(220)
    c.host()
    observe(c.node)
    expect(c.node.hidden).toBe(true)
    // Compact demand with the seat: 80 + 12 + (28 + 12 + 44 + 8 + 34) = 218, plus padding 16.
    c.layout.width = 233
    frame(c)
    expect(c.node.hidden).toBe(true)
    expect(c.row.hasAttribute(COMPACT)).toBe(true)
    c.layout.width = 234
    frame(c)
    expect(c.node.hidden).toBe(false)
    frame(c)
    expect(c.node.hidden).toBe(false)
  })

  it('restores the host compact state after probing a row DSH had expanded', () => {
    const c = composer(220, { tools: 80, modelExpanded: 40 })
    c.host()
    observe(c.node)
    expect(c.node.hidden).toBe(true)
    c.host() // Without the selector the short expanded model fits again.
    expect(c.row.hasAttribute(COMPACT)).toBe(false)
    notify()
    expect(c.node.hidden).toBe(true)
    expect(c.row.hasAttribute(COMPACT)).toBe(false)
    c.layout.width = 400
    frame(c)
    expect(c.node.hidden).toBe(false)
    expect(c.row.hasAttribute(COMPACT)).toBe(false)
  })

  it('stops flapping when a return wraps again at the same width', () => {
    const c = composer(220)
    c.host()
    observe(c.node)
    expect(c.node.hidden).toBe(true)
    c.layout.width = 300
    c.layout.hostSlack = 200 // The host keeps the expanded model although it wraps.
    frame(c)
    expect(c.node.hidden).toBe(false)
    frame(c)
    flushFrames()
    expect(c.node.hidden).toBe(true)
    for (let i = 0; i < 3; i++) { frame(c); flushFrames() }
    expect(c.node.hidden).toBe(true)
    c.layout.width = 300 + RESHOW_MARGIN
    frame(c)
    expect(c.node.hidden).toBe(false)
  })

  it('does not write while a visible row keeps fitting', () => {
    const c = composer(400)
    c.host()
    observe(c.node)
    const writes = c.node.writes
    for (let i = 0; i < 5; i++) frame(c)
    expect(c.node.hidden).toBe(false)
    expect(c.node.writes).toBe(writes)
  })

  it('keeps pinned states visible and re-evaluates on refresh', () => {
    const c = composer(220)
    c.host()
    let pinned = true
    const handle = observe(c.node, () => pinned)
    flushFrames(); notify()
    expect(c.node.hidden).toBe(false)
    pinned = false
    handle.refresh()
    expect(c.node.hidden).toBe(true)
    pinned = true
    handle.refresh()
    expect(c.node.hidden).toBe(false)
  })

  it('applies to dsh-mobile rows as well, since /setup-search remains reachable', () => {
    const c = composer(220)
    c.row.attrs.set('data-dsh-mobile-composer-row', 'true')
    c.host()
    observe(c.node)
    expect(c.node.hidden).toBe(true)
  })

  it('leaves the seat alone while activity mode hides the control group', () => {
    const c = composer(220)
    c.controls.hidden = true
    c.host()
    observe(c.node)
    flushFrames()
    expect(c.node.hidden).toBe(false)
    expect(frames.size).toBe(0)
  })

  it('restores the selector and disconnects on dispose', () => {
    const c = composer(400)
    c.host()
    const handle = observe(c.node)
    c.layout.width = 220
    notify()
    handle.dispose()
    expect(frames.size).toBe(0)
    expect(observers.every(observer => observer.targets.size === 0)).toBe(true)
    frame(c); flushFrames()
    expect(c.node.hidden).toBe(false)
  })

  it('stays inert outside a composer card', () => {
    const handle = observeCrowdedRow(el(new Box()), { pinned: () => false })
    expect(observers).toHaveLength(0)
    expect(() => { handle.refresh(); handle.dispose() }).not.toThrow()
  })
})
