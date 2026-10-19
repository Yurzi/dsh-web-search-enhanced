/** Read-only facts the settings page derives from the effective settings and the catalog. */
import {
  ADAPTER_IDS, ADAPTERS, builtinConnectionId, CUSTOM_CONNECTION_ID, MODEL_PROTOCOLS, SESSION_MODEL_ID,
  type AdapterId, type ModelProtocol, type OptionRule,
} from '../../catalog.ts'
import type { Access, BuiltinOverride, CustomConnection, ModelOptions, SessionModelOverride, V2Config } from '../../settings/types.ts'
import type { Translate } from '../connections.ts'
import type { LocaleKey } from '../locales.ts'

// Connection ids determine the entry shape; the Host validates the document.
export const builtinOverride = (config: V2Config, adapter: AdapterId): BuiltinOverride =>
  (config.connections?.[builtinConnectionId(adapter)] ?? {}) as BuiltinOverride

export const sessionModelOverride = (config: V2Config): SessionModelOverride =>
  (config.connections?.[SESSION_MODEL_ID] ?? {}) as SessionModelOverride

export function customConnections(config: V2Config): [string, CustomConnection][] {
  return Object.entries(config.connections ?? {})
    .filter(([id]) => CUSTOM_CONNECTION_ID.test(id))
    .map(([id, connection]) => [id, connection as CustomConnection])
}

/** Built-in connections default to the anonymous route where one exists. */
export function builtinAccess(adapter: AdapterId, override: BuiltinOverride): Access {
  return ADAPTERS[adapter].keyless ? override.access ?? 'keyless' : 'api-key'
}

export const builtinCredentialRef = (adapter: AdapterId, override: BuiltinOverride): string =>
  override.credentialRef ?? ADAPTERS[adapter].credentialRef

export const customCredentialRef = (connection: CustomConnection): string =>
  connection.kind === 'structured' ? connection.credentialRef : connection.binding.credentialRef

/** Every credential reference the page reports on. */
export function credentialRefs(config: V2Config): string[] {
  return [...new Set([
    ...ADAPTER_IDS.map(adapter => builtinCredentialRef(adapter, builtinOverride(config, adapter))),
    ...customConnections(config).map(([, connection]) => customCredentialRef(connection)),
  ])]
}

export interface Choice { readonly id: string; readonly label: string }

/** Connections a default can name, in the composer's order. */
export function connectionChoices(config: V2Config, t: Translate): Choice[] {
  return [
    ...ADAPTER_IDS.map(adapter => ({ id: builtinConnectionId(adapter), label: builtinOverride(config, adapter).label ?? ADAPTERS[adapter].label })),
    { id: SESSION_MODEL_ID, label: t('connection.followModel') },
    ...customConnections(config).map(([id, connection]) => ({ id, label: connection.label })),
  ]
}

/** One optional request option as the forms show it; empty text means the default. */
export interface FieldSpec {
  readonly name: string
  readonly label: LocaleKey
  readonly kind: 'text' | 'integer' | 'boolean' | 'enum'
  /** Accepted enum values on this route. */
  readonly values: readonly string[]
  readonly pattern: RegExp | undefined
  /** Localized example or the default value. */
  readonly placeholder: (t: Translate) => string | undefined
}

interface OptionCopy { readonly label: LocaleKey; readonly placeholder?: LocaleKey }
type AdapterOptionCopy = { readonly [A in AdapterId]: { readonly [K in keyof (typeof ADAPTERS)[A]['options']]: OptionCopy } }

const ADAPTER_OPTION_COPY = {
  exa: { type: { label: 'option.exa.type' } },
  firecrawl: {
    country: { label: 'option.firecrawl.country', placeholder: 'option.firecrawl.country.placeholder' },
    location: { label: 'option.firecrawl.location', placeholder: 'option.firecrawl.location.placeholder' },
    safe: { label: 'option.firecrawl.safe' },
  },
  tavily: { search_depth: { label: 'option.tavily.search_depth' }, topic: { label: 'option.tavily.topic' } },
  tinyfish: {
    location: { label: 'option.tinyfish.location', placeholder: 'option.tinyfish.location.placeholder' },
    language: { label: 'option.tinyfish.language', placeholder: 'option.tinyfish.language.placeholder' },
    purpose: { label: 'option.tinyfish.purpose', placeholder: 'option.tinyfish.purpose.placeholder' },
    domain_type: { label: 'option.tinyfish.domain_type' },
  },
  deepseek: {},
  openalex: {
    sort: { label: 'option.openalex.sort', placeholder: 'option.openalex.sort.placeholder' },
    filter: { label: 'option.openalex.filter', placeholder: 'option.openalex.filter.placeholder' },
    is_oa: { label: 'option.openalex.is_oa' },
    mailto: { label: 'option.openalex.mailto', placeholder: 'option.openalex.mailto.placeholder' },
  },
  semanticscholar: {
    year: { label: 'option.semanticscholar.year', placeholder: 'option.semanticscholar.year.placeholder' },
    fieldsOfStudy: { label: 'option.semanticscholar.fieldsOfStudy', placeholder: 'option.semanticscholar.fieldsOfStudy.placeholder' },
    publicationTypes: { label: 'option.semanticscholar.publicationTypes', placeholder: 'option.semanticscholar.publicationTypes.placeholder' },
  },
} as const satisfies AdapterOptionCopy

