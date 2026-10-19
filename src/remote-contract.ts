/**
 * The `searchConnections` Remote: per-session search selection, shared by the
 * Host service and the client. Schemas are strict at both ends.
 */
import type { RemoteResult, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import { z } from 'zod'
import { FRESHNESS } from './catalog.ts'

const sessionId = z.string().min(1).max(256)
const freshness = z.enum(FRESHNESS)

export const selectionRequest = z.object({ sessionId }).strict()
export const selectionChange = z.object({
  sessionId,
  /** A connection id, or null to turn web_search off for the session. */
  connectionId: z.string().min(1).max(128).nullable().optional(),
  freshness: freshness.optional(),
  /** Revision the caller observed; a stale one fails with `searchConnections/conflict`. */
  expectedRevision: z.number().int().nonnegative(),
}).strict().refine(change => change.connectionId !== undefined || change.freshness !== undefined, 'a change needs connectionId or freshness')

/**
 * Whether a connection can serve this session, judged from local facts only:
 * `ready` never proves upstream access, quota or health.
 */
export const CONNECTION_STATUS = ['ready', 'disabled', 'needs-credential', 'unsupported'] as const

export const connectionView = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['structured', 'model']),
  /** How the next search would authenticate. */
  access: z.enum(['keyless', 'api-key', 'account']),
  status: z.enum(CONNECTION_STATUS),
  /** Whether the session's freshness preference takes effect on this connection. */
  freshness: z.boolean(),
  /** Reference the connection resolves; present when `access` is `api-key`. */
  credentialRef: z.string().optional(),
  /** English diagnostic for `unsupported` (follow-model route facts). */
  detail: z.string().optional(),
}).strict()

export const selectionView = z.object({
  selection: z.object({ connectionId: z.string().nullable(), freshness, revision: z.number().int().nonnegative() }).strict(),
  connections: z.array(connectionView),
}).strict()

export type SelectionRequest = z.infer<typeof selectionRequest>
export type SelectionChange = z.infer<typeof selectionChange>
export type ConnectionStatus = typeof CONNECTION_STATUS[number]
export type ConnectionView = z.infer<typeof connectionView>
export type SelectionView = z.infer<typeof selectionView>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'searchConnections/get': (request: SelectionRequest) => Promise<RemoteResult<SelectionView>>
    'searchConnections/set': (request: SelectionChange) => Promise<RemoteResult<SelectionView>>
  }
  interface TypertRemoteNamespaceMap {
    searchConnections: TypertRemoteNamespace<'searchConnections'>
  }
  interface RemoteErrorDetailsMap {
    /** The selection changed after the caller read it; re-read and retry. */
    'searchConnections/conflict': {}
    /** The requested connection is missing or disabled. */
    'searchConnections/unavailable': { readonly connectionId: string }
  }
}

const strict = (typeSymbol: string, create: () => z.ZodType) => ({ mode: 'strict', typeSymbol, create }) as const
const request = (typeSymbol: string, create: () => z.ZodType) => ({ name: 'request', source: 'json', codec: strict(typeSymbol, create), strictCodec: strict(typeSymbol, create) }) as const

/** Client contribution; mount with `ctx.remote.$mount(searchConnectionsRemote)`. */
export const searchConnectionsRemote = createTypertRemoteInfo({
  package: 'dsh-web-search-enhanced',
  methods: {
    'searchConnections/get': {
      service: 'searchConnections', invocation: { kind: 'direct' },
      parameters: [request('SearchSelectionRequest', () => selectionRequest)],
      result: strict('SearchSelectionView', () => selectionView),
    },
    'searchConnections/set': {
      service: 'searchConnections', invocation: { kind: 'direct' },
      parameters: [request('SearchSelectionChange', () => selectionChange)],
      result: strict('SearchSelectionView', () => selectionView),
    },
  },
}, z)
