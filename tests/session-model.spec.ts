import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import {
  captureFollowSettings, FollowModelError, FollowRequest, resolveFollowBinding, sessionModelSelection,
  type ModelSelection, type SessionModelAgent,
} from '../src/dsh/session-model.ts'

type Profile = Record<string, unknown>
const selection = { provider: 'chat', model: 'model-a' }
const explicit = (extra: Profile = {}): Profile => ({
  api: 'openai-responses', baseURL: 'https://chat.example.test/v1', apiKeyEnv: 'CHAT_TEST_KEY', ...extra,
})
function host(providers: Record<string, unknown> = { chat: explicit() }, adapter: unknown = {}) {
  const registrations = new Map(Object.keys(providers).map(name => [name, adapter]))
  const forms: Array<{ ns: string; value: unknown }> = [{ ns: 'custom-pi-instance', value: { providers } }]
  const directory = Object.keys(providers).map(provider => ({ provider, settingsNs: 'custom-pi-instance', settingsPath: ['providers', provider] }))
  const settingsDescribe = vi.fn(() => forms)
  const listConfigurableProviders = vi.fn(() => directory)
  const listProviders = vi.fn(() => [...registrations.keys()].map(id => ({ id, name: id })))
  const registration = vi.fn((provider: string) => {
    if (!registrations.has(provider)) throw new Error('not registered')
    return { adapter: registrations.get(provider) }
  })
  const get = vi.fn((name: string) => {
    if (name === 'settings') return { describe: settingsDescribe }
    if (name === 'llm') return { registration, listConfigurableProviders, listProviders }
    throw new Error('unexpected service access: ' + name)
  })
  return { ctx: { get } as unknown as Context, providers, registrations, settingsDescribe, listConfigurableProviders, forms, directory, registration, get }
}
function agent(header: { config?: ModelSelection } | undefined = { config: selection }, options: ModelSelection = { provider: 'other', model: 'option-model' }): SessionModelAgent {
  return { options, session: { requestHeader: vi.fn(() => header) } }
}
function binding(profile: Profile, model = selection.model) {
  return resolveFollowBinding(captureFollowSettings(host({ chat: profile }).ctx).settings, { ...selection, model })
}
function unsupported(fn: () => unknown) {
  expect(fn).toThrow(FollowModelError)
  expect(fn).toThrow(expect.objectContaining({ code: 'WEB_SEARCH_FOLLOW_UNSUPPORTED' }))
}
function catalog(models: unknown, provider = 'chat') {
  const getModels = vi.fn(() => models)
  const profiles = vi.fn(() => new Map([[provider, { piProvider: { getModels } }]]))
  return { adapter: { config: { profiles } }, profiles, getModels }
}

describe('session model selection', () => {
  it('takes both committed header fields ahead of agent options', () => {
    const a = agent()
    expect(sessionModelSelection(a)).toEqual(selection)
    expect(a.session.requestHeader).toHaveBeenCalledOnce()
  })
  it.each([{}, { config: {} }, { config: { provider: 'chat' } }, { config: { model: 'model-a' } }])('never completes a partial header from options: %j', header => {
    unsupported(() => sessionModelSelection(agent(header, selection)))
  })
  it('uses options only before any request header exists', () => {
    const a: SessionModelAgent = { options: selection, session: { requestHeader: () => undefined } }
    expect(sessionModelSelection(a)).toEqual(selection)
  })
  it('rejects missing agent context', () => unsupported(() => sessionModelSelection()))
  it.each([{}, { provider: 'chat' }, { model: 'model-a' }])('rejects incomplete options without a header: %j', options => {
    const a: SessionModelAgent = { options, session: { requestHeader: () => undefined } }
    unsupported(() => sessionModelSelection(a))
  })
})

