import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { SearchSelectorControl, type SearchSelectionResponse, type SearchSelectorControlProps } from '../../src/client/SearchConnectionSelector.tsx'
import { zh, type LocaleKey } from '../../src/client/locales.ts'
import { rowOnOneLine } from '../../src/client/crowded-row.ts'

/** Same behavior as DSH ui-conversation observeControlRow (0.2.0-rc.2 through 0.2.1-alpha.1). */
function observeControlRow(row: HTMLElement) {
  const measure = () => {
    row.removeAttribute('data-model-compact')
    const style = getComputedStyle(row)
    const available = row.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const widths = Array.from(row.children, child => child.getBoundingClientRect().width).filter(width => width > 0)
    const needed = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * parseFloat(style.columnGap)
    row.toggleAttribute('data-model-compact', needed > available)
  }
  const resize = new ResizeObserver(measure)
  resize.observe(row)
  for (const child of row.children) resize.observe(child)
  new MutationObserver(measure).observe(row, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] })
  document.fonts.addEventListener('loadingdone', measure)
  measure()
}

const svg = (d: string, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${d}"/></svg>`
const chevron = svg('m4 6 4 4 4-4', 12)
document.getElementById('app')!.innerHTML = `
<div class="frame" id="frame"><div class="card" data-composer-card>
  <div class="input">描述你想要构建的内容, / 调用指令, @ 文件或对话</div>
  <div class="row" id="row">
    <div class="tools">
      <button class="add" aria-label="指令">${svg('M8 3v10M3 8h10', 14)}</button>
      <div class="modes"><button class="mode" aria-label="权限模式">${svg('M8 2 3 4v4c0 3 2 5 5 6 3-1 5-3 5-6V4z')}${chevron}</button></div>
      <div data-slot="conversation.input.left" style="display:contents"></div>
    </div>
    <div class="trailing">
      <div class="standardControls">
        <div data-slot="conversation.input.right" style="display:contents" id="right"></div>
        <div data-slot="conversation.input.model" style="display:contents"><div class="modelRoot"><button class="modelTrigger" aria-label="选择模型">${svg('M3 4h10v8H3zM3 8h10').replace('<svg', '<svg class="modelIcon"')}<span class="modelLabel _triggerLabel">DeepSeek-V4-Pro</span><span class="modelEffort">高</span>${chevron}</button></div></div>
      </div>
      <div class="activity"><button class="icon" aria-label="语音">${svg('M8 2v7M5 7a3 3 0 0 0 6 0M8 12v2')}</button></div>
      <button class="primary" aria-label="发送">${svg('M8 13V3M4 7l4-4 4 4')}</button>
    </div>
  </div>
</div></div>`

const connections: SearchSelectorControlProps['connections'] = [
  { id: 'builtin:session-model', label: '跟随会话模型', kind: 'model', configured: true },
  { id: 'builtin:exa', label: 'Exa', kind: 'structured', configured: true },
  { id: 'builtin:tavily', label: 'Tavily', kind: 'structured', configured: false },
]
const value = (connectionId: string | null): SearchSelectionResponse => ({ selection: { connectionId, revision: 1 }, freshness: 'realtime', connections })
let props: SearchSelectorControlProps = {
  t: key => zh[key as LocaleKey] ?? key, value: value('builtin:exa'), connections,
  pending: false, error: '', notice: '', onSelect() {}, onFreshness() {}, onRefresh() {},
}
const root = createRoot(document.getElementById('right')!)
// Another conversation.input.right contribution, like the icon-only plugin in the reported layout.
const render = () => flushSync(() => root.render(<><SearchSelectorControl {...props} /><span className="otherPlugin"><button className="icon" aria-label="其他插件" dangerouslySetInnerHTML={{ __html: svg('M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z') }} /></span></>))
// Slot entries commit their layout effects before InputBar's, as in DSH.
render()
const row = document.getElementById('row')!
const frame = document.getElementById('frame')!
observeControlRow(row)

const selector = document.querySelector<HTMLElement>('.v2s-selector')!
// Count settled visibility changes; the observer's synchronous probes restore the attribute before this runs.
let toggles = 0
let lastHidden = selector.hidden
new MutationObserver(() => { if (selector.hidden !== lastHidden) { lastHidden = selector.hidden; toggles++ } }).observe(selector, { attributes: true, attributeFilter: ['hidden'] })
const frames = (count = 3) => new Promise<void>(resolve => { const step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step) })
const rect = (element: Element) => element.getBoundingClientRect()
const shown = (element: Element | null) => !!element && getComputedStyle(element).display !== 'none' && rect(element).width > 0

function state() {
  const trigger = selector.querySelector<HTMLElement>('.v2s-search-trigger')!
  const tools = row.children[0]!, trailing = row.children[1]!
  const label = trigger.querySelector('.v2s-search-label')
  return {
    width: Math.round(rect(frame).width), compact: row.hasAttribute('data-model-compact'), hidden: selector.hidden,
    selectorVisible: shown(selector), triggerWidth: rect(trigger).width, triggerHeight: rect(trigger).height,
    triggerMaxWidth: getComputedStyle(trigger).maxWidth,
    label: shown(label), labelHeight: label ? rect(label).height : 0, chevron: shown(trigger.querySelector('.v2s-search-chevron')),
    errorBadge: shown(trigger.querySelector('.v2s-search-error-dot')),
    wrapped: rect(trailing).top >= rect(tools).bottom - 1, oneLine: rowOnOneLine(row), rowHeight: rect(row).height, toggles,
  }
}
const api = {
  state,
  async width(width: number) { frame.style.width = width + 'px'; await frames(); return state() },
  async sweep(from: number, to: number, step: number) {
    const states = []
    for (let width = from; step > 0 ? width <= to : width >= to; width += step) states.push(await api.width(width))
    return states
  },
  async props(change: { error?: string; pending?: boolean; connectionId?: string | null }) {
    const { connectionId, ...rest } = change
    props = { ...props, ...rest, ...(connectionId !== undefined ? { value: value(connectionId) } : {}) }
    render(); await frames(); return state()
  },
  /** Mark the stock composer as dsh-mobile >=0.6.3 does on its mobile page. */
  async mobile() {
    row.dataset.dshMobileComposerRow = 'true'
    ;(row.children[0] as HTMLElement).dataset.dshMobileComposerTools = 'true'
    ;(row.children[1] as HTMLElement).dataset.dshMobileComposerTrailing = 'true'
    row.querySelector<HTMLElement>('.standardControls')!.dataset.dshMobileComposerControls = 'true'
    const model = row.querySelector<HTMLElement>('.modelTrigger')!
    model.dataset.dshMobileComposerModelTrigger = 'true'
    model.parentElement!.setAttribute('data-dsh-mobile-composer-model', 'true')
    model.querySelector('._triggerLabel')!.setAttribute('data-dsh-mobile-composer-model-label', 'true')
    frame.style.width = '100%'
    await frames(); return state()
  },
}
;(window as unknown as { fit: typeof api }).fit = api
document.getElementById('result')!.textContent = 'ready'
