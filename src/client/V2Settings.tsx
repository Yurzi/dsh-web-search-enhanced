import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { V2Config } from '../config.ts'
import type { CredentialRemote } from './SearchSettingsCard.tsx'
import { CATALOG, SESSION_MODEL_ID, SESSION_MODEL_LABEL } from '../catalog.ts'
import { freshnessLabels } from './SearchConnectionSelector.tsx'
import { importLegacy } from '../migration.ts'
import { v2CardCss } from './v2-settings.css.ts'

export interface V2SettingsProps { scope: SettingsScope<V2Config>; credentials: CredentialRemote }
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(object(a)[k], object(b)[k]))
}
export interface SparseSnapshot { base?: unknown; user?: unknown }
/** Update only the edited path; catalog defaults never materialize as settings. */
export function sparseSettingOperations(snapshot: SparseSnapshot, path: string[], target: unknown, fallback?: unknown): SettingsPathOpView[] {
  const at = (root: unknown) => path.reduce<unknown>((v, key) => object(v)[key], root)
  const inherited = at(snapshot.base) ?? fallback
  const user = at(snapshot.user)
  const delta = (value: unknown, base: unknown): unknown => {
    if (equal(value, base)) return undefined
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(object(value)).map(([k, v]) => [k, delta(v, object(base)[k])]).filter(([, v]) => v !== undefined))
  }
  const sparse = delta(target, inherited)
  const ops: SettingsPathOpView[] = []
  if (target === undefined || equal(target, inherited)) {
    if (user !== undefined) ops.push({ op: 'unset', path })
  } else if (!equal(sparse, user)) ops.push({ op: 'set', path, value: sparse as Extract<SettingsPathOpView, { op: 'set' }>['value'] })
  if (ops.some(op => op.op === 'set') && object(snapshot.base).version !== 2 && object(snapshot.user).version !== 2) ops.push({ op: 'set', path: ['version'], value: 2 })
  return ops
}
export function resetSettingsOperations(snapshot: SparseSnapshot): SettingsPathOpView[] {
  return ['version', 'freshness', 'defaultConnection', 'connections'].filter(k => Object.hasOwn(object(snapshot.user), k)).map(k => ({ op: 'unset', path: [k] }))
}
/** JSON is configuration only; consent is always supplied by the separate checkbox. */
export function parseConnectionDraft(id: string, json: string, consent: boolean): Record<string, unknown> {
  if (!/^custom:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(id)) throw new Error('连接 ID 必须是 custom: 开头的字母、数字、点、下划线或连字符。')
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { throw new Error('JSON 格式无效，请检查括号、引号和逗号。') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('连接配置必须是 JSON 对象。')
  const config = { ...object(parsed) }
  const inspect = (value: unknown): void => {
    for (const [key, child] of Object.entries(value && typeof value === 'object' ? value : {})) {
      if (/^(apiKey|key|secret|token|password|authorization|headers)$/i.test(key)) throw new Error('请将密钥写入凭据服务，不要放入 JSON。')
      if (child && typeof child === 'object') inspect(child)
    }
  }
  inspect(config)
  if (typeof config.label !== 'string' || !config.label.trim()) throw new Error('请填写 label。')
  if (config.kind !== 'model' && config.kind !== 'structured') throw new Error('kind 必须为 model 或 structured。')
  if (!consent) throw new Error('请显式确认信任此连接地址和凭据绑定。')
  config.trustedEndpoint = true
  return config
}
/** Credential-only operation: never receives or mutates a settings scope. */
export async function saveV2Credential(credentials: CredentialRemote, ref: string, value: string): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref) || !value.trim()) throw new Error('请填写有效凭据引用和非空 Key。')
  try {
    const result = await credentials.set(ref, value.trim())
    if (!result.ok) throw new Error('credential write rejected')
  } catch { throw new Error('凭据保存失败，请检查宿主凭据服务。') }
}
const template = (kind: 'model' | 'structured') => JSON.stringify(kind === 'model' ? {
  label: '专用搜索模型', kind, binding: { mode: 'fixed', protocol: 'openai-responses', model: 'search-capable-model', baseURL: 'https://gateway.example/v1', credentialRef: 'SEARCH_MODEL_API_KEY' }, options: {},
} : { label: 'Exa 独立账号', kind, adapter: 'exa', endpoint: CATALOG['builtin:exa'].endpoint, credentialRef: 'EXA_WORK_API_KEY', options: {} }, null, 2)

