/**
 * Resolve the sparse settings document into every connection: the catalog
 * supplies the built-ins and the document only overrides them. Validation is
 * strict, so a typo never silently changes where a credential is sent.
 */
import { z } from 'zod'
import {
  ADAPTER_IDS, ADAPTERS, builtinConnectionId, CREDENTIAL_REF, CUSTOM_CONNECTION_ID, FRESHNESS, MODEL_PROTOCOLS, SESSION_MODEL_ID,
  type AdapterId, type Freshness, type ModelProtocol,
} from '../catalog.ts'
import { validateOptions } from './options.ts'
import type { Access, FixedModelBinding, V2Config } from './types.ts'
import { CURRENT_CONFIG_VERSION, configVersion } from './version.ts'

/** Host-side label of `builtin:session-model`; the client shows a localized one. */
const SESSION_MODEL_LABEL = 'Session model'

/** Absolute http(s) URL without credentials, query or fragment. */
export function isEndpoint(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
}

const label = z.string().trim().min(1)
const credentialRef = z.string().trim().regex(CREDENTIAL_REF, 'must be a credential reference such as EXA_API_KEY')
const endpoint = z.string().trim().refine(isEndpoint, 'must be an absolute http(s) URL without credentials, query or fragment')
const adapterOptions = z.record(z.string(), z.unknown())
const modelOptions = z.strictObject({
  apiVersion: z.string().trim().min(1).optional(),
  toolIdentifier: z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u).optional(),
  maxTokens: z.int().positive().optional(),
  maxUses: z.int().positive().optional(),
  chatSearchMode: z.enum(['search-model', 'vendor-options']).optional(),
  searchContextSize: z.enum(['low', 'medium', 'high']).optional(),
})
const fixedBinding = z.strictObject({ mode: z.literal('fixed'), protocol: z.enum(MODEL_PROTOCOLS), model: label, baseURL: endpoint, credentialRef })
const builtinOverride = z.strictObject({
  label: label.optional(),
  disabled: z.boolean().optional(),
  credentialRef: credentialRef.optional(),
  access: z.enum(['keyless', 'api-key']).optional(),
  options: adapterOptions.optional(),
})
const sessionModelOverride = z.strictObject({
  disabled: z.boolean().optional(),
  optionsByProtocol: z.partialRecord(z.enum(MODEL_PROTOCOLS), modelOptions).optional(),
})
const customConnection = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('structured'), label, adapter: z.enum(ADAPTER_IDS), credentialRef, endpoint: endpoint.optional(),
    trustedEndpoint: z.boolean().optional(), disabled: z.boolean().optional(), options: adapterOptions.optional(),
  }),
  z.strictObject({
    kind: z.literal('model'), label, binding: fixedBinding,
    trustedEndpoint: z.literal(true, { error: 'a custom model endpoint needs trustedEndpoint: true' }),
    disabled: z.boolean().optional(), options: modelOptions.optional(),
  }),
])
const document = z.object({
  version: z.literal(CURRENT_CONFIG_VERSION).optional(),
  defaultConnection: label.optional(),
  freshness: z.enum(FRESHNESS).optional(),
  showSelector: z.boolean().optional(),
  connections: z.record(z.string(), z.unknown()).optional(),
})

/** Server-side search options of a model connection for one protocol. */
export type ModelSearchOptions = z.output<typeof modelOptions>

interface ConnectionBase {
  readonly id: string
  readonly label: string
  readonly disabled: boolean
}

export interface StructuredConnection extends ConnectionBase {
  readonly kind: 'structured'
  readonly adapter: AdapterId
  readonly endpoint: string
  readonly access: Access
  /** Personal credential; unused while `access` is keyless. */
  readonly credentialRef: string
  readonly options: Readonly<Record<string, unknown>>
}

export interface ModelConnection extends ConnectionBase {
  readonly kind: 'model'
  /** A fixed route, or `session` to search with the model serving the calling session. */
  readonly route: FixedModelBinding | 'session'
  readonly options: Readonly<Partial<Record<ModelProtocol, ModelSearchOptions>>>
}

export type Connection = StructuredConnection | ModelConnection

