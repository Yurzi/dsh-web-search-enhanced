import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SearchLocaleProps, selectionInjection } from './bindings.ts'
import { SESSION_MODEL_ID, SESSION_MODEL_LABEL, type Freshness } from '../catalog.ts'
import { selectorCss } from './search-selector.css.ts'

export interface SearchConnectionView {
  id: string; label: string; kind: 'model' | 'structured'; configured: boolean
  keyless?: boolean; reason?: string; credentialRef?: string
}
export interface SearchSelectionResponse {
  selection: { connectionId: string | null; revision: number }
  connections: SearchConnectionView[]
  freshness: Freshness
}
export interface SearchConnectionRemote {
  get(request: { sessionId: string }): Promise<RemoteResult<SearchSelectionResponse>>
  set(request: { sessionId: string; connectionId?: string | null; freshness?: Freshness; expectedRevision: number }): Promise<RemoteResult<SearchSelectionResponse>>
}
export type SearchConnectionSelectorProps = PropsRuntime<'conversation.input.right'> & ReturnType<typeof selectionInjection> & SearchLocaleProps

/** Each effect owns a guard: cancellation also fences responses across sessions/unmount. */
export function createResponseGuard() {
  let generation = 0
  let active = true
  return {
    begin: () => ++generation,
    accepts: (token: number) => active && token === generation,
    cancel: () => { active = false; ++generation },
  }
}
export function discoverableConnections(connections: SearchConnectionView[]): SearchConnectionView[] {
  const values = [...connections]
  if (!values.some(c => c.id === SESSION_MODEL_ID)) values.push({ id: SESSION_MODEL_ID, label: SESSION_MODEL_LABEL, kind: 'model', configured: false, reason: '尚未取得当前会话的模型连接状态；请刷新后检查协议、endpoint 和凭据。' })
  return values.sort((a, b) => Number(b.configured) - Number(a.configured))
}
export const freshnessLabels: Record<Freshness, string> = { auto: '自动', fresh: '优先新鲜', realtime: '优先实时' }

export function SearchConnectionSelector(props: SearchConnectionSelectorProps) {
  // A new session must never briefly display or write the previous session's selection.
  return <SessionSelector key={props.sessionId} {...props} />
}
function SessionSelector({ sessionId, getSelection, setSelection, useProjection, t }: SearchConnectionSelectorProps) {
  const modelSelection = useProjection('modelSelection')
  const [value, setValue] = useState<SearchSelectionResponse>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const controller = useRef<{ refresh(clearError?: boolean): Promise<void>; select(id: string | null | undefined, revision: number, freshness?: Freshness): Promise<void> }>()
  useEffect(() => {
    const guard = createResponseGuard()
    let writing = false
    let reading = false
    setValue(undefined); setError(''); setNotice(''); setPending(false)
    const refresh = async (clearError = false) => {
      if (writing || reading) return
      reading = true
      const token = guard.begin()
      try {
        const result = await getSelection()
        if (!guard.accepts(token)) return
        if (result.ok) { setValue(result.value); if (clearError) setError('') }
        else setError(result.error.message)
      } catch { if (guard.accepts(token)) setError(t('selectionReadFailed')) }
      finally { reading = false }
    }
    const select = async (connectionId: string | null | undefined, expectedRevision: number, freshness?: Freshness) => {
      if (writing) return
      writing = true
      const token = guard.begin() // invalidate an older poll before crossing the write boundary
      setPending(true); setError(''); setNotice('')
      let refreshAfterFailure = false
      try {
        const result = await setSelection({ ...(connectionId !== undefined ? { connectionId } : {}), ...(freshness !== undefined ? { freshness } : {}), expectedRevision })
        if (!guard.accepts(token)) return
        if (result.ok) { setValue(result.value); setNotice(t('selectionSaved')) }
        else { setError(result.error.message + t('selectionRefreshed')); refreshAfterFailure = true }
      } catch { if (guard.accepts(token)) { setError(t('selectionWriteFailed')); refreshAfterFailure = true } }
      finally {
        writing = false
        if (guard.accepts(token)) {
          setPending(false)
          if (refreshAfterFailure) { reading = false; void refresh() }
        }
      }
    }
    controller.current = { refresh, select }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { guard.cancel(); controller.current = undefined; window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [sessionId, getSelection, setSelection, t])

  // The framework owns projection subscriptions and binding-generation cleanup.
  // Absence is a supported projection value, not a reason to guess at Session internals.
  useEffect(() => { void controller.current?.refresh(true) }, [modelSelection])
  const connections = useMemo(() => discoverableConnections(value?.connections ?? []), [value?.connections])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])
  return <SearchSelectorControl t={t} value={value} connections={connections} pending={pending} error={error} notice={notice}
    onSelect={id => { if (value) void controller.current?.select(id, value.selection.revision) }}
    onFreshness={freshness => { if (value) void controller.current?.select(undefined, value.selection.revision, freshness) }}
    onRefresh={() => { void controller.current?.refresh(true) }} />
}