describe('settings-first follow bindings', () => {
  it('reads a renamed entry through the public target directory with the private identity shim', async () => {
    const ctx = new Context()
    try {
      new LlmRuntime(ctx)
      class FixtureAdapter extends LlmAdapter {
        async *stream(): AsyncIterable<never> { throw new Error('Search must not invoke chat') }
      }
      ctx.llm.registerAdapter(['chat'], new FixtureAdapter())
      ctx.llm.registerConfigurableProviders([{ provider: 'chat', displayName: 'Chat', settingsNs: 'custom-instance', settingsPath: ['nested', 'route'] }])
      ctx.provide('settings', { describe: () => [{ ns: 'custom-instance', value: { nested: { route: explicit() } } }] } as never)
      const request = new FollowRequest(captureFollowSettings(ctx))
      expect(request.resolve(agent())).toMatchObject({ model: 'model-a', credentialRef: 'CHAT_TEST_KEY' })
    } finally { await ctx.fiber.dispose() }
  })
  it.each([
    ['anthropic-messages', 'anthropic-messages'],
    ['openai-responses', 'openai-responses'],
    ['openai-completions', 'openai-chat-completions'],
    ['openai-chat-completions', 'openai-chat-completions'],
  ])('maps explicit %s without an adapter catalog', (api, protocol) => {
    expect(binding(explicit({ api }))).toEqual({ mode: 'fixed', protocol, model: 'model-a', baseURL: 'https://chat.example.test/v1', credentialRef: 'CHAT_TEST_KEY' })
  })
  it('does not inspect private adapter shape when settings are explicit', () => {
    const adapter = { get config(): never { throw new Error('must not read catalog') } }
    const h = host(undefined, adapter)
    const captured = captureFollowSettings(h.ctx)
    expect(resolveFollowBinding(captured.settings, selection).model).toBe('model-a')
    expect(h.settingsDescribe).toHaveBeenCalledOnce()
    expect(h.listConfigurableProviders).toHaveBeenCalledOnce()
    expect(h.get.mock.calls.map(([name]) => name).sort()).toEqual(['llm', 'settings'])
  })
  it('uses the directory entry namespace and exact nested path, including a root profile', () => {
    const h = host({ chat: explicit(), other: explicit() })
    h.forms.splice(0, h.forms.length,
      { ns: 'nested-instance', value: { routes: { primary: explicit({ apiKeyEnv: 'NESTED_KEY' }) } } },
      { ns: 'root-instance', value: explicit({ baseURL: 'https://root.example.test', apiKeyEnv: 'ROOT_KEY' }) },
      { ns: 'llm-pi-ai', value: { providers: { chat: explicit({ apiKeyEnv: 'WRONG_KEY' }) } } },
    )
    h.directory[0]!.settingsNs = 'nested-instance'
    h.directory[0]!.settingsPath = ['routes', 'primary']
    h.directory[1]!.settingsNs = 'root-instance'
    h.directory[1]!.settingsPath = []
    const captured = captureFollowSettings(h.ctx)
    expect(resolveFollowBinding(captured.settings, selection).credentialRef).toBe('NESTED_KEY')
    expect(resolveFollowBinding(captured.settings, { provider: 'other', model: 'model-a' })).toMatchObject({ baseURL: 'https://root.example.test', credentialRef: 'ROOT_KEY' })
  })
  it.each(['namespace', 'path', 'directory'] as const)('fails closed on a missing directory %s without guessing the old namespace', missing => {
    const h = host()
    if (missing === 'namespace') h.directory[0]!.settingsNs = 'absent'
    if (missing === 'path') h.directory[0]!.settingsPath = ['providers', 'absent']
    if (missing === 'directory') h.directory.length = 0
    unsupported(() => resolveFollowBinding(captureFollowSettings(h.ctx).settings, selection))
  })
  it('does not read inherited object properties as a provider profile', () => {
    const h = host()
    h.forms[0]!.value = { providers: Object.create({ chat: explicit() }) }
    unsupported(() => resolveFollowBinding(captureFollowSettings(h.ctx).settings, selection))
  })
  it('fails for missing settings or selected provider rather than using another provider', () => {
    const empty = { get: () => undefined } as unknown as Context
    unsupported(() => resolveFollowBinding(captureFollowSettings(empty).settings, selection))
    const captured = captureFollowSettings(host({ other: explicit() }).ctx)
    unsupported(() => resolveFollowBinding(captured.settings, selection))
  })
  it.each(['api', 'baseURL', 'apiKeyEnv'])('does not borrow missing %s from a valid other provider', field => {
    const profile = explicit(); delete profile[field]
    const h = host({ chat: profile, other: explicit() })
    unsupported(() => resolveFollowBinding(captureFollowSettings(h.ctx).settings, selection))
  })
  it.each([
    { api: 'unknown-api' }, { api: '' }, { baseURL: '' }, { apiKeyEnv: '' },
    { baseURL: 'not a URL' }, { baseURL: 'ftp://example.test' },
    { baseURL: 'https://user:password@example.test' }, { baseURL: 'https://example.test?key=fake' },
    { apiKeyEnv: 'not-a-reference' },
  ])('fails closed on invalid routing facts: %j', extra => unsupported(() => binding(explicit(extra))))
  it('rejects a provider missing from the host registration directory', () => {
    const h = host(); h.registrations.delete('chat')
    unsupported(() => resolveFollowBinding(captureFollowSettings(h.ctx).settings, selection))
  })
  it.each([undefined, null, {}, { adapter: null }])('refuses an unavailable private identity shape: %j', entry => {
    const h = host()
    h.registration.mockReturnValue(entry as never)
    unsupported(() => resolveFollowBinding(captureFollowSettings(h.ctx).settings, selection))
  })
  it('honors explicit model allowlists while permitting metadata-only model overrides', () => {
    const profile = explicit({ models: [{ id: 'model-a', name: 'Allowed' }], modelOverrides: { 'model-a': { contextWindow: 1000 } } })
    expect(binding(profile).model).toBe('model-a')
    unsupported(() => binding(profile, 'model-b'))
    unsupported(() => binding(explicit({ models: [] })))
    unsupported(() => binding(explicit({ models: 'model-a' })))
  })
  it.each(['api', 'baseURL', 'apiKeyEnv', 'apiKey', 'headers'])('refuses unsupported model-level %s in entries and overrides', field => {
    for (const extra of [
      { models: [{ id: 'model-a', [field]: 'fake-value' }] },
      { modelOverrides: { 'model-a': { [field]: 'fake-value' } } },
    ]) unsupported(() => binding(explicit(extra)))
  })
})

