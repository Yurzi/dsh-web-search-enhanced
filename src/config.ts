import type { Freshness, StructuredAdapter } from './catalog.ts'
import { CATALOG, SESSION_MODEL_ID, SESSION_MODEL_LABEL } from './catalog.ts'
import type { SearchProtocol } from './protocols.ts'
import { validateStructuredOptions } from './adapters/structured.ts'

export interface FixedBinding { mode: 'fixed'; protocol: SearchProtocol; model: string; baseURL: string; credentialRef: string }
export interface Connection {
  id: string; label: string; disabled: boolean; kind: 'structured' | 'model'
  adapter?: StructuredAdapter; endpoint?: string; credentialRef?: string
  binding?: FixedBinding | { mode: 'session' }
  options: Record<string, unknown>
  optionsByProtocol?: Partial<Record<SearchProtocol, Record<string, unknown>>>
}
export interface V2Config {
  version?: 2
  defaultConnection?: string
  freshness?: Freshness
  connections?: Record<string, Record<string, unknown>>
}
export interface ResolvedSettings { freshness: Freshness; defaultConnection?: string; connections: Record<string, Connection> }
const protocols = ['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const
export function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(field + ' must be an object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error(field + ': unknown or forbidden field')
}
export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(field + ' must not be blank')
  return value.trim()
}
export function endpoint(value: unknown): string {
  const v = text(value, 'endpoint')
  let u: URL
  try { u = new URL(v) } catch { throw new Error('endpoint must be an absolute HTTP(S) URL') }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('endpoint must not contain credentials, query or fragment')
  return v
}
export function reference(value: unknown): string {
  const v = text(value, 'credentialRef')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(v)) throw new Error('invalid credentialRef')
  return v
}
export function modelOptions(value: unknown = {}): Record<string, unknown> {
  const o = record(value, 'model options')
  keys(o, ['apiVersion', 'toolIdentifier', 'maxTokens', 'maxUses', 'chatSearchMode', 'searchContextSize'], 'model options')
  for (const n of ['maxTokens', 'maxUses']) if (o[n] !== undefined && (!Number.isInteger(o[n]) || Number(o[n]) < 1)) throw new Error(n + ' must be a positive integer')
  if (o.apiVersion !== undefined) text(o.apiVersion, 'apiVersion')
  if (o.toolIdentifier !== undefined && !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(text(o.toolIdentifier, 'toolIdentifier'))) throw new Error('invalid toolIdentifier')
  if (o.chatSearchMode !== undefined && !['search-model', 'vendor-options'].includes(String(o.chatSearchMode))) throw new Error('invalid chatSearchMode')
  if (o.searchContextSize !== undefined && !['low', 'medium', 'high'].includes(String(o.searchContextSize))) throw new Error('invalid searchContextSize')
  return structuredClone(o)
}
export function fixedBinding(value: unknown): FixedBinding {
  const b = record(value, 'binding')
  keys(b, ['mode', 'protocol', 'model', 'baseURL', 'credentialRef'], 'binding')
  if (b.mode !== 'fixed' || !protocols.includes(b.protocol as SearchProtocol)) throw new Error('unsupported fixed model protocol')
  return { mode: 'fixed', protocol: b.protocol as SearchProtocol, model: text(b.model, 'model'), baseURL: endpoint(b.baseURL), credentialRef: reference(b.credentialRef) }
}
/** Pure sparse merge. No credential lookup, writes, probing or implicit selection. */
export function resolveSettings(config: V2Config = {}): ResolvedSettings {
  if (config.version !== undefined && config.version !== 2) throw new Error('unsupported settings version')
  const freshness = config.freshness ?? 'auto'
  if (!['auto', 'fresh', 'realtime'].includes(freshness)) throw new Error('invalid freshness')
  const connections: Record<string, Connection> = Object.create(null)
  for (const [id, c] of Object.entries(CATALOG)) connections[id] = { id, kind: 'structured', label: c.label, disabled: false, adapter: c.adapter, endpoint: c.endpoint, credentialRef: c.credentialRef, options: {} }
  connections[SESSION_MODEL_ID] = { id: SESSION_MODEL_ID, kind: 'model', label: SESSION_MODEL_LABEL, disabled: false, binding: { mode: 'session' }, options: {} }
  for (const [id, raw] of Object.entries(config.connections ?? {})) {
    const c = record(raw, 'connection')
    const builtin = connections[id]
    if (builtin) {
      keys(c, id === SESSION_MODEL_ID ? ['disabled', 'optionsByProtocol'] : ['label', 'disabled', 'credentialRef', 'options'], id)
      if (c.disabled !== undefined && typeof c.disabled !== 'boolean') throw new Error('disabled must be boolean')
      if (c.label !== undefined) builtin.label = text(c.label, 'label')
      if (c.disabled !== undefined) builtin.disabled = c.disabled
      if (c.credentialRef !== undefined) builtin.credentialRef = reference(c.credentialRef)
      if (c.options !== undefined) builtin.options = structuredClone(record(c.options, 'options'))
      if (c.optionsByProtocol !== undefined) {
        const opts = record(c.optionsByProtocol, 'optionsByProtocol'); keys(opts, protocols, 'optionsByProtocol')
        builtin.optionsByProtocol = Object.fromEntries(Object.entries(opts).map(([p, o]) => [p, modelOptions(o)]))
      }
      continue
    }
    if (!/^custom:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(id)) throw new Error('invalid connection ID')
    keys(c, ['label', 'kind', 'disabled', 'adapter', 'endpoint', 'credentialRef', 'trustedEndpoint', 'binding', 'options'], id)
    if (c.disabled !== undefined && typeof c.disabled !== 'boolean') throw new Error('disabled must be boolean')
    const common = { id, label: text(c.label, 'label'), disabled: c.disabled === true }
    if (c.kind === 'model') {
      const binding = fixedBinding(c.binding)
      if (c.trustedEndpoint !== true) throw new Error('custom endpoint requires trustedEndpoint confirmation')
      connections[id] = { ...common, kind: 'model', binding, options: modelOptions(c.options) }
    } else if (c.kind === 'structured') {
      const preset = Object.values(CATALOG).find(v => v.adapter === c.adapter)
      if (!preset) throw new Error('unsupported structured adapter')
      const url = c.endpoint === undefined ? preset.endpoint : endpoint(c.endpoint)
      if (url !== preset.endpoint && c.trustedEndpoint !== true) throw new Error('custom endpoint requires trustedEndpoint confirmation')
      connections[id] = { ...common, kind: 'structured', adapter: preset.adapter, endpoint: url, credentialRef: reference(c.credentialRef), options: structuredClone(record(c.options ?? {}, 'options')) }
    } else throw new Error('invalid connection kind')
  }
  // Freshness-owned and secret fields must never enter a request snapshot.
  for (const c of Object.values(connections)) {
    if (c.kind === 'structured') c.options = validateStructuredOptions(c.adapter!, c.options)
  }
  return { freshness, ...(config.defaultConnection === undefined ? {} : { defaultConnection: text(config.defaultConnection, 'defaultConnection') }), connections }
}

export { importLegacy } from './migration.ts'
