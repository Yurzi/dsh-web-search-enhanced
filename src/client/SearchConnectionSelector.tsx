import { useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
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
  set(request: { sessionId: string; connectionId: string | null; expectedRevision: number }): Promise<RemoteResult<SearchSelectionResponse>>
}
export interface SearchConnectionSelectorProps { sessionId: string; remote: SearchConnectionRemote }

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
function SessionSelector({ sessionId, remote }: SearchConnectionSelectorProps) {
  const [value, setValue] = useState<SearchSelectionResponse>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const controller = useRef<{ refresh(): Promise<void>; select(id: string | null, revision: number): Promise<void> }>()
  useEffect(() => {
    const guard = createResponseGuard()
    let writing = false
    let reading = false
    setValue(undefined); setError(''); setNotice(''); setPending(false)
    const refresh = async () => {
      if (writing || reading) return
      reading = true
      const token = guard.begin()
      try {
        const result = await remote.get({ sessionId })
        if (!guard.accepts(token)) return
        if (result.ok) setValue(result.value)
        else setError(result.error.message)
      } catch { if (guard.accepts(token)) setError('读取搜索连接失败，请重试。') }
      finally { reading = false }
    }
    const select = async (connectionId: string | null, expectedRevision: number) => {
      if (writing) return
      writing = true
      const token = guard.begin() // invalidate an older poll before crossing the write boundary
      setPending(true); setError(''); setNotice('')
      let refreshAfterFailure = false
      try {
        const result = await remote.set({ sessionId, connectionId, expectedRevision })
        if (!guard.accepts(token)) return
        if (result.ok) { setValue(result.value); setNotice('已保存，下一次模型请求生效；已发出的搜索不变。') }
        else { setError(result.error.message + '（已请求刷新，请核对后重试。）'); refreshAfterFailure = true }
      } catch { if (guard.accepts(token)) { setError('保存失败，未确认切换；请刷新核对后重试。'); refreshAfterFailure = true } }
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
    const timer = window.setInterval(() => { void refresh() }, 5000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { guard.cancel(); controller.current = undefined; window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [sessionId, remote])
  const connections = useMemo(() => discoverableConnections(value?.connections ?? []), [value?.connections])
  const selected = value?.selection.connectionId
  const current = connections.find(c => c.id === selected)
  return <div className="v2s-selector">
    <style>{selectorCss}</style>
    <label className="v2s-selector-control" title="仅影响当前会话；下一次模型请求生效"><span>搜索</span><select aria-label="当前会话搜索连接" disabled={!value || pending} value={selected ?? ''} onChange={event => { if (value) void controller.current?.select(event.target.value || null, value.selection.revision) }}>
      <option value="">{value ? '未选择搜索连接' : '正在读取…'}</option>
      {selected && !current ? <option value={selected}>已失效 / 已删除：{selected}</option> : null}
      {(['model', 'structured'] as const).map(kind => <optgroup key={kind} label={kind === 'model' ? '模型搜索' : '结构化搜索'}>
        {connections.filter(c => c.kind === kind).map(c => <option key={c.id} value={c.id} disabled={!c.configured && c.id !== SESSION_MODEL_ID}>{c.label}{c.keyless ? ' · 免 Key' : c.configured ? '' : '（不可用）'}</option>)}
      </optgroup>)}
    </select></label>
    {value ? <span> · 内容实时性：{freshnessLabels[value.freshness]}（全局）</span> : null}
    {current && !current.configured ? <p role="status">{current.reason ?? '未配置凭据或连接不可用，请在设置 → 插件中管理搜索连接。'}</p> : null}
    {selected && !current ? <p role="status">保留原选择，不会自动换服务。请在设置 → 插件中修复或显式选择其他连接。</p> : null}
    <details><summary>可用性与配置</summary>{connections.filter(c => !c.configured).map(c => <p key={c.id}>{c.label}：{c.reason ?? '请配置凭据'}{c.credentialRef ? '（' + c.credentialRef + '）' : ''}</p>)}<p>管理入口：设置 → 插件 → 搜索连接。未配置不影响普通聊天。</p></details>
    {pending ? <p role="status">正在保存，尚未确认切换…</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error} <button type="button" disabled={pending} onClick={() => { void controller.current?.refresh() }}>刷新</button></p> : null}
  </div>
}
