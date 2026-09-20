import { describe, it, expect } from 'vitest'
import { resolveSettings, importLegacy } from '../src/config.ts'
import { ExecutionContexts } from '../src/dsh/execution-context.ts'
describe('V2 sparse catalog and request snapshots', () => {
  it('does not materialize presets, select a route or require keys', () => {
    const config = {}; const r = resolveSettings(config)
    expect(config).toEqual({}); expect(Object.keys(r.connections)).toHaveLength(5)
    expect(r.defaultConnection).toBeUndefined(); expect(r.freshness).toBe('auto')
  })
  it('preserves invalid default and isolated sparse overrides', () => {
    const r = resolveSettings({ defaultConnection: 'custom:deleted', freshness: 'realtime', connections: { 'builtin:exa': { label: 'Work' } } })
    expect(r.defaultConnection).toBe('custom:deleted'); expect(r.connections['builtin:exa']?.credentialRef).toBe('EXA_API_KEY')
    expect(resolveSettings().connections['builtin:exa']?.label).toBe('Exa')
  })
  it('rejects secret, endpoint and adapter overrides on builtins', () => {
    for (const override of [{ apiKey: 'not-a-key' }, { endpoint: 'https://other.test' }, { adapter: 'tavily' }, { options: { contents: {} } }]) expect(() => resolveSettings({ connections: { 'builtin:exa': override } })).toThrow()
  })
  it('requires custom endpoint trust and complete fixed credential binding', () => {
    const c = { kind: 'model', label: 'Fixed', binding: { mode: 'fixed', protocol: 'openai-responses', model: 'search', baseURL: 'https://gateway.test/v1', credentialRef: 'SEARCH_API' } }
    expect(() => resolveSettings({ connections: { 'custom:fixed': c } })).toThrow('trustedEndpoint')
    expect(resolveSettings({ connections: { 'custom:fixed': { ...c, trustedEndpoint: true } } }).connections['custom:fixed']?.binding).toEqual(c.binding)
  })
  it('imports routes without legacy cross-route fallback or literal secrets', () => {
    expect(importLegacy({ modelMode: 'current-session', fallbackModel: 'unsafe' })).toEqual({ version: 2, defaultConnection: 'builtin:session-model' })
    expect(JSON.stringify(importLegacy({ model: 'fixed', fallbackModel: 'unsafe' }))).not.toContain('unsafe')
    expect(() => importLegacy({ apiKey: 'not-a-key' })).toThrow('DSH Credentials')
  })
  it('freezes retries and samples the next step, independently per session', async () => {
    const contexts = new ExecutionContexts(), a = {}, b = {}
    const old = contexts.capture(a, 'a', 1, 1, { connectionId: 'builtin:exa', revision: 1 }, resolveSettings({ freshness: 'realtime' }))
    expect(contexts.capture(a, 'a', 1, 1, { connectionId: 'builtin:tavily', revision: 2 }, resolveSettings())).toBe(old)
    const other = contexts.capture(b, 'b', 1, 1, { connectionId: 'builtin:tavily', revision: 1 }, resolveSettings())
    await Promise.all([old, other].map(snapshot => contexts.run(snapshot, undefined, undefined, async () => { await Promise.resolve(); expect(contexts.current()?.snapshot).toBe(snapshot) })))
    expect(contexts.current()).toBeUndefined()
    expect(contexts.capture(a, 'a', 1, 2, { connectionId: 'builtin:tavily', revision: 2 }, resolveSettings()).selection.connectionId).toBe('builtin:tavily')
    expect(Object.isFrozen(old.connection?.options)).toBe(true)
  })
})
