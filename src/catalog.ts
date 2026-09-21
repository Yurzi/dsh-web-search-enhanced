/** Public, secret-free connection metadata; safe to import in the client. */
export type StructuredAdapter = 'firecrawl' | 'exa' | 'tavily' | 'tinyfish'
export type Freshness = 'auto' | 'fresh' | 'realtime'
export const CATALOG = Object.freeze({
  'builtin:firecrawl': Object.freeze({ label: 'Firecrawl', adapter: 'firecrawl', endpoint: 'https://api.firecrawl.dev/v2/search', credentialRef: 'FIRECRAWL_API_KEY', keyless: true, freshness: true }),
  'builtin:exa': Object.freeze({ label: 'Exa', adapter: 'exa', endpoint: 'https://api.exa.ai/search', credentialRef: 'EXA_API_KEY', keyless: true, freshness: true }),
  'builtin:tavily': Object.freeze({ label: 'Tavily', adapter: 'tavily', endpoint: 'https://api.tavily.com/search', credentialRef: 'TAVILY_API_KEY', keyless: true, freshness: false }),
  'builtin:tinyfish': Object.freeze({ label: 'Tinyfish', adapter: 'tinyfish', endpoint: 'https://api.search.tinyfish.ai', credentialRef: 'TINYFISH_API_KEY', keyless: true, freshness: false }),
} as const)
export const SESSION_MODEL_ID = 'builtin:session-model'
export const SESSION_MODEL_LABEL = '跟随会话模型'
