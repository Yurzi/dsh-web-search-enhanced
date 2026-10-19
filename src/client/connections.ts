/** Presentation facts about connections, shared by the composer selector and /setup-search. */
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ADAPTERS, isAdapterId, SESSION_MODEL_ID, type AdapterId, type Freshness } from '../catalog.ts'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionView, SelectionView } from '../remote-contract.ts'
import type { CustomConnection, V2Config } from '../settings/types.ts'
import type { LocaleKey, NS } from './locales.ts'

export type Translate = TranslateNS<typeof NS>

const BUILTIN_PREFIX = 'builtin:'

export function connectionLabel(connection: ConnectionView, t: Translate): string {
  return connection.id === SESSION_MODEL_ID ? t('connection.followModel') : connection.label
}

/** Search adapter behind a structured connection: built-in by id, custom by its settings entry. */
export function adapterOf(connectionId: string, config: V2Config | undefined): AdapterId | undefined {
  if (connectionId.startsWith(BUILTIN_PREFIX)) {
    const id = connectionId.slice(BUILTIN_PREFIX.length)
    return isAdapterId(id) ? id : undefined
  }
  const custom = config?.connections?.[connectionId] as CustomConnection | undefined
  return custom?.kind === 'structured' ? custom.adapter : undefined
}

/** Why a connection cannot serve the session, or undefined when it is ready. */
export function notReadyReason(connection: ConnectionView, config: V2Config | undefined, t: Translate): string | undefined {
  const name = connectionLabel(connection, t)
  switch (connection.status) {
    case 'ready': return undefined
    case 'disabled': return t('status.disabled', { name })
    case 'unsupported': return t('status.unsupported', { name })
    case 'needs-credential': {
      const adapter = adapterOf(connection.id, config)
      return t(adapter !== undefined && ADAPTERS[adapter].account ? 'status.needsAccount' : 'status.needsCredential', { name })
    }
  }
}

/**
 * Short row caption: why a connection cannot be chosen, or how a ready one
 * signs in when that is not the usual personal key.
 */
export function rowCaption(connection: ConnectionView, t: Translate): string | undefined {
  switch (connection.status) {
    case 'needs-credential': return t('status.short.needsCredential')
    case 'unsupported': return t('status.short.unsupported')
    default: return connection.access === 'keyless' ? t('access.keyless') : connection.access === 'account' ? t('access.account') : undefined
  }
}

/** Connections a session can see in a picker: everything enabled, grouped by kind. */
export function pickerGroups(view: SelectionView): { services: ConnectionView[]; models: ConnectionView[] } {
  const visible = view.connections.filter(connection => connection.status !== 'disabled')
  return {
    services: visible.filter(connection => connection.kind === 'structured'),
    models: visible.filter(connection => connection.kind === 'model'),
  }
}

export type SelectionIssue =
  | { readonly kind: 'missing' }
  | { readonly kind: 'not-ready'; readonly connection: ConnectionView }

/** What is wrong with the selected connection, if anything. */
export function selectionIssue(view: SelectionView): SelectionIssue | undefined {
  const { connectionId } = view.selection
  if (connectionId === null) return undefined
  const connection = view.connections.find(candidate => candidate.id === connectionId)
  if (connection === undefined) return { kind: 'missing' }
  return connection.status === 'ready' ? undefined : { kind: 'not-ready', connection }
}

const FRESHNESS_LABELS = { auto: 'freshness.auto', fresh: 'freshness.fresh', realtime: 'freshness.realtime' } as const satisfies Record<Freshness, LocaleKey>

export function freshnessLabel(freshness: Freshness, t: Translate): string {
  return t(FRESHNESS_LABELS[freshness])
}

/** Session model identity whose change re-evaluates the session's search defaults. */
export function modelKeyOf(projection: ModelSelectionProjection | undefined): string {
  const model = projection?.next ?? projection?.lastUsed
  return model ? `${model.provider}/${model.model}` : ''
}

/** Localized list of the built-in services matching a predicate. */
export function adapterList(t: Translate, predicate: (adapter: (typeof ADAPTERS)[AdapterId]) => boolean): string {
  return Object.values(ADAPTERS).filter(predicate).map(adapter => adapter.label).join(t('list.separator'))
}

/** Services whose cache controls follow the freshness preference, noting those that need a personal key. */
export function freshnessServices(t: Translate): string {
  return Object.values(ADAPTERS)
    .filter(adapter => adapter.freshness.length > 0)
    // Services that honor it on every route come first.
    .sort((a, b) => b.freshness.length - a.freshness.length)
    .map(adapter => (adapter.freshness as readonly string[]).includes('keyless') ? adapter.label : t('defaults.freshnessKeyOnly', { name: adapter.label }))
    .join(t('list.separator'))
}

/** Localized text for a refused selection write. */
export function writeFailureText(error: RemoteFailure, t: Translate): string {
  switch (error.code) {
    case 'searchConnections/conflict': return t('write.conflict')
    case 'searchConnections/unavailable': return t('write.unavailable')
    default: return t('write.failed')
  }
}