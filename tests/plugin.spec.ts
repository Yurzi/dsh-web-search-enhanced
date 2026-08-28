import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_PROVIDER_ID, inject, name, resolveConfig } from '../src/index.ts'

describe('host plugin contract', () => {
  it('exports the Cordis provider shape', () => {
    expect(name).toBe('web-search-enhanced')
    expect(inject).toEqual(['web'])
    expect(Config).toBeDefined()
  })

  it('resolves protocol-specific internal identifiers', () => {
    expect(resolveConfig({}).providerId).toBe(DEFAULT_PROVIDER_ID)
    expect(resolveConfig({ protocol: 'anthropic-messages' }).toolIdentifier).toBe('web_search_20250305')
    expect(resolveConfig({ protocol: 'openai-responses' }).toolIdentifier).toBe('web_search')
    expect(resolveConfig({ protocol: 'openai-chat-completions' }).toolIdentifier).toBe('web_search_options')
    expect(resolveConfig({ protocol: 'openai-responses', toolIdentifier: 'web_search_preview', maxTokens: 9000 }))
      .toMatchObject({ toolIdentifier: 'web_search_preview', maxTokens: 9000 })
  })

  it('rejects invalid live-request settings before registration', () => {
    expect(() => resolveConfig({ baseURL: 'not-a-url' })).toThrow('baseURL')
    expect(() => resolveConfig({ maxTokens: 0 })).toThrow('maxTokens')
    expect(() => resolveConfig({ toolIdentifier: '__proto__' })).toThrow('toolIdentifier')
  })
})
