/**
 * Persisted settings of the plugin's Loader entry (`web-search-enhanced`).
 * Values are sparse: the built-in catalog supplies every default, and the
 * settings document stores only differences. Shared by the Host and the client.
 */
import type { AdapterId, Freshness, ModelProtocol } from '../catalog.ts'
import type { CURRENT_CONFIG_VERSION } from './version.ts'

export type Access = 'keyless' | 'api-key'

/** Overrides accepted on a built-in structured connection (`builtin:<adapter>`). */
export interface BuiltinOverride {
  label?: string
  disabled?: boolean
  credentialRef?: string
  access?: Access
  options?: Record<string, unknown>
}

/** Search options of a model connection; every field is optional. */
export interface ModelOptions {
  /** Anthropic `anthropic-version` header; default `2023-06-01`. */
  apiVersion?: string
  /** Server tool type (Anthropic, Responses) or Chat vendor field. */
  toolIdentifier?: string
  /** Output budget of one search request; default 4096. */
  maxTokens?: number
  /** Anthropic `max_uses`; default 5. */
  maxUses?: number
  /** Chat Completions: official search model or a vendor options field. */
  chatSearchMode?: 'search-model' | 'vendor-options'
  searchContextSize?: 'low' | 'medium' | 'high'
}

/** Overrides accepted on `builtin:session-model`. */
export interface SessionModelOverride {
  disabled?: boolean
  optionsByProtocol?: Partial<Record<ModelProtocol, ModelOptions>>
}

export interface FixedModelBinding {
  mode: 'fixed'
  protocol: ModelProtocol
  model: string
  baseURL: string
  credentialRef: string
}

/** A user-defined connection under a `custom:<name>` id. */
export type CustomConnection =
  | { kind: 'structured'; label: string; adapter: AdapterId; credentialRef: string; endpoint?: string; trustedEndpoint?: boolean; disabled?: boolean; options?: Record<string, unknown> }
  | { kind: 'model'; label: string; binding: FixedModelBinding; trustedEndpoint: true; disabled?: boolean; options?: ModelOptions }

export interface V2Config {
  /** Schema version; omitted in historical sparse version-2 documents. */
  version?: typeof CURRENT_CONFIG_VERSION
  /** Connection selected for sessions without a stored selection. */
  defaultConnection?: string
  /** Freshness of sessions without a stored selection; default `auto`. */
  freshness?: Freshness
  /** Show the composer selector; `/setup-search` works either way. Default true. */
  showSelector?: boolean
  /** Built-in overrides and custom connections, validated by `resolveSettings`. */
  connections?: Record<string, BuiltinOverride | SessionModelOverride | CustomConnection>
}