describe('optional pi-ai catalog completion', () => {
  it.each([
    { apiKeyEnv: 'CHAT_TEST_KEY' },
    { apiKeyEnv: 'CHAT_TEST_KEY', api: 'anthropic-messages' },
    { apiKeyEnv: 'CHAT_TEST_KEY', baseURL: 'https://explicit.example.test' },
  ])('completes only omitted fields from model api/baseUrl: %j', profile => {
    const c = catalog([{ id: 'model-a', api: 'openai-responses', baseUrl: 'https://catalog.example.test/v1' }])
    const settings = captureFollowSettings(host({ chat: profile }, c.adapter).ctx).settings
    expect(resolveFollowBinding(settings, selection)).toEqual({ mode: 'fixed', model: 'model-a', protocol: profile.api ?? 'openai-responses', baseURL: profile.baseURL ?? 'https://catalog.example.test/v1', credentialRef: 'CHAT_TEST_KEY' })
    expect(c.profiles).toHaveBeenCalledOnce()
    expect(c.getModels).toHaveBeenCalledOnce()
  })
  it('never replaces explicit unknown APIs or supplies catalog credentials', () => {
    const c = catalog([{ id: 'model-a', api: 'openai-responses', baseUrl: 'https://catalog.example.test', apiKeyEnv: 'CATALOG_KEY' }])
    for (const profile of [{ api: 'unknown', apiKeyEnv: 'CHAT_TEST_KEY' }, { api: 'openai-responses' }]) {
      const settings = captureFollowSettings(host({ chat: profile }, c.adapter).ctx).settings
      unsupported(() => resolveFollowBinding(settings, selection))
    }
  })
  it.each([
    {}, { config: {} }, { config: { profiles: () => ({}) } },
    { config: { profiles: () => new Map() } },
    { config: { profiles: () => { throw new Error('shape changed') } } },
  ])('fails closed when catalog completion is unavailable', adapter => {
    const settings = captureFollowSettings(host({ chat: { apiKeyEnv: 'CHAT_TEST_KEY' } }, adapter).ctx).settings
    unsupported(() => resolveFollowBinding(settings, selection))
  })
  it('does not use another provider or model catalog entry', () => {
    for (const c of [catalog([{ id: 'other-model', api: 'openai-responses', baseUrl: 'https://catalog.example.test' }]), catalog([{ id: 'model-a', api: 'openai-responses', baseUrl: 'https://catalog.example.test' }], 'other')]) {
      const settings = captureFollowSettings(host({ chat: { apiKeyEnv: 'CHAT_TEST_KEY' } }, c.adapter).ctx).settings
      unsupported(() => resolveFollowBinding(settings, selection))
    }
  })
})

