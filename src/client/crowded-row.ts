/**
 * Last-resort narrow-width collapse for the session search selector (L3).
 *
 * DSH's composer control row (`observeControlRow` in ui-conversation) first
 * collapses the model text with `data-model-compact`, then lets controls wrap
 * onto another line once even the icons cannot share one; dsh-mobile keeps the
 * same groups and wraps them by design. Session search selections persist, are
 * rarely changed and remain reachable through /setup-search, so this selector
 * yields its seat whenever the row would otherwise leave a single line, and
 * returns once a synchronous probe shows its compact seat fits again.
 *
 * Decisions use rendered geometry rather than width arithmetic, because
 * dsh-mobile's growing flex groups report filled, not intrinsic, widths.
 */

const CARD = '[data-composer-card]'
const COMPACT = 'data-model-compact'
/** Popups render inside the row's DOM but outside its line boxes. */
const POPUP = 'dialog,[popover],[role="dialog"],[role="menu"],[role="listbox"]'
/** Width growth required to retry after a show immediately wrapped again at the same width. */
export const RESHOW_MARGIN = 4

export interface CrowdedRowOptions {
  /** States that must stay visible even if the row has to wrap; read on every measurement. */
  pinned(): boolean
}
export interface CrowdedRowHandle {
  /** Re-evaluate, e.g. after a pinned state change. */
  refresh(): void
  /** Disconnect observers and restore the selector. */
  dispose(): void
}

/** True when every rendered control of the row shares one line: all their boxes overlap vertically. */
export function rowOnOneLine(row: Element): boolean {
  let top = -Infinity
  let bottom = Infinity
  for (const button of row.querySelectorAll('button')) {
    if (button.closest(POPUP)) continue
    const rect = button.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    top = Math.max(top, rect.top)
    bottom = Math.min(bottom, rect.bottom)
  }
  return top < bottom
}

/** The composer card's child that holds this node: DSH's control row, without hashed class names. */
export function findControlRow(node: Element): HTMLElement | null {
  const card = node.closest(CARD)
  let current: Element | null = node
  while (card && current && current.parentElement !== card) current = current.parentElement
  return card && current ? current as HTMLElement : null
}

/** Slot anchors use `display: contents`; the control group is the first box-generating ancestor. */
function boxParent(node: Element): Element | null {
  let parent = node.parentElement
  while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement
  return parent
}

const inert: CrowdedRowHandle = { refresh() {}, dispose() {} }

export function observeCrowdedRow(node: HTMLElement, options: CrowdedRowOptions): CrowdedRowHandle {
  const row = findControlRow(node)
  if (!row || typeof ResizeObserver !== 'function') return inert
  let frame: number | undefined
  /** Row width of the last probe-approved return; a wrap at that same width means the probe was wrong. */
  let returnedAt: number | undefined
  let retryAbove = -Infinity
  const width = () => row.getBoundingClientRect().width
  const cancelFrame = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }
  // Same-value writes still queue mutation records, which DSH's observer would re-measure.
  const setHidden = (hidden: boolean) => { if (node.hidden !== hidden) node.hidden = hidden }
  const collapse = () => {
    const current = width()
    if (returnedAt !== undefined && Math.abs(current - returnedAt) < 0.5) retryAbove = current + RESHOW_MARGIN
    returnedAt = undefined
    setHidden(true)
  }
  /**
   * Lay the row out as it would be with the compact seat shown, without painting:
   * every attribute write is undone before control returns to the event loop.
   */
  const fitsWithSeat = () => {
    const compact = row.hasAttribute(COMPACT)
    if (!compact) row.setAttribute(COMPACT, '')
    node.hidden = false
    try {
      return rowOnOneLine(row)
    } finally {
      node.hidden = true
      if (!compact) row.removeAttribute(COMPACT)
    }
  }
  const measure = (force = false) => {
    cancelFrame()
    if (options.pinned()) return setHidden(false)
    const parent = boxParent(node)
    // Activity mode hides the whole control group: there is no seat to decide.
    if (!parent || parent.closest('[hidden]')) return
    if (node.hidden) {
      const current = width()
      if (current >= retryAbove && fitsWithSeat()) {
        returnedAt = current
        setHidden(false)
      }
      return
    }
    if (rowOnOneLine(row)) return
    // DSH collapses the model text first. If its observer has not run yet, give it a frame.
    if (row.hasAttribute(COMPACT) || force) collapse()
    else frame = requestAnimationFrame(() => { frame = undefined; measure(true) })
  }
  const onChange = () => measure()
  const resize = new ResizeObserver(onChange)
  resize.observe(row)
  for (const child of row.children) resize.observe(child)
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  fonts?.addEventListener?.('loadingdone', onChange)
  measure()
  return {
    refresh: onChange,
    dispose() {
      cancelFrame()
      resize.disconnect()
      fonts?.removeEventListener?.('loadingdone', onChange)
      setHidden(false)
    },
  }
}
