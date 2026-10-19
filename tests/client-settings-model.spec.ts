import { describe, expect, it } from 'vitest'
import { documentVersion, resetSettingsOperations, sparseSettingOperations } from '../src/client/settings/sparse.ts'
import { asksTrust, buildConnection, emptyForm, formOf, needsTrust, suggestCredentialRef, type ConnectionForm } from '../src/client/settings/connection-form.ts'
import { adapterFields, applyFields, isValidText, modelFields } from '../src/client/settings/model.ts'

describe('sparse settings operations', () => {
  it('never writes catalog defaults or a version-only document', () => {
    expect(sparseSettingOperations({}, ['freshness'], 'auto', 'auto')).toEqual([])
    expect(sparseSettingOperations({}, ['showSelector'], true, true)).toEqual([])
    expect(sparseSettingOperations({}, ['defaultConnection'], undefined)).toEqual([])
    expect(resetSettingsOperations({})).toEqual([])
  })

  it('sets a difference once, stamping the schema version on the first write', () => {
    expect(sparseSettingOperations({}, ['freshness'], 'realtime', 'auto')).toEqual([
      { op: 'set', path: ['freshness'], value: 'realtime' }, { op: 'set', path: ['version'], value: 2 },
    ])
    expect(sparseSettingOperations({ user: { version: 2 } }, ['showSelector'], false, true)).toEqual([{ op: 'set', path: ['showSelector'], value: false }])
  })

  it('unsets a user value that returns to the inherited one, and keeps overrides of the composition layer', () => {
    expect(sparseSettingOperations({ user: { version: 2, showSelector: false } }, ['showSelector'], true, true)).toEqual([{ op: 'unset', path: ['showSelector'] }])
    const layers = { base: { freshness: 'fresh' }, user: { version: 2, freshness: 'fresh' } }
    expect(sparseSettingOperations(layers, ['freshness'], 'fresh', 'auto')).toEqual([{ op: 'unset', path: ['freshness'] }])
    expect(sparseSettingOperations(layers, ['freshness'], 'auto', 'auto')).toEqual([{ op: 'set', path: ['freshness'], value: 'auto' }])
  })

  it('removes the overrides a reverted value leaves empty, but not their siblings', () => {
    const user = { version: 2, connections: { 'builtin:tavily': { disabled: true }, 'builtin:exa': { access: 'api-key', disabled: true } } }
    expect(sparseSettingOperations({ user }, ['connections', 'builtin:tavily', 'disabled'], false, false)).toEqual([{ op: 'unset', path: ['connections', 'builtin:tavily'] }])
    expect(sparseSettingOperations({ user }, ['connections', 'builtin:exa', 'disabled'], false, false)).toEqual([{ op: 'unset', path: ['connections', 'builtin:exa', 'disabled'] }])
    const only = { version: 2, connections: { 'builtin:tavily': { disabled: true } } }
    expect(sparseSettingOperations({ user: only }, ['connections', 'builtin:tavily', 'disabled'], false, false)).toEqual([{ op: 'unset', path: ['connections'] }])
  })

  it('stores only the changed fields of an object against the inherited object', () => {
    const base = { version: 2, connections: { 'custom:one': { label: 'One', binding: { model: 'old', protocol: 'openai-responses' } } } }
    expect(sparseSettingOperations({ base }, ['connections', 'custom:one'], { label: 'One', binding: { model: 'new', protocol: 'openai-responses' } })).toEqual([
      { op: 'set', path: ['connections', 'custom:one'], value: { binding: { model: 'new' } } },
    ])
    expect(sparseSettingOperations({ base: { options: { a: 1, b: 2 } } }, ['options'], { b: 2, a: 1 })).toEqual([])
  })

  it('reset unsets only fields this plugin stores', () => {
    expect(resetSettingsOperations({ base: { freshness: 'fresh' }, user: { version: 2, defaultConnection: 'builtin:exa', connections: {}, unrelated: true } })).toEqual([
      { op: 'unset', path: ['version'] }, { op: 'unset', path: ['defaultConnection'] }, { op: 'unset', path: ['connections'] },
    ])
  })

  it('refuses to edit unmigrated or newer documents', () => {
    expect(documentVersion({ user: { model: 'legacy-model' } })).toBe('legacy')
    expect(documentVersion({ user: { version: 3 } })).toBe('unsupported')
    for (const user of [{ model: 'legacy-model' }, { version: 3 }]) {
      expect(() => sparseSettingOperations({ user }, ['freshness'], 'fresh')).toThrow()
      expect(() => resetSettingsOperations({ user })).toThrow()
    }
  })
})