describe('request snapshot and binding cache', () => {
  it('keeps captured settings and model allowlist while next request captures mutations', () => {
    const models = [{ id: 'model-a' }]
    const profile = explicit({ models }), h = host({ chat: profile })
    const old = captureFollowSettings(h.ctx)
    profile.api = 'anthropic-messages'; profile.baseURL = 'https://new.example.test'; profile.apiKeyEnv = 'NEW_TEST_KEY'
    models[0]!.id = 'model-b'
    expect(resolveFollowBinding(old.settings, selection)).toEqual({ mode: 'fixed', model: 'model-a', protocol: 'openai-responses', baseURL: 'https://chat.example.test/v1', credentialRef: 'CHAT_TEST_KEY' })
    const next = captureFollowSettings(h.ctx)
    unsupported(() => resolveFollowBinding(next.settings, selection))
    expect(resolveFollowBinding(next.settings, { ...selection, model: 'model-b' })).toEqual({ mode: 'fixed', model: 'model-b', protocol: 'anthropic-messages', baseURL: 'https://new.example.test', credentialRef: 'NEW_TEST_KEY' })
    expect(Object.isFrozen(old.settings.providers.chat!.models)).toBe(true)
  })
  it('copies catalog facts rather than retaining mutable model records', () => {
    const model = { id: 'model-a', api: 'openai-responses', baseUrl: 'https://old.example.test' }
    const c = catalog([model]), h = host({ chat: { apiKeyEnv: 'CHAT_TEST_KEY' } }, c.adapter)
    const old = captureFollowSettings(h.ctx)
    model.api = 'anthropic-messages'; model.baseUrl = 'https://new.example.test'
    expect(resolveFollowBinding(old.settings, selection).baseURL).toBe('https://old.example.test')
    expect(resolveFollowBinding(captureFollowSettings(h.ctx).settings, selection).protocol).toBe('anthropic-messages')
  })
  it('caches each provider/model pair but rereads changed headers in the same request', () => {
    const h = host({ chat: explicit(), other: explicit({ baseURL: 'https://other.example.test', apiKeyEnv: 'OTHER_TEST_KEY' }) })
    const request = new FollowRequest(captureFollowSettings(h.ctx))
    let current = selection
    const a = { session: { requestHeader: vi.fn(() => ({ config: current })) } }
    const first = request.resolve(a)
    expect(request.resolve(a)).toBe(first)
    h.providers.other = explicit({ baseURL: 'https://changed.example.test' })
    current = { provider: 'other', model: 'model-a' }
    const other = request.resolve(a)
    expect(other).not.toBe(first)
    expect(other.baseURL).toBe('https://other.example.test')
    expect(other.credentialRef).toBe('OTHER_TEST_KEY')
    current = { provider: 'chat', model: 'model-b' }
    expect(request.resolve(a)).toMatchObject({ model: 'model-b', baseURL: first.baseURL })
    current = selection
    expect(request.resolve(a)).toBe(first)
    expect(h.settingsDescribe).toHaveBeenCalledOnce()
    expect(Object.isFrozen(first)).toBe(true)
  })
  it.each(['replace', 'remove'])('rejects adapter %s even after binding was cached', change => {
    const h = host(), request = new FollowRequest(captureFollowSettings(h.ctx)), a = agent()
    request.resolve(a)
    if (change === 'replace') h.registrations.set('chat', {})
    else h.registrations.delete('chat')
    unsupported(() => request.resolve(a))
  })
})

describe('follow credential and header boundaries', () => {
  it.each([
    { apiKey: 'FAKE_RAW_SECRET' }, { auth: { accessToken: 'FAKE_OAUTH_SECRET' } },
    { oauth: { accessToken: 'FAKE_OAUTH_SECRET' } }, { headers: { Authorization: 'FAKE_HEADER_SECRET' } },
  ])('refuses unsupported authentication without retaining its contents: %j', extra => {
    const captured = captureFollowSettings(host({ chat: explicit(extra) }).ctx)
    unsupported(() => resolveFollowBinding(captured.settings, selection))
    const serialized = JSON.stringify(captured.settings)
    expect(serialized).not.toMatch(/FAKE_|accessToken|Authorization/)
    expect(structuredClone(captured.settings)).toEqual(captured.settings)
  })
  it('retains only public route facts from catalog and never resolves credentials', () => {
    const c = catalog([{ id: 'model-a', api: 'openai-responses', baseUrl: 'https://catalog.example.test', headers: { Authorization: 'FAKE_HEADER_SECRET' }, apiKey: 'FAKE_RAW_SECRET', oauth: { accessToken: 'FAKE_OAUTH_SECRET' } }])
    const h = host({ chat: { apiKeyEnv: 'CHAT_TEST_KEY', unrelated: { secret: 'FAKE_OTHER_SECRET' } } }, c.adapter)
    const captured = captureFollowSettings(h.ctx)
    expect(captured.settings.providers.chat!.catalog['model-a']).toEqual({ api: 'openai-responses', baseURL: 'https://catalog.example.test' })
    expect(JSON.stringify(captured.settings)).not.toMatch(/FAKE_|Authorization|accessToken/)
    expect(resolveFollowBinding(captured.settings, selection).credentialRef).toBe('CHAT_TEST_KEY')
    expect(h.get.mock.calls.map(([name]) => name).sort()).toEqual(['llm', 'settings'])
  })
})
