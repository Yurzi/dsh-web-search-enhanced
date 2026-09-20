import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { V2Config } from '../config.ts'
import type { CredentialRemote } from './SearchSettingsCard.tsx'
import { CATALOG, SESSION_MODEL_ID, SESSION_MODEL_LABEL } from '../catalog.ts'
import { freshnessLabels } from './SearchConnectionSelector.tsx'
import { importLegacy } from '../migration.ts'

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
  const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope))
  const config = snapshot.value ?? {}
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
    setEditor({ type: 'connection', id: id ?? '', existing: !!id, initial: { base: snapshot.base, user: snapshot.user }, revision: snapshot.revision })
    setConnectionId(id ?? 'custom:'); setJson(id ? JSON.stringify(config.connections?.[id], null, 2) : template(kind)); setConsent(false); setKeyValue(''); setError('')
  }
  const openKey = (ref: string) => { setEditor({ type: 'key', ref }); setKeyValue(''); setConsent(false); setError('') }
  const labels = new Map<string, string>([[SESSION_MODEL_ID, SESSION_MODEL_LABEL], ...Object.entries(CATALOG).map(([id, c]): [string, string] => [id, c.label]), ...custom.map(([id, c]): [string, string] => [id, String(c.label ?? id)])])
  if (snapshot.status === 'unavailable') return null
  return <li data-plugin-key="web-search-enhanced" style={{ listStyle: 'none', padding: 16, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, color: 'var(--dsw-alias-label-primary)' }}>
    <h3>搜索连接</h3>
    {config.version !== 2 && ['modelMode', 'protocol', 'baseURL', 'model', 'apiKeyEnv'].some(k => object(config)[k] !== undefined) ? <fieldset disabled={disabled}><legend>旧配置需要显式导入</legend>
      <p>固定路由将成为 custom:legacy；跟随模式保留为“跟随会话模型”。旧 fallback 不再执行。请先把任何明文 apiKey 转存 DSH Credentials 并从旧配置移除。</p>
      <button type="button" onClick={() => { void act(async () => {
        const imported = importLegacy(object(config))
        const ops: SettingsPathOpView[] = Object.entries(imported).map(([key, value]) => ({ op: 'set', path: [key], value: value as Extract<SettingsPathOpView, { op: 'set' }>['value'] }))
        for (const key of ['modelMode','protocol','baseURL','model','fallbackModel','apiKeyEnv','apiVersion','toolIdentifier','maxTokens','maxUses','chatSearchMode','searchContextSize']) if (Object.hasOwn(object(snapshot.user), key)) ops.push({op:'unset',path:[key]})
        await mutate(ops)
      }, '旧连接已导入为新会话默认；已有会话仍需显式选择。') }}>导入旧配置（不迁移或删除 Key）</button>
    </fieldset> : null}
    <p>每个会话独立选择连接。配置 Key 不会自动选中或发起联网测试；“已配置”不代表已验证权限、余额或健康状态。</p>
    <fieldset disabled={disabled}><legend>通用偏好</legend>
      <label>新会话默认连接 <select value={config.defaultConnection ?? ''} onChange={e => { const value = e.target.value || undefined; void act(() => mutate(sparseSettingOperations(snapshot, ['defaultConnection'], value)), '已保存新会话默认；已有会话不变。') }}>
        <option value="">继承默认（无默认时让用户选择）</option>
        {config.defaultConnection && !labels.has(config.defaultConnection) ? <option value={config.defaultConnection}>已失效：{config.defaultConnection}</option> : null}
        {[...labels].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <p><label>内容实时性（全局） <select value={config.freshness ?? 'auto'} onChange={e => { void act(() => mutate(sparseSettingOperations(snapshot, ['freshness'], e.target.value, 'auto')), '已保存全局内容实时性。') }}>{Object.entries(freshnessLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></p>
      <p>优先新鲜：支持时使用不超过 24 小时的内容缓存；优先实时：支持时重新获取页面。两者可能增加延迟和额度消耗，不保证索引实时或内容准确；不支持的连接忽略此偏好，不切换服务。</p>
    </fieldset>
    <h4>内置结构化连接 · 只需 Key</h4>
    {Object.entries(CATALOG).map(([id, c]) => { const ref = refFor(id, c.credentialRef); return <p key={id}>{String(config.connections?.[id]?.label ?? c.label)} · {states[ref]?.configured ? '已配置' : '未配置'}{config.connections?.[id]?.disabled ? ' · 已禁用' : ''} <button type="button" disabled={busy} aria-expanded={editor?.type === 'key' && editor.ref === ref} onClick={() => openKey(ref)}>配置 / 管理 Key</button></p> })}
    <h4>模型与自定义连接</h4><p>{SESSION_MODEL_LABEL}：无需重复填写 Key；当前宿主有效模型绑定不可用，仍可显式选择，但执行会明确报错。</p>
    {custom.map(([id, c]) => <p key={id}>{String(c.label ?? id)} · {id} <button type="button" disabled={disabled} onClick={() => openConnection(c.kind === 'model' ? 'model' : 'structured', id)}>编辑</button> <button type="button" disabled={busy || !refFor(id)} onClick={() => openKey(refFor(id))}>管理 Key</button> <button type="button" disabled={disabled} onClick={() => { void act(() => mutate(sparseSettingOperations(snapshot, ['connections', id], undefined)), '已移除用户覆盖；继承连接仍保留，凭据未删除。') }}>移除用户连接覆盖</button></p>)}
    <button type="button" disabled={disabled} onClick={() => openConnection('model')}>添加固定模型连接</button>{' '}
    <button type="button" disabled={disabled} onClick={() => openConnection('structured')}>添加自定义结构化连接</button>
    {editor?.type === 'key' ? <fieldset disabled={busy}><legend>凭据：{editor.ref}</legend>
      <p>密钥仅提交到 DSH Credentials，不写入 settings，不回显现有值。</p>
      <label>新 Key <input type="password" autoComplete="new-password" value={keyValue} disabled={states[editor.ref]?.writable === false} onChange={e => setKeyValue(e.target.value)} /></label>
      {states[editor.ref]?.writable === false ? <p>此凭据来源只读，请通过宿主凭据配置管理。</p> : null}
      <button type="button" disabled={!keyValue.trim() || states[editor.ref]?.writable === false} onClick={() => { const ref = editor.ref; const secret = keyValue; void act(async () => { await saveV2Credential(credentials, ref, secret); if (alive.current) { setKeyValue(''); setRefresh(n => n + 1) } }, '凭据已保存；连接选择未改变。') }}>仅保存 Key</button>
      <button type="button" onClick={close}>取消</button>
    </fieldset> : null}
    {editor?.type === 'connection' ? <fieldset disabled={disabled}><legend>固定模型 / 自定义连接 JSON</legend>
      <label>连接 ID <input value={connectionId} disabled={editor.existing} onChange={e => setConnectionId(e.target.value)} /></label>
      <p><label>连接配置（禁止明文 Key）<textarea rows={16} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} value={json} onChange={e => { setJson(e.target.value); setConsent(false) }} /></label></p>
      <p>model 使用 binding（mode=fixed、protocol、model、baseURL、credentialRef）；structured 使用 adapter、endpoint、credentialRef。具体选项由宿主校验。</p>
      <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我确认信任此 endpoint / baseURL，并授权向该地址发送此 credentialRef 对应凭据。</label>
      <p><button type="button" disabled={!consent} onClick={() => { void act(async () => { const id = connectionId.trim(); if (!editor.existing && (labels.has(id) || Object.hasOwn(config.connections ?? {}, id))) throw new Error('此连接 ID 已存在，请使用新的 ID。'); const connection = parseConnectionDraft(id, json, consent); await mutate(sparseSettingOperations(editor.initial, ['connections', id], connection), editor.revision) }, '连接已保存；请单独配置凭据并在会话中选择。') }}>保存连接</button> <button type="button" onClick={close}>放弃编辑</button></p>
      {editor.revision !== snapshot.revision ? <p role="alert">设置版本已变化。请放弃并重新打开编辑器，以免覆盖其他窗口的修改。</p> : null}
    </fieldset> : null}
    <p><button type="button" disabled={disabled} onClick={() => { void act(() => mutate(resetSettingsOperations(snapshot)), '已恢复继承设置，所有凭据均保留。') }}>恢复继承设置（不删除任何 Key）</button> <button type="button" disabled={busy} onClick={() => setRefresh(n => n + 1)}>刷新凭据状态</button></p>
    {!snapshot.writable ? <p role="status">设置只读或尚未加载。</p> : null}
    {busy ? <p role="status">正在保存…</p> : null}{notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </li>
}