describe('custom connection form', () => {
  const service = (patch: Partial<ConnectionForm> = {}) => ({ ...emptyForm('structured'), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', ...patch }) as ConnectionForm
  const model = (patch: Partial<ConnectionForm> = {}) => ({
    ...emptyForm('model'), id: 'custom:team', label: 'Team', model: 'search-1', baseURL: 'https://gateway.example/v1', credentialRef: 'TEAM_KEY', ...patch,
  }) as ConnectionForm

  it('saves a service on its official endpoint without trust', () => {
    expect(needsTrust(service())).toBe(false)
    expect(buildConnection(service({ label: '  Work  ' }), false, [])).toEqual({
      ok: true, id: 'custom:work', connection: { kind: 'structured', label: 'Work', adapter: 'exa', credentialRef: 'WORK_KEY' },
    })
  })

  it('suggests a credential reference from the id and asks for trust once there is an address', () => {
    expect(suggestCredentialRef('custom:work-search.v2')).toBe('CUSTOM_WORK_SEARCH_V2_API_KEY')
    expect(suggestCredentialRef('custom:')).toBe('')
    expect(asksTrust(model({ baseURL: '' }))).toBe(false)
    expect(asksTrust(model())).toBe(true)
  })

  it('requires explicit trust for another endpoint and for every model connection', () => {
    const custom = service({ endpoint: 'https://proxy.example/search' })
    expect(buildConnection(custom, false, [])).toEqual({ ok: false, error: 'trust' })
    expect(buildConnection(custom, true, [])).toMatchObject({ ok: true, connection: { endpoint: 'https://proxy.example/search', trustedEndpoint: true } })
    expect(buildConnection(model(), false, [])).toEqual({ ok: false, error: 'trust' })
    expect(buildConnection(model({ options: { maxTokens: '2048', searchContextSize: 'high' } }), true, [])).toEqual({
      ok: true, id: 'custom:team',
      connection: {
        kind: 'model', label: 'Team', trustedEndpoint: true, options: { maxTokens: 2048, searchContextSize: 'high' },
        binding: { mode: 'fixed', protocol: 'openai-responses', model: 'search-1', baseURL: 'https://gateway.example/v1', credentialRef: 'TEAM_KEY' },
      },
    })
  })

  it('reports the first invalid field by code', () => {
    expect(buildConnection(service({ id: 'builtin:exa' }), true, [])).toEqual({ ok: false, error: 'id' })
    expect(buildConnection(service(), true, ['custom:work'])).toEqual({ ok: false, error: 'duplicate' })
    expect(buildConnection(service({ label: ' ' }), true, [])).toEqual({ ok: false, error: 'label' })
    expect(buildConnection(service({ credentialRef: '' }), true, [])).toEqual({ ok: false, error: 'credentialRef' })
    expect(buildConnection(service({ credentialRef: '1KEY' }), true, [])).toEqual({ ok: false, error: 'credentialRef' })
    expect(buildConnection(service({ endpoint: 'ftp://x' }), true, [])).toEqual({ ok: false, error: 'endpoint' })
    expect(buildConnection(service({ options: { type: 'slow' } }), true, [])).toEqual({ ok: false, error: 'options' })
    expect(buildConnection(model({ baseURL: 'gateway' }), true, [])).toEqual({ ok: false, error: 'baseURL' })
  })

  it('edits keep the switch state and round-trip the stored fields', () => {
    const stored = { kind: 'structured', label: 'Work', adapter: 'firecrawl', credentialRef: 'FC', disabled: true, options: { country: 'us' } } as const
    const result = buildConnection(formOf('custom:work', stored), false, [], stored)
    expect(result).toEqual({ ok: true, id: 'custom:work', connection: stored })
  })
})

describe('option fields', () => {
  it('drops or narrows options the keyless route rejects', () => {
    expect(adapterFields('exa', 'keyless')).toEqual({ fields: [], restricted: true })
    expect(adapterFields('exa', 'api-key').fields.map(field => field.name)).toEqual(['type'])
    expect(adapterFields('tinyfish', 'keyless').fields.find(field => field.name === 'domain_type')?.values).toEqual(['web', 'news'])
  })

  it('offers the model options of each protocol', () => {
    expect(modelFields('anthropic-messages').map(field => field.name)).toEqual(['maxTokens', 'maxUses', 'apiVersion', 'toolIdentifier'])
    expect(modelFields('openai-chat-completions').map(field => field.name)).toEqual(['maxTokens', 'searchContextSize', 'chatSearchMode', 'toolIdentifier'])
  })

  it('validates text against the rules and stores typed values', () => {
    const [country, , safe] = adapterFields('firecrawl', 'api-key').fields
    expect(isValidText(country!, 'us')).toBe(true)
    expect(isValidText(country!, 'usa')).toBe(false)
    const [maxTokens] = modelFields('openai-responses')
    expect(isValidText(maxTokens!, '0')).toBe(false)
    expect(applyFields([country!, safe!, maxTokens!], { country: '', safe: 'false', maxTokens: '512' }, { country: 'us', other: 1 })).toEqual({ safe: false, maxTokens: 512, other: 1 })
  })
})