/** Options an adapter route accepts; the anonymous route drops or narrows some of them. */
export function adapterFields(adapter: AdapterId, access: Access): { fields: FieldSpec[]; restricted: boolean } {
  const copy = ADAPTER_OPTION_COPY[adapter] as Readonly<Record<string, OptionCopy>>
  const fields: FieldSpec[] = []
  let restricted = false
  for (const [name, rule] of Object.entries(ADAPTERS[adapter].options) as [string, OptionRule][]) {
    if (access === 'keyless' && rule.keyless === false) {
      restricted = true
      continue
    }
    let values: readonly string[] = []
    if (rule.kind === 'enum') {
      values = access === 'keyless' && rule.keyless ? rule.keyless : rule.values
      if (values.length < rule.values.length) restricted = true
    }
    const { label, placeholder } = copy[name]!
    fields.push({
      name, label, kind: rule.kind, values,
      pattern: rule.kind === 'text' ? rule.pattern : undefined,
      placeholder: t => placeholder === undefined ? undefined : t(placeholder),
    })
  }
  return { fields, restricted }
}

/** Protocol names are product names; they stay verbatim in every language. */
export const PROTOCOL_LABELS: Record<ModelProtocol, string> = {
  'anthropic-messages': 'Anthropic Messages',
  'openai-responses': 'OpenAI Responses',
  'openai-chat-completions': 'Chat Completions',
}

/** Defaults the Host applies to model search (src/search/model.ts). */
const DEFAULT_TOOL: Record<ModelProtocol, string> = {
  'anthropic-messages': 'web_search_20260209',
  'openai-responses': 'web_search',
  'openai-chat-completions': 'web_search_options',
}

const fixed = (text: string | undefined) => () => text
const OPENAI = ['openai-responses', 'openai-chat-completions'] as const satisfies readonly ModelProtocol[]

interface ModelField extends FieldSpec { readonly protocols: readonly ModelProtocol[] }

const MODEL_FIELDS: readonly ModelField[] = [
  { name: 'maxTokens', label: 'option.model.maxTokens', kind: 'integer', values: [], pattern: undefined, placeholder: fixed('4096'), protocols: MODEL_PROTOCOLS },
  { name: 'maxUses', label: 'option.model.maxUses', kind: 'integer', values: [], pattern: undefined, placeholder: fixed('5'), protocols: ['anthropic-messages'] },
  { name: 'apiVersion', label: 'option.model.apiVersion', kind: 'text', values: [], pattern: /^\S.{0,63}$/u, placeholder: fixed('2023-06-01'), protocols: ['anthropic-messages'] },
  { name: 'searchContextSize', label: 'option.model.searchContextSize', kind: 'enum', values: ['low', 'medium', 'high'], pattern: undefined, placeholder: fixed(undefined), protocols: OPENAI },
  { name: 'chatSearchMode', label: 'option.model.chatSearchMode', kind: 'enum', values: ['search-model', 'vendor-options'], pattern: undefined, placeholder: fixed(undefined), protocols: ['openai-chat-completions'] },
] satisfies readonly (ModelField & { name: keyof ModelOptions })[]

/** Search options a model connection accepts on one protocol. */
export function modelFields(protocol: ModelProtocol): FieldSpec[] {
  const tool: FieldSpec = {
    name: 'toolIdentifier' satisfies keyof ModelOptions, label: 'option.model.toolIdentifier', kind: 'text', values: [],
    pattern: /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u, placeholder: fixed(DEFAULT_TOOL[protocol]),
  }
  return [...MODEL_FIELDS.filter(field => field.protocols.includes(protocol)), tool]
}

const VALUE_LABELS: Readonly<Record<string, LocaleKey>> = {
  'auto': 'value.auto', 'fast': 'value.fast', 'instant': 'value.instant', 'basic': 'value.basic', 'advanced': 'value.advanced',
  'ultra-fast': 'value.ultra-fast', 'general': 'value.general', 'news': 'value.news', 'finance': 'value.finance', 'web': 'value.web',
  'research_paper': 'value.research_paper', 'low': 'value.low', 'medium': 'value.medium', 'high': 'value.high',
  'search-model': 'value.search-model', 'vendor-options': 'value.vendor-options',
}

/** Localized enum value where it is a word; codes stay verbatim. */
export function valueLabel(value: string, t: Translate): string {
  const key = VALUE_LABELS[value]
  return key === undefined ? value : t(key)
}

/** Editor text per field name. */
export type FieldTexts = Readonly<Record<string, string>>

/** Editor text of a stored value; empty means the default. */
export const fieldText = (value: unknown): string => value === undefined ? '' : String(value)

/** Whether editor text is acceptable; empty always is. */
export function isValidText(field: FieldSpec, text: string): boolean {
  if (text === '') return true
  switch (field.kind) {
    case 'enum': return field.values.includes(text)
    case 'boolean': return text === 'true' || text === 'false'
    case 'integer': return /^[1-9]\d{0,8}$/u.test(text)
    case 'text': return field.pattern === undefined || field.pattern.test(text)
  }
}

/** Stored value of valid editor text; undefined returns the option to its default. */
export function fieldValue(field: FieldSpec, text: string): unknown {
  if (text === '') return undefined
  return field.kind === 'boolean' ? text === 'true' : field.kind === 'integer' ? Number(text) : text
}

/** Options with every field's text applied; empty text removes the option. Other keys stay. */
export function applyFields(fields: readonly FieldSpec[], texts: FieldTexts, stored: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stored }
  for (const field of fields) {
    const value = fieldValue(field, texts[field.name] ?? fieldText(stored[field.name]))
    if (value === undefined) delete next[field.name]
    else next[field.name] = value
  }
  return next
}