export interface SearchSelectorControlProps extends SearchLocaleProps {
  value?: SearchSelectionResponse | undefined
  connections: SearchConnectionView[]
  pending: boolean
  error: string
  notice: string
  onSelect(id: string | null): void
  onFreshness(freshness: Freshness): void
  onRefresh(): void
}

/** Native popovers live in the top layer, outside the composer's clipping boundary. */
export function SearchSelectorControl({ t, value, connections, pending, error, notice, onSelect, onFreshness, onRefresh }: SearchSelectorControlProps) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const selected = value?.selection.connectionId
  const current = connections.find(c => c.id === selected)
  const label = !value ? t('search') : current?.id === SESSION_MODEL_ID ? t('followModel') : current?.label ?? (selected ? t('connectionUnavailable') : t('selectSearch'))
  useEffect(() => {
    const node = panel.current
    if (!node) return
    const sync = () => setOpen(node.matches(':popover-open'))
    const close = () => { if (node.matches(':popover-open')) node.hidePopover() }
    node.addEventListener('toggle', sync)
    window.addEventListener('resize', close)
    return () => { node.removeEventListener('toggle', sync); window.removeEventListener('resize', close) }
  }, [])
  const toggle = () => {
    onRefresh()
    const node = panel.current, button = trigger.current
    if (!node || !button) return
    if (node.matches(':popover-open')) { node.hidePopover(); return }
    const rect = button.getBoundingClientRect()
    const width = Math.min(280, window.innerWidth - 32)
    node.style.width = width + 'px'
    node.style.left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)) + 'px'
    const above = rect.top, below = window.innerHeight - rect.bottom
    node.style.top = above >= below ? 'auto' : (rect.bottom + 8) + 'px'
    node.style.bottom = above >= below ? (window.innerHeight - rect.top + 8) + 'px' : 'auto'
    node.style.maxHeight = Math.max(60, Math.min(400, Math.max(above, below) - 24)) + 'px'
    node.showPopover()
    ;(node.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') ?? node.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
  }
  return <div className="v2s-selector">
    <style>{selectorCss}</style>
    <button ref={trigger} type="button" className="v2s-search-trigger" aria-label={t('searchConnection') + label}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      data-state={error ? 'error' : pending ? 'saving' : notice ? 'saved' : 'ready'}
      title={error || (pending ? t('saving') : notice || t('searchConnection') + (current?.label ?? t('notSelected')))}
      onClick={toggle}>
      <svg className={pending ? 'v2s-search-icon v2s-search-busy' : 'v2s-search-icon'} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c4 4 4 14 0 18M12 3c-4 4-4 14 0 18"/></svg>
      <span className="v2s-search-label">{label}</span>
      {value ? <span className="v2s-search-mode">{t(value.freshness === 'auto' ? 'freshnessAuto' : value.freshness === 'fresh' ? 'freshnessFreshShort' : 'freshnessRealtimeShort')}</span> : null}
      {error ? <span className="v2s-search-error-dot" aria-hidden="true">!</span> : notice ? <span className="v2s-search-check" aria-hidden="true">✓</span> : null}
      <svg className="v2s-search-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
    </button>
    <span className="v2s-search-sr" role="status" aria-live="polite">{error || (pending ? t('saving') : notice)}</span>
    <div ref={panel} id={id} {...{ popover: 'auto' }} role="dialog" aria-label={t('sessionSearchSettings')} className="v2s-selector-panel"
      onKeyDown={event => {
        if (event.key === 'Escape') { panel.current?.hidePopover(); trigger.current?.focus(); return }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
        items[next]?.focus()
      }}>
      {(['model', 'structured'] as const).filter(kind => connections.some(c => c.kind === kind && c.configured)).map(kind => <div key={kind} role="group" aria-label={t(kind === 'model' ? 'modelSearch' : 'searchServices')}>
        <div className="v2s-search-group-title">{t(kind === 'model' ? 'modelSearch' : 'searchServices')}</div>
        {connections.filter(c => c.kind === kind && c.configured).map(c => <button key={c.id} type="button" className="v2s-search-option" disabled={!value || pending || !c.configured} aria-pressed={c.id === selected} onClick={() => { if (c.configured && c.id !== selected) onSelect(c.id) }}><span>{c.label}</span><span className="v2s-search-option-check" aria-hidden="true">{c.id === selected ? '✓' : ''}</span></button>)}
      </div>)}
      <div className="v2s-search-freshness" role="group" aria-label={t('sessionFreshness')}>
        <div className="v2s-search-group-title">{t('freshness')}</div>
        <div className="v2s-search-segments">{(['auto', 'fresh', 'realtime'] as const).map(mode => <button key={mode} type="button" aria-pressed={value?.freshness === mode} disabled={!value || pending} onClick={() => { if (value?.freshness !== mode) onFreshness(mode) }}>{t(mode === 'auto' ? 'freshnessAuto' : mode === 'fresh' ? 'freshnessFresh' : 'freshnessRealtime')}</button>)}</div>
      </div>
      {error ? <div className="v2s-search-error" role="alert"><span>{error}</span><button type="button" disabled={pending} onClick={onRefresh}>{t('retry')}</button></div> : null}
    </div>
  </div>
}