export function V2Settings({ scope, credentials }: V2SettingsProps) {
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope), scope.getSnapshot.bind(scope))
  const config = snapshot.value ?? {}
  const [open, setOpen] = useState(true)
  const [editor, setEditor] = useState<{ type: 'key'; ref: string } | { type: 'connection'; id: string; initial: SparseSnapshot; revision: number; existing: boolean } | null>(null)
  const [json, setJson] = useState('')
  const [connectionId, setConnectionId] = useState('custom:')
  const [consent, setConsent] = useState(false)
  const [keyValue, setKeyValue] = useState('')
  const [states, setStates] = useState<Record<string, { configured: boolean; writable?: boolean }>>({})
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  let draft: Record<string, unknown> = {}
  try { draft = object(JSON.parse(json)) } catch { /* advanced JSON validation stays explicit */ }
  const patchDraft = (path: string[], value: string) => {
    const next = { ...draft }
    if (path.length === 2) next[path[0]!] = { ...object(next[path[0]!]), [path[1]!]: value }
    else next[path[0]!] = value
    setJson(JSON.stringify(next, null, 2)); setConsent(false)
  }
  const bodyId = useId()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const custom = Object.entries(config.connections ?? {}).filter(([id]) => id.startsWith('custom:'))
  const refFor = (id: string, fallback = '') => {
    const c = config.connections?.[id]
    return typeof c?.credentialRef === 'string' ? c.credentialRef : typeof object(c?.binding).credentialRef === 'string' ? String(object(c?.binding).credentialRef) : fallback
  }
  const refs = [...new Set([...Object.entries(CATALOG).map(([id, c]) => refFor(id, c.credentialRef)), ...custom.map(([id]) => refFor(id))].filter(Boolean))]
  const refsKey = JSON.stringify(refs)
  useEffect(() => {
    let active = true
    void credentials.describe(JSON.parse(refsKey) as string[]).then(result => {
      if (!active) return
      if (result.ok) setStates(result.value)
      else setError('读取凭据状态失败：' + result.error.message)
    }).catch(() => { if (active) setError('读取凭据状态失败。') })
    return () => { active = false }
  }, [credentials, refsKey, refresh])

  const disabled = busy || snapshot.status !== 'ready' || !snapshot.writable || snapshot.revision === undefined
  const close = () => { setEditor(null); setKeyValue(''); setConsent(false) }
  const act = async (work: () => Promise<void>, message: string) => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await work(); if (alive.current) { close(); setNotice(message) } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '保存失败，请核对刷新后的设置再重试。') }
    finally { if (alive.current) setBusy(false) }
  }
  const mutate = async (ops: SettingsPathOpView[], revision = snapshot.revision) => {
    if (revision === undefined) throw new Error('尚未取得设置版本，请稍后重试。')
    if (ops.length) await scope.mutate(ops, revision)
  }
  const openConnection = (kind: 'model' | 'structured', id?: string) => {
    if (snapshot.revision === undefined) return
    setOpen(true)
    setEditor({ type: 'connection', id: id ?? '', existing: !!id, initial: { base: snapshot.base, user: snapshot.user }, revision: snapshot.revision })
    setConnectionId(id ?? 'custom:'); setJson(id ? JSON.stringify(config.connections?.[id], null, 2) : template(kind)); setConsent(false); setKeyValue(''); setError('')
  }
  const openKey = (ref: string) => {
    setOpen(true)
    setEditor({ type: 'key', ref }); setKeyValue(''); setConsent(false); setError('')
  }
  const labels = new Map<string, string>([[SESSION_MODEL_ID, SESSION_MODEL_LABEL], ...Object.entries(CATALOG).map(([id, c]): [string, string] => [id, c.label]), ...custom.map(([id, c]): [string, string] => [id, String(c.label ?? id)])])

  if (snapshot.status === 'unavailable') return null

  const configuredCount = Object.values(states).filter(s => s.configured).length

  return (
    <li className="v2s-card" data-open={open} data-plugin-key="web-search-enhanced">
      <style>{v2CardCss}</style>
      <button
        type="button"
        className="v2s-header"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={(open ? '折叠' : '展开') + ': 搜索连接'}
        onClick={() => setOpen(v => !v)}
      >
        <span className="v2s-head-text">
          <span className="v2s-title">搜索连接</span>
          <span className="v2s-desc">管理会话搜索连接、凭据引用与内容实时性偏好</span>
        </span>
        <span className="v2s-header-meta">
          {busy ? <span className="v2s-badge v2s-badge-busy">正在保存…</span> : null}
          {notice ? <span className="v2s-badge v2s-badge-notice">已更新</span> : null}
          {error ? <span className="v2s-badge v2s-badge-error">提示错误</span> : null}
          {configuredCount > 0 ? <span className="v2s-badge">{configuredCount} 个凭据就绪</span> : null}
          <span className="v2s-chevron" aria-hidden="true" />
        </span>
      </button>

      {open ? (
        <div className="v2s-body" id={bodyId}>
          {!snapshot.writable && snapshot.status === 'ready' ? (
            <p className="v2s-status-text v2s-status-info" role="status">当前设置只读或尚未完成加载。</p>
          ) : null}

          {config.version !== 2 && ['modelMode', 'protocol', 'baseURL', 'model', 'apiKeyEnv'].some(k => object(config)[k] !== undefined) ? (
            <div className="v2s-callout v2s-callout-warn">
              <h4 className="v2s-callout-warn-title">检测到旧版配置（v1），需要显式导入</h4>
              <p className="v2s-hint">固定路由将成为 custom:legacy；跟随模式保留为“跟随会话模型”。旧 fallback 不再执行。请先把任何明文 apiKey 转存 DSH Credentials 并从旧配置移除。</p>
              <div>
                <button
                  type="button"
                  className="v2s-btn v2s-btn-primary"
                  disabled={disabled}
                  onClick={() => {
                    void act(async () => {
                      const imported = importLegacy(object(config))
                      const ops: SettingsPathOpView[] = Object.entries(imported).map(([key, value]) => ({ op: 'set', path: [key], value: value as Extract<SettingsPathOpView, { op: 'set' }>['value'] }))
                      for (const key of ['modelMode','protocol','baseURL','model','fallbackModel','apiKeyEnv','apiVersion','toolIdentifier','maxTokens','maxUses','chatSearchMode','searchContextSize']) if (Object.hasOwn(object(snapshot.user), key)) ops.push({op:'unset',path:[key]})
                      await mutate(ops)
                    }, '旧连接已导入为新会话默认；已有会话仍需显式选择。')
                  }}
                >
                  导入旧配置（不迁移或删除 Key）
                </button>
              </div>
            </div>
          ) : null}

          <div className="v2s-callout">
            每个会话独立选择连接。配置 Key 不会自动选中或发起联网测试；“已配置”不代表已验证权限、余额或健康状态。
          </div>

          <div className="v2s-section">
            <div className="v2s-section-head">
              <h4 className="v2s-section-title">通用偏好</h4>
            </div>
            <div className="v2s-field-group">
              <div className="v2s-field">
                <label className="v2s-label" htmlFor={bodyId + '-default-connection'}>新会话默认连接</label>
                <select
                  id={bodyId + '-default-connection'}
                  className="v2s-select"
                  disabled={disabled}
                  value={config.defaultConnection ?? ''}
                  onChange={e => {
                    const value = e.target.value || undefined
                    void act(() => mutate(sparseSettingOperations(snapshot, ['defaultConnection'], value)), '已保存新会话默认；已有会话不变。')
                  }}
                >
                  <option value="">继承默认（无默认时让用户选择）</option>
                  {config.defaultConnection && !labels.has(config.defaultConnection) ? <option value={config.defaultConnection}>已失效：{config.defaultConnection}</option> : null}
                  {[...labels].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <p className="v2s-hint">新建会话时初始选中的搜索连接。已有会话不受影响。</p>
              </div>
              <div className="v2s-field">
                <label className="v2s-label" htmlFor={bodyId + '-freshness'}>内容实时性（全局）</label>
                <select
                  id={bodyId + '-freshness'}
                  className="v2s-select"
                  disabled={disabled}
                  value={config.freshness ?? 'auto'}
                  onChange={e => {
                    void act(() => mutate(sparseSettingOperations(snapshot, ['freshness'], e.target.value, 'auto')), '已保存全局内容实时性。')
                  }}
                >
                  {Object.entries(freshnessLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <p className="v2s-hint">优先新鲜：支持时使用不超过 24 小时的内容缓存；优先实时：重新获取页面。两者可能增加延迟和额度消耗；不支持的连接忽略此偏好。</p>
              </div>
            </div>
          </div>

          <div className="v2s-divider" />

          <div className="v2s-section">
            <div className="v2s-section-head">
              <h4 className="v2s-section-title">内置结构化连接</h4>
              <span className="v2s-section-desc">Exa 与 Firecrawl 支持免 Key；配置 Key 可使用各自 API 额度</span>
            </div>
            <div className="v2s-list">
              {Object.entries(CATALOG).map(([id, c]) => {
                const ref = refFor(id, c.credentialRef)
                const supportsKeyless = id === 'builtin:exa' || id === 'builtin:firecrawl'
                const keyless = supportsKeyless && config.connections?.[id]?.access !== 'api-key'
                const configured = keyless || states[ref]?.configured === true
                const isDisabled = config.connections?.[id]?.disabled === true
                return (
                  <div key={id} className="v2s-row">
                    <div className="v2s-row-main">
                      <span className={'v2s-dot ' + (configured ? 'v2s-dot-configured' : 'v2s-dot-missing')} title={configured ? '已配置' : '未配置'} />
                      <div className="v2s-row-info">
                        <div className="v2s-row-title-line">
                          <span className="v2s-row-name">{String(config.connections?.[id]?.label ?? c.label)}</span>
                          <span className="v2s-tag">adapter: {c.adapter}</span>
                          {isDisabled ? <span className="v2s-tag v2s-tag-warn">已禁用</span> : null}
                        </div>
                        <div className="v2s-row-meta">
                          <span>{keyless ? '免 Key · 公共限额（受网络限制）' : configured ? '已配置凭据' : '未配置凭据'}</span>
                          <span>·</span>
                          {!keyless ? <span>凭据引用: <code>{ref}</code></span> : <span>{c.adapter === 'exa' ? 'Exa MCP' : 'Firecrawl Search API'}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="v2s-row-actions">
                      {supportsKeyless ? <select className="v2s-select" aria-label={c.label + ' 访问方式'} disabled={disabled} value={keyless ? 'keyless' : 'api-key'} onChange={e => { void act(() => mutate(sparseSettingOperations(snapshot, ['connections', id, 'access'], e.target.value, 'keyless')), '访问方式已保存，下一次模型请求生效。') }}><option value="keyless">免 Key（限额）</option><option value="api-key">个人 API Key</option></select> : null}
                      <button
                        type="button"
                        className="v2s-btn"
                        disabled={busy || keyless}
                        aria-expanded={editor?.type === 'key' && editor.ref === ref}
                        onClick={() => openKey(ref)}
                      >
                        {keyless ? '无需 Key' : configured ? '管理 Key' : '配置 Key'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="v2s-divider" />

          <div className="v2s-section">
            <div className="v2s-section-head">
              <h4 className="v2s-section-title">模型与自定义连接</h4>
              <div className="v2s-row-actions">
                <button type="button" className="v2s-btn v2s-btn-dashed" disabled={disabled} onClick={() => openConnection('model')}>+ 添加固定模型连接</button>
                <button type="button" className="v2s-btn v2s-btn-dashed" disabled={disabled} onClick={() => openConnection('structured')}>+ 添加自定义结构化连接</button>
              </div>
            </div>
            <div className="v2s-list">
              <div className="v2s-row">
                <div className="v2s-row-main">
                  <span className="v2s-dot v2s-dot-configured" title="自动跟随" />
                  <div className="v2s-row-info">
                    <div className="v2s-row-title-line">
                      <span className="v2s-row-name">{SESSION_MODEL_LABEL}</span>
                      <span className="v2s-tag">动态跟随会话</span>
                    </div>
                    <div className="v2s-row-meta">
                      <span>沿用当前 Session 的 provider/model 及凭据，无需单独填写 Key。普通 API Key 路由可用；OAuth/订阅路由不自动转换。</span>
                    </div>
                  </div>
                </div>
              </div>
              {custom.map(([id, c]) => {
                const ref = refFor(id)
                const configured = ref ? states[ref]?.configured === true : false
                return (
                  <div key={id} className="v2s-row">
                    <div className="v2s-row-main">
                      <span className={'v2s-dot ' + (configured ? 'v2s-dot-configured' : 'v2s-dot-missing')} />
                      <div className="v2s-row-info">
                        <div className="v2s-row-title-line">
                          <span className="v2s-row-name">{String(c.label ?? id)}</span>
                          <span className="v2s-tag">{c.kind === 'model' ? '模型连接' : '结构化连接'}</span>
                          <span className="v2s-tag"><code>{id}</code></span>
                        </div>
                        {ref ? <div className="v2s-row-meta"><span>凭据引用: <code>{ref}</code></span><span>({configured ? '已配置' : '未配置'})</span></div> : null}
                      </div>
                    </div>
                    <div className="v2s-row-actions">
                      <button type="button" className="v2s-btn" disabled={disabled} onClick={() => openConnection(c.kind === 'model' ? 'model' : 'structured', id)}>编辑</button>
                      {ref ? <button type="button" className="v2s-btn" disabled={busy} onClick={() => openKey(ref)}>管理 Key</button> : null}
                      <button
                        type="button"
                        className="v2s-btn v2s-btn-danger"
                        disabled={disabled}
                        onClick={() => { void act(() => mutate(sparseSettingOperations(snapshot, ['connections', id], undefined)), '已移除用户连接覆盖；继承连接仍保留，凭据未删除。') }}
                      >
                        移除覆盖
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {editor?.type === 'key' ? (
            <div className="v2s-editor-panel" role="region" aria-label={'凭据配置：' + editor.ref}>
              <div className="v2s-editor-head">
                <h4 className="v2s-editor-title">凭据配置：<code>{editor.ref}</code></h4>
                <button type="button" className="v2s-btn" disabled={busy} onClick={close}>✕ 取消</button>
              </div>
              <p className="v2s-hint">密钥仅提交到 DSH Credentials 凭据服务，不写入 settings，不回显现有值。</p>
              <div className="v2s-field">
                <label className="v2s-label" htmlFor={bodyId + '-key-val'}>新 API Key</label>
                <input
                  id={bodyId + '-key-val'}
                  className="v2s-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="输入新的 API Key…"
                  value={keyValue}
                  disabled={states[editor.ref]?.writable === false}
                  onChange={e => setKeyValue(e.target.value)}
                />
                {states[editor.ref]?.writable === false ? <p className="v2s-hint v2s-status-error">此凭据来源只读，请通过宿主凭据配置管理。</p> : null}
              </div>
              <div className="v2s-editor-foot">
                <button type="button" className="v2s-btn" onClick={close}>取消</button>
                <button
                  type="button"
                  className="v2s-btn v2s-btn-primary"
                  disabled={!keyValue.trim() || states[editor.ref]?.writable === false || busy}
                  onClick={() => {
                    const ref = editor.ref
                    const secret = keyValue
                    void act(async () => {
                      await saveV2Credential(credentials, ref, secret)
                      if (alive.current) { setKeyValue(''); setRefresh(n => n + 1) }
                    }, '凭据已保存；连接选择未改变。')
                  }}
                >
                  仅保存 Key
                </button>
              </div>
            </div>
          ) : null}

          {editor?.type === 'connection' ? (
            <div className="v2s-editor-panel" role="region" aria-label={editor.existing ? ('编辑连接：' + editor.id) : '添加自定义连接'}>
              <div className="v2s-editor-head">
                <h4 className="v2s-editor-title">{editor.existing ? ('编辑连接：' + editor.id) : '添加自定义连接'}</h4>
                <button type="button" className="v2s-btn" disabled={busy} onClick={close}>✕ 取消</button>
              </div>
              <div className="v2s-field">
                <label className="v2s-label" htmlFor={bodyId + '-conn-id'}>连接 ID</label>
                <input
                  id={bodyId + '-conn-id'}
                  className="v2s-input"
                  value={connectionId}
                  disabled={editor.existing}
                  onChange={e => setConnectionId(e.target.value)}
                  placeholder="custom:my-search"
                />
                <p className="v2s-hint">必须是 custom: 开头的字母、数字、点、下划线或连字符</p>
              </div>
              <div className="v2s-grid">
                <label className="v2s-field"><span className="v2s-label">连接名称</span><input className="v2s-input" value={String(draft.label ?? '')} onChange={e => patchDraft(['label'], e.target.value)} /></label>
                {draft.kind === 'model' ? <>
                  <label className="v2s-field"><span className="v2s-label">搜索协议</span><select className="v2s-select" value={String(object(draft.binding).protocol ?? '')} onChange={e => patchDraft(['binding','protocol'], e.target.value)}><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="openai-chat-completions">OpenAI Chat Completions</option></select></label>
                  <label className="v2s-field"><span className="v2s-label">模型 ID</span><input className="v2s-input" value={String(object(draft.binding).model ?? '')} onChange={e => patchDraft(['binding','model'], e.target.value)} /></label>
                </> : <label className="v2s-field"><span className="v2s-label">搜索服务</span><select className="v2s-select" value={String(draft.adapter ?? '')} onChange={e => patchDraft(['adapter'], e.target.value)}>{Object.values(CATALOG).map(c => <option key={c.adapter} value={c.adapter}>{c.label}</option>)}</select></label>}
                <label className="v2s-field"><span className="v2s-label">服务地址（HTTP API）</span><input className="v2s-input" type="url" value={String(draft.kind === 'model' ? object(draft.binding).baseURL ?? '' : draft.endpoint ?? '')} onChange={e => patchDraft(draft.kind === 'model' ? ['binding','baseURL'] : ['endpoint'], e.target.value)} /></label>
                <label className="v2s-field"><span className="v2s-label">凭据引用（不是 Key 本身）</span><input className="v2s-input" autoComplete="off" value={String(draft.kind === 'model' ? object(draft.binding).credentialRef ?? '' : draft.credentialRef ?? '')} onChange={e => patchDraft(draft.kind === 'model' ? ['binding','credentialRef'] : ['credentialRef'], e.target.value)} /></label>
              </div>
              <details className="v2s-field"><summary className="v2s-label">高级：JSON 与协议选项</summary>
                <label className="v2s-label" htmlFor={bodyId + '-conn-json'}>连接配置 JSON（禁止明文 Key）</label>
                <textarea
                  id={bodyId + '-conn-json'}
                  className="v2s-textarea"
                  rows={14}
                  spellCheck={false}
                  value={json}
                  onChange={e => { setJson(e.target.value); setConsent(false) }}
                />
                <p className="v2s-hint">model 使用 binding（mode=fixed、protocol、model、baseURL、credentialRef）；structured 使用 adapter、endpoint、credentialRef。具体选项由宿主校验。</p>
              </details>
              <label className="v2s-checkbox-label">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                <span>我确认信任此 endpoint / baseURL，并授权向该地址发送此 credentialRef 对应凭据。</span>
              </label>
              {editor.revision !== snapshot.revision ? (
                <p className="v2s-status-text v2s-status-error" role="alert">设置版本已变化。请放弃并重新打开编辑器，以免覆盖其他窗口的修改。</p>
              ) : null}
              <div className="v2s-editor-foot">
                <button type="button" className="v2s-btn" onClick={close}>放弃编辑</button>
                <button
                  type="button"
                  className="v2s-btn v2s-btn-primary"
                  disabled={!consent || disabled}
                  onClick={() => {
                    void act(async () => {
                      const id = connectionId.trim()
                      if (!editor.existing && (labels.has(id) || Object.hasOwn(config.connections ?? {}, id))) throw new Error('此连接 ID 已存在，请使用新的 ID。')
                      const connection = parseConnectionDraft(id, json, consent)
                      await mutate(sparseSettingOperations(editor.initial, ['connections', id], connection), editor.revision)
                    }, '连接已保存；请单独配置凭据并在会话中选择。')
                  }}
                >
                  保存连接
                </button>
              </div>
            </div>
          ) : null}

          <div className="v2s-footer">
            <div className="v2s-status-area">
              {busy ? <p className="v2s-status-text v2s-status-info" role="status">正在保存…</p> : null}
              {notice ? <p className="v2s-status-text v2s-status-notice" role="status">{notice}</p> : null}
              {error ? <p className="v2s-status-text v2s-status-error" role="alert">{error}</p> : null}
            </div>
            <div className="v2s-footer-actions">
              <button
                type="button"
                className="v2s-btn"
                disabled={disabled}
                onClick={() => { void act(() => mutate(resetSettingsOperations(snapshot)), '已恢复继承设置，所有凭据均保留。') }}
              >
                恢复继承设置（不删除任何 Key）
              </button>
              <button
                type="button"
                className="v2s-btn"
                disabled={busy}
                onClick={() => setRefresh(n => n + 1)}
              >
                刷新凭据状态
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  )
}