export interface ResolvedSettings {
  readonly freshness: Freshness
  /** May name a missing or disabled connection; sessions then report the selection as invalid. */
  readonly defaultConnection: string | undefined
  readonly showSelector: boolean
  /** Built-ins in catalog order, then the session model, then custom connections. */
  readonly connections: ReadonlyMap<string, Connection>
}

/**
 * Validate a current-version settings document and merge it over the catalog.
 * Pure: no credential lookup, no implicit selection.
 * @throws an Error naming the offending setting.
 */
export function resolveSettings(config: V2Config = {}): ResolvedSettings {
  if (configVersion(config) !== CURRENT_CONFIG_VERSION) throw new Error('search settings use the version-1 format; migrate them first')
  const settings = parse(document, config, 'settings')
  const overrides = settings.connections ?? {}
  const connections = new Map<string, Connection>()
  for (const adapter of ADAPTER_IDS) {
    const id = builtinConnectionId(adapter)
    connections.set(id, builtin(id, adapter, overrides[id]))
  }
  connections.set(SESSION_MODEL_ID, sessionModel(overrides[SESSION_MODEL_ID]))
  for (const [id, raw] of Object.entries(overrides)) {
    if (connections.has(id)) continue
    if (!CUSTOM_CONNECTION_ID.test(id)) throw new Error(`invalid search settings: unknown connection id "${id}"; custom connections are named custom:<name>`)
    connections.set(id, custom(id, raw))
  }
  return { freshness: settings.freshness ?? 'auto', defaultConnection: settings.defaultConnection, showSelector: settings.showSelector ?? true, connections }
}

function builtin(id: string, adapter: AdapterId, raw: unknown): StructuredConnection {
  const info = ADAPTERS[adapter]
  const override = raw === undefined ? {} : parse(builtinOverride, raw, `connections.${id}`)
  const access = override.access ?? (info.keyless ? 'keyless' : 'api-key')
  if (access === 'keyless' && !info.keyless) throw new Error(`invalid search settings: ${id} has no keyless access`)
  return {
    kind: 'structured', id, label: override.label ?? info.label, disabled: override.disabled ?? false,
    adapter, endpoint: info.endpoint, access, credentialRef: override.credentialRef ?? info.credentialRef,
    options: checkedOptions(id, adapter, override.options ?? {}, access),
  }
}

function sessionModel(raw: unknown): ModelConnection {
  const override = raw === undefined ? {} : parse(sessionModelOverride, raw, `connections.${SESSION_MODEL_ID}`)
  return { kind: 'model', id: SESSION_MODEL_ID, label: SESSION_MODEL_LABEL, disabled: override.disabled ?? false, route: 'session', options: override.optionsByProtocol ?? {} }
}

function custom(id: string, raw: unknown): Connection {
  const connection = parse(customConnection, raw, `connections.${id}`)
  const base = { id, label: connection.label, disabled: connection.disabled ?? false }
  if (connection.kind === 'model') {
    const { binding } = connection
    return { ...base, kind: 'model', route: binding, options: { [binding.protocol]: connection.options ?? {} } }
  }
  const official = ADAPTERS[connection.adapter].endpoint
  const url = connection.endpoint ?? official
  if (url !== official && connection.trustedEndpoint !== true) {
    throw new Error(`invalid search settings: ${id} sends its API key to a custom endpoint, which needs trustedEndpoint: true`)
  }
  return {
    ...base, kind: 'structured', adapter: connection.adapter, endpoint: url, access: 'api-key',
    credentialRef: connection.credentialRef, options: checkedOptions(id, connection.adapter, connection.options ?? {}, 'api-key'),
  }
}

function checkedOptions(id: string, adapter: AdapterId, options: Record<string, unknown>, access: Access): Record<string, unknown> {
  const problems = validateOptions(adapter, options, access)
  if (problems.length > 0) throw new Error(`invalid search settings: ${id}: ${problems.join('; ')}`)
  return options
}

function parse<T>(schema: z.ZodType<T>, value: unknown, path: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issues = result.error.issues.map(issue => `${[path, ...issue.path.map(String)].join('.')}: ${issue.message}`)
  throw new Error(`invalid search settings: ${issues.join('; ')}`)
}
