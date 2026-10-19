/**
 * Secret-free facts about the built-in search adapters, shared by the Host
 * (validation and routing) and the client (settings UI). Adding an adapter
 * starts with an entry here and a wire module in `src/search/adapters/`.
 */

export const FRESHNESS = ['auto', 'fresh', 'realtime'] as const
/** Content-cache preference of a session; not a publication-date filter. */
export type Freshness = typeof FRESHNESS[number]

export const MODEL_PROTOCOLS = ['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const
/** Wire protocol of a model connection that searches with a server-side tool. */
export type ModelProtocol = typeof MODEL_PROTOCOLS[number]

/**
 * One accepted adapter option. `keyless` restricts the option on the anonymous
 * route: omitted accepts it unchanged, `false` rejects it, a list narrows the
 * accepted enum values.
 */
export type OptionRule =
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly keyless?: readonly string[] | false }
  | { readonly kind: 'text'; readonly pattern: RegExp; readonly keyless?: false }
  | { readonly kind: 'boolean'; readonly keyless?: false }

export interface AdapterInfo {
  readonly label: string
  /** Official REST endpoint used with personal credentials. */
  readonly endpoint: string
  /** Default DSH credential reference for personal access. */
  readonly credentialRef: string
  /** Whether an anonymous route exists; built-in connections then default to it. */
  readonly keyless: boolean
  /** Whether a DeepSeek account sign-in can authenticate sessions on that route. */
  readonly account: boolean
  /** Access modes on which `fresh` / `realtime` map to upstream cache controls. */
  readonly freshness: readonly ('keyless' | 'api-key')[]
  /** Service homepage, where a user signs up for a personal key. */
  readonly homepage: string
  readonly options: Readonly<Record<string, OptionRule>>
}

const noControl = /^[^\x00-\x1f]{1,200}$/u

/** Display order of the built-in connections. */
export const ADAPTERS = {
  exa: {
    label: 'Exa', endpoint: 'https://api.exa.ai/search', credentialRef: 'EXA_API_KEY',
    keyless: true, account: false, freshness: ['api-key'], homepage: 'https://exa.ai',
    options: { type: { kind: 'enum', values: ['auto', 'fast', 'instant'], keyless: false } },
  },
  firecrawl: {
    label: 'Firecrawl', endpoint: 'https://api.firecrawl.dev/v2/search', credentialRef: 'FIRECRAWL_API_KEY',
    keyless: true, account: false, freshness: ['keyless', 'api-key'], homepage: 'https://www.firecrawl.dev',
    options: { country: { kind: 'text', pattern: /^[A-Za-z]{2}$/u }, location: { kind: 'text', pattern: noControl }, safe: { kind: 'boolean' } },
  },
  tavily: {
    label: 'Tavily', endpoint: 'https://api.tavily.com/search', credentialRef: 'TAVILY_API_KEY',
    keyless: true, account: false, freshness: [], homepage: 'https://www.tavily.com',
    options: {
      search_depth: { kind: 'enum', values: ['basic', 'advanced', 'fast', 'ultra-fast'] },
      topic: { kind: 'enum', values: ['general', 'news', 'finance'] },
    },
  },
  tinyfish: {
    label: 'Tinyfish', endpoint: 'https://api.search.tinyfish.ai', credentialRef: 'TINYFISH_API_KEY',
    keyless: true, account: false, freshness: [], homepage: 'https://www.tinyfish.ai',
    options: {
      location: { kind: 'text', pattern: /^[A-Za-z]{2}$/u },
      language: { kind: 'text', pattern: /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/u },
      purpose: { kind: 'text', pattern: /^[^\x00-\x1f]{1,2000}$/u },
      domain_type: { kind: 'enum', values: ['web', 'news', 'research_paper'], keyless: ['web', 'news'] },
    },
  },
  deepseek: {
    label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1/tools/search', credentialRef: 'DEEPSEEK_API_KEY',
    keyless: false, account: true, freshness: [], homepage: 'https://platform.deepseek.com',
    options: {},
  },
  openalex: {
    label: 'OpenAlex', endpoint: 'https://api.openalex.org/works', credentialRef: 'OPENALEX_API_KEY',
    keyless: true, account: false, freshness: [], homepage: 'https://openalex.org',
    options: {
      sort: { kind: 'text', pattern: /^[a-z_]+:(?:asc|desc)(?:,[a-z_]+:(?:asc|desc))*$/u },
      filter: { kind: 'text', pattern: /^[^\x00-\x1f]{1,500}$/u },
      is_oa: { kind: 'boolean' },
      mailto: { kind: 'text', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u },
    },
  },
  semanticscholar: {
    label: 'Semantic Scholar', endpoint: 'https://api.semanticscholar.org/graph/v1/paper/search', credentialRef: 'SEMANTIC_SCHOLAR_API_KEY',
    keyless: false, account: false, freshness: [], homepage: 'https://www.semanticscholar.org/product/api',
    options: {
      year: { kind: 'text', pattern: /^\d{4}(?:-\d{4})?$/u },
      fieldsOfStudy: { kind: 'text', pattern: /^[A-Za-z ,]{1,100}$/u },
      publicationTypes: { kind: 'text', pattern: /^[A-Za-z,]{1,100}$/u },
    },
  },
} as const satisfies Record<string, AdapterInfo>

export type AdapterId = keyof typeof ADAPTERS
export const ADAPTER_IDS = Object.keys(ADAPTERS) as AdapterId[]
/** Whether `fresh` / `realtime` take effect for an adapter on an access mode. */
export function honorsFreshness(adapter: AdapterId, access: 'keyless' | 'api-key'): boolean {
  const modes: readonly string[] = ADAPTERS[adapter].freshness
  return modes.includes(access)
}
export const isAdapterId = (value: unknown): value is AdapterId => typeof value === 'string' && Object.hasOwn(ADAPTERS, value)

/** Connection id of an adapter's built-in connection; persisted in session selections. */
export const builtinConnectionId = (adapter: AdapterId) => `builtin:${adapter}` as const
export const SESSION_MODEL_ID = 'builtin:session-model'
export const CUSTOM_CONNECTION_ID = /^custom:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u
export const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u
