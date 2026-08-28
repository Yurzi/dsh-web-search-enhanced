import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { Config, DEFAULT_API_KEY_ENV, DEFAULT_PROVIDER_ID, inject, name, resolveConfig, resolveRuntimeConfig } from '../src/index.ts'

describe('host plugin contract', () => {
  it('exports the Cordis provider shape', () => {
    expect(name).toBe('web-search-enhanced')
    expect(inject).toEqual(['web'])
    expect(Config).toBeDefined()
  })

  it('uses the plugin-owned credential reference and fallback model', () => {
    expect(resolveConfig({}).apiKeyEnv).toBe(DEFAULT_API_KEY_ENV)
    expect(resolveConfig({ model: 'primary', fallbackModel: 'fallback' })).toMatchObject({
      modelMode: 'configured', model: 'primary', fallbackModel: 'fallback',
    })
  })

  it('resolves protocol-specific internal identifiers', () => {
    expect(resolveConfig({}).providerId).toBe(DEFAULT_PROVIDER_ID)
    expect(resolveConfig({ protocol: 'anthropic-messages' }).toolIdentifier).toBe('web_search_20250305')
    expect(resolveConfig({ protocol: 'openai-responses' }).toolIdentifier).toBe('web_search')
    expect(resolveConfig({ protocol: 'openai-chat-completions' }).toolIdentifier).toBe('web_search_options')
    expect(resolveConfig({ protocol: 'openai-responses', toolIdentifier: 'web_search_preview', maxTokens: 9000 }))
      .toMatchObject({ toolIdentifier: 'web_search_preview', maxTokens: 9000 })
  })

  it('follows the active route protocol and model', async () => {
    const services = {
      agents: { currentInitiator: () => ({ options: { provider: 'route', model: 'session-model' } }) },
      settings: { get: vi.fn(() => ({ providers: { route: { api: 'openai-completions', baseURL: 'https://route.example/v1', apiKeyEnv: 'ROUTE_API' } } })) },
      llm: { resolveModelInfo: vi.fn(async () => ({ api: 'openai-completions' })) },
    }
    const ctx = { get: (key: string) => services[key as keyof typeof services] } as unknown as Context
    await expect(resolveRuntimeConfig(ctx, { modelMode: 'current-session', protocol: 'anthropic-messages', model: 'fallback-primary', fallbackModel: 'fallback-search' }))
      .resolves.toMatchObject({ model: 'session-model', protocol: 'openai-chat-completions', baseURL: 'https://route.example/v1', apiKeyEnv: 'ROUTE_API', maxTokens: 4096 })
  })

  it('uses fallback model when the active route protocol is unavailable', async () => {
    const services = {
      agents: { currentInitiator: () => ({ options: { provider: 'route', model: 'session-model' } }) },
      settings: { get: () => ({ providers: { route: { api: 'unknown-api', baseURL: 'https://route.example/v1' } } }) },
      llm: { resolveModelInfo: async () => ({ api: 'unknown-api' }) },
    }
    const ctx = { get: (key: string) => services[key as keyof typeof services] } as unknown as Context
    await expect(resolveRuntimeConfig(ctx, { modelMode: 'current-session', model: 'primary', fallbackModel: 'fallback' }))
      .resolves.toMatchObject({ model: 'fallback', protocol: 'anthropic-messages' })
  })

  it('uses fallback model when no active session route exists', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    await expect(resolveRuntimeConfig(ctx, { modelMode: 'current-session', model: 'primary', fallbackModel: 'fallback' }))
      .resolves.toMatchObject({ model: 'fallback', protocol: 'anthropic-messages' })
  })

  it('rejects invalid live-request settings before registration', () => {
    expect(() => resolveConfig({ baseURL: 'not-a-url' })).toThrow('baseURL')
    expect(() => resolveConfig({ maxTokens: 0 })).toThrow('maxTokens')
    expect(() => resolveConfig({ toolIdentifier: '__proto__' })).toThrow('toolIdentifier')
  })
})
