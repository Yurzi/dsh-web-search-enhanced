import { describe, expect, it, vi } from 'vitest'
import { sparseSettingOperations, resetSettingsOperations, parseConnectionDraft, saveV2Credential } from '../src/client/V2Settings.tsx'
import { createResponseGuard, discoverableConnections } from '../src/client/SearchConnectionSelector.tsx'
import { SESSION_MODEL_ID } from '../src/catalog.ts'

describe('V2 sparse settings helpers', () => {
  it('does not write catalog, defaults or a version-only document', () => {
    expect(sparseSettingOperations({}, ['freshness'], 'auto', 'auto')).toEqual([])
    expect(sparseSettingOperations({}, ['defaultConnection'], undefined)).toEqual([])
    expect(resetSettingsOperations({})).toEqual([])
  })
  it('sets only a preference and initial version', () => {
    expect(sparseSettingOperations({}, ['freshness'], 'realtime', 'auto')).toEqual([
      { op: 'set', path: ['freshness'], value: 'realtime' }, { op: 'set', path: ['version'], value: 2 },
    ])
  })
  it('respects composition base and prunes redundant overrides', () => {
    const snapshot = { base: { freshness: 'fresh' }, user: { version: 2, freshness: 'fresh' } }
    expect(sparseSettingOperations(snapshot, ['freshness'], 'fresh', 'auto')).toEqual([{ op: 'unset', path: ['freshness'] }])
    expect(sparseSettingOperations(snapshot, ['freshness'], 'auto', 'auto')).toEqual([{ op: 'set', path: ['freshness'], value: 'auto' }])
  })
  it('updates one custom connection without materializing inherited fields or other connections', () => {
    const base = { version: 2, connections: { 'custom:one': { label: 'One', binding: { model: 'old', protocol: 'openai-responses' } } } }
    expect(sparseSettingOperations({ base }, ['connections', 'custom:one'], { label: 'One', binding: { model: 'new', protocol: 'openai-responses' } })).toEqual([
      { op: 'set', path: ['connections', 'custom:one'], value: { binding: { model: 'new' } } },
    ])
  })
  it('does not confuse distinct arrays and ignores object key ordering', () => {
    expect(sparseSettingOperations({ base: { version: 2, options: { domains: ['a'] } } }, ['options'], { domains: ['b'] })).toEqual([{ op: 'set', path: ['options'], value: { domains: ['b'] } }])
    expect(sparseSettingOperations({ base: { options: { a: 1, b: 2 } } }, ['options'], { b: 2, a: 1 })).toEqual([])
  })
  it('reset only unsets V2 user settings, never credentials or inherited values', () => {
    expect(resetSettingsOperations({ base: { freshness: 'fresh' }, user: { version: 2, defaultConnection: 'builtin:exa', connections: {}, unrelated: true } })).toEqual([
      { op: 'unset', path: ['version'] }, { op: 'unset', path: ['defaultConnection'] }, { op: 'unset', path: ['connections'] },
    ])
  })
})

describe('custom connection consent', () => {
  const config = { label: 'Research', kind: 'model', binding: { mode: 'fixed', protocol: 'openai-responses', model: 'search-model', baseURL: 'https://example.com/v1', credentialRef: 'SEARCH_KEY' } }
  it('requires a separate explicit consent even when JSON claims trust', () => {
    expect(() => parseConnectionDraft('custom:test', JSON.stringify({ ...config, trustedEndpoint: true }), false)).toThrow('确认')
    expect(parseConnectionDraft('custom:test', JSON.stringify(config), true)).toEqual({ ...config, trustedEndpoint: true })
  })
  it('rejects built-in IDs and nested plaintext credential fields', () => {
    expect(() => parseConnectionDraft('builtin:exa', JSON.stringify(config), true)).toThrow('custom:')
    expect(() => parseConnectionDraft('custom:test', JSON.stringify({ ...config, options: { apiKey: 'placeholder' } }), true)).toThrow('凭据服务')
    expect(() => parseConnectionDraft('custom:test', JSON.stringify({ ...config, options: [{ password: 'placeholder' }] }), true)).toThrow('凭据服务')
  })
  it('does not echo invalid JSON contents in errors', () => {
    expect(() => parseConnectionDraft('custom:test', 'invalid-private-content', true)).toThrow('JSON 格式无效')
    try { parseConnectionDraft('custom:test', 'invalid-private-content', true) } catch (error) { expect(String(error)).not.toContain('invalid-private-content') }
  })
})

describe('key-only writes', () => {
  it('only calls Credentials.set and never mutates settings or selects a connection', async () => {
    const remote = { describe: vi.fn(), set: vi.fn(async () => ({ ok: true as const, value: undefined })) }
    await saveV2Credential(remote, 'EXA_API_KEY', ' placeholder ')
    expect(remote.set).toHaveBeenCalledExactlyOnceWith('EXA_API_KEY', 'placeholder')
    expect(remote.describe).not.toHaveBeenCalled()
  })
  it('rejects blank values and hides exception contents', async () => {
    const remote = { describe: vi.fn(), set: vi.fn(async () => { throw new Error('private-value') }) }
    await expect(saveV2Credential(remote, 'EXA_API_KEY', ' ')).rejects.toThrow('非空')
    expect(remote.set).not.toHaveBeenCalled()
    await expect(saveV2Credential(remote, 'EXA_API_KEY', 'placeholder')).rejects.toThrow('凭据保存失败')
  })
})

describe('session response fencing', () => {
  it('rejects a delayed read after a newer confirmed write', async () => {
    const guard = createResponseGuard()
    let shown = 'old'
    let resolve!: (value: string) => void
    const delayed = new Promise<string>(r => { resolve = r })
    const readToken = guard.begin()
    const read = delayed.then(value => { if (guard.accepts(readToken)) shown = value })
    const writeToken = guard.begin()
    if (guard.accepts(writeToken)) shown = 'confirmed-new'
    resolve('stale-poll'); await read
    expect(shown).toBe('confirmed-new')
  })
  it('rejects old session reads and writes after effect cleanup', async () => {
    const old = createResponseGuard()
    const oldToken = old.begin()
    const next = createResponseGuard()
    const nextToken = next.begin()
    old.cancel()
    await Promise.resolve()
    expect(old.accepts(oldToken)).toBe(false)
    expect(old.accepts(old.begin())).toBe(false)
    expect(next.accepts(nextToken)).toBe(true)
  })
  it('keeps follow-model discoverable without inventing a usable binding', () => {
    const values = discoverableConnections([])
    expect(values).toHaveLength(1)
    expect(values[0]).toMatchObject({ id: SESSION_MODEL_ID, configured: false, kind: 'model' })
    expect(values[0]?.reason).toContain('绑定不可用')
  })
  it('preserves server reasons and sorts configured entries without mutating input', () => {
    const connections = [{ id: SESSION_MODEL_ID, label: '跟随会话模型', kind: 'model' as const, configured: false, reason: 'host unavailable' }, { id: 'builtin:exa', label: 'Exa', kind: 'structured' as const, configured: true }]
    expect(discoverableConnections(connections).map(c => c.id)).toEqual(['builtin:exa', SESSION_MODEL_ID])
    expect(connections[0]?.id).toBe(SESSION_MODEL_ID)
    expect(discoverableConnections(connections)[1]?.reason).toBe('host unavailable')
  })
})
