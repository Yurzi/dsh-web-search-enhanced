/** `builtin:session-model`: the search route derived from public LLM directory and settings facts. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, type LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { captureRoutes, followRoute, nextModel, requestModel } from '../src/host/follow-model.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

const MODEL = { provider: 'chat', model: 'model-a' }
const explicit = (extra: Record<string, unknown> = {}) => ({ api: 'openai-responses', baseURL: 'https://chat.test/v1', apiKeyEnv: 'CHAT_KEY', ...extra })

/** A host whose `chat` route lives at `settingsPath` of the `renamed-models` settings form. */
function host(profile: unknown, entry: Partial<LlmConfigurableProvider> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  new LlmRuntime(ctx)
  const directory = { provider: 'chat', displayName: 'Chat', settingsNs: 'renamed-models', settingsPath: ['routes', 'chat'], ...entry }
  ctx.llm.registerConfigurableProviders([directory])
  ctx.provide('settings', { describe: () => [{ ns: 'renamed-models', value: { routes: { chat: profile } } }] } as never)
  return ctx
}
const route = (profile: unknown, entry?: Partial<LlmConfigurableProvider>, model = MODEL) => followRoute(captureRoutes(host(profile, entry)), model)

describe('followRoute', () => {
  it.each([
    ['anthropic-messages', 'anthropic-messages'],
    ['openai-responses', 'openai-responses'],
    ['openai-completions', 'openai-chat-completions'],
  ])('maps api %s to the %s search protocol', (api, protocol) => {
    expect(route(explicit({ api }))).toEqual({ kind: 'route', route: { mode: 'fixed', protocol, model: 'model-a', baseURL: 'https://chat.test/v1', credentialRef: 'CHAT_KEY' } })
  })

  it('fills the endpoint and credential from the directory defaults', () => {
    const native = { defaultBaseURL: 'https://default.test', nativeAuth: { env: ['CHAT_ENV_KEY'], oauth: false } }
    expect(route({ api: 'anthropic-messages' }, native)).toMatchObject({ route: { baseURL: 'https://default.test', credentialRef: 'CHAT_ENV_KEY' } })
  })

  it("honors the model's own protocol and endpoint", () => {
    expect(route(explicit({ models: [{ id: 'model-a', api: 'anthropic-messages', baseURL: 'https://model.test' }] })))
      .toMatchObject({ route: { protocol: 'anthropic-messages', baseURL: 'https://model.test' } })
    expect(route(explicit({ modelOverrides: { 'model-a': { baseURL: 'https://override.test' } } }))).toMatchObject({ route: { baseURL: 'https://override.test' } })
  })

  it.each<[string, unknown, Partial<LlmConfigurableProvider>?]>([
    ['the protocol is unknown', explicit({ api: undefined })],
    ['the protocol has no server-side search', explicit({ api: 'google-generative-ai' })],
    ['the endpoint is missing', explicit({ baseURL: undefined })],
    ['the endpoint carries credentials', explicit({ baseURL: 'https://user:pw@chat.test' })],
    ['no credential reference is named', explicit({ apiKeyEnv: undefined })],
    ['the credential reference is invalid', explicit({ apiKeyEnv: 'not a ref' })],
    ['the route may use OAuth', explicit({ apiKeyEnv: undefined }), { nativeAuth: { env: ['CHAT_KEY'], oauth: true } }],
    ['several environment credentials apply', explicit({ apiKeyEnv: undefined }), { nativeAuth: { env: ['A_KEY', 'B_KEY'], oauth: false } }],
    ['the profile holds an inline key', explicit({ apiKey: 'FAKE_SECRET' })],
    ['the route sends custom headers', explicit({ headers: { authorization: 'FAKE_SECRET' } })],
  ])('is unsupported when %s', (_case, profile, entry) => {
    const result = route(profile, entry)
    expect(result).toMatchObject({ kind: 'unsupported', detail: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain('FAKE_SECRET')
  })

  it('is unsupported for a provider outside the directory or a session without a model', () => {
    expect(route(explicit(), {}, { provider: 'subscription', model: 'm' })).toMatchObject({ kind: 'unsupported', detail: expect.stringContaining('"subscription"') })
    expect(followRoute(captureRoutes(host(explicit())), undefined)).toMatchObject({ kind: 'unsupported' })
  })

  it('resolves against the captured facts, not the live profile', () => {
    const profile = explicit()
    const routes = captureRoutes(host(profile))
    Object.assign(profile, { baseURL: 'https://changed.test', apiKeyEnv: 'CHANGED_KEY' })
    expect(followRoute(routes, MODEL)).toMatchObject({ route: { baseURL: 'https://chat.test/v1', credentialRef: 'CHAT_KEY' } })
  })
})

describe('session models', () => {
  const agent = (header?: object, options?: object) => ({ options, session: { requestHeader: () => header } }) as unknown as Agent
  const projections = (pending: object | null) => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('sessionProjections', { stateOf: () => ({ pending, lastUsed: null }) } as never)
    return ctx
  }

  it('reads the next model from a pending switch, the last request, then the Agent route', () => {
    const committed = { config: { provider: 'last', model: 'm1' } }
    expect(nextModel(projections({ provider: 'next', model: 'm2' }), agent(committed))).toEqual({ provider: 'next', model: 'm2' })
    expect(nextModel(projections(null), agent(committed, { provider: 'option', model: 'm3' }))).toEqual({ provider: 'last', model: 'm1' })
    expect(nextModel(projections(null), agent(undefined, { provider: 'option', model: 'm3' }))).toEqual({ provider: 'option', model: 'm3' })
    expect(nextModel(projections(null), agent(undefined, { provider: 'option' }))).toBeUndefined()
  })

  it('searches with the model of the request in flight, never a pending switch', () => {
    expect(requestModel(agent({ config: { provider: 'last', model: 'm1' } }))).toEqual({ provider: 'last', model: 'm1' })
    expect(requestModel(agent(undefined, { provider: 'option', model: 'm3' }))).toBeUndefined()
  })
})