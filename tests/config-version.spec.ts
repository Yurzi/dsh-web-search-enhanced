import { describe, expect, it } from 'vitest'
import { configVersion, CURRENT_CONFIG_VERSION } from '../src/config-version.ts'
import { importLegacy, migrateConfig, needsMigration } from '../src/migration.ts'
import { resolveSettings } from '../src/config.ts'

describe('configuration schema versions', () => {
  it('distinguishes historical formats and explicit versions', () => {
    expect(CURRENT_CONFIG_VERSION).toBe(2)
    expect(configVersion({})).toBe(2)
    expect(configVersion({ model: 'legacy' } as object)).toBe(1)
    expect(needsMigration({ version: 1 })).toBe(true)
    expect(needsMigration({ version: 2, model: 'ignored legacy overlay' })).toBe(false)
  })
  it.each([null, '2', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 3])('refuses invalid or future version %s without mutating input', version => {
    const input = { version, model: 'private-model' }
    expect(() => migrateConfig(input)).toThrow(/version/)
    expect(() => needsMigration(input)).toThrow(/version/)
    expect(() => resolveSettings(input as never)).toThrow(/version/)
    expect(input).toEqual({ version, model: 'private-model' })
  })
  it('migrates explicit V1, preserves preferences and is idempotent', () => {
    const input = { version: 1, model: 'search', freshness: 'fresh', defaultConnection: 'builtin:exa', connections: { 'builtin:tavily': { disabled: true } } }
    const original = structuredClone(input)
    const migrated = migrateConfig(input)
    expect(migrated).toMatchObject({ version: 2, freshness: 'fresh', defaultConnection: 'builtin:exa', connections: { 'builtin:tavily': { disabled: true }, 'custom:legacy': { binding: { model: 'search' } } } })
    expect(migrated).not.toHaveProperty('model')
    expect(migrateConfig(migrated)).toEqual(migrated)
    expect(input).toEqual(original)
  })
  it('preserves connections and preferences in session-follow migration', () => {
    const input = { modelMode: 'current-session', freshness: 'realtime', connections: { 'builtin:exa': { disabled: true } } }
    expect(migrateConfig(input)).toEqual({ version: 2, freshness: 'realtime', connections: input.connections, defaultConnection: 'builtin:session-model' })
  })
  it('does not materialize or mutate unversioned V2 settings', () => {
    const input = { connections: { 'builtin:exa': { label: 'Work' } } }
    const result = migrateConfig(input)
    expect(result).toEqual(input)
    expect(result.connections).not.toBe(input.connections)
    expect(migrateConfig({})).toEqual({})
  })
  it('validates before returning and never silently discards malformed connections', () => {
    expect(() => migrateConfig({ version: 1, maxTokens: -1 })).toThrow()
    expect(() => migrateConfig({ version: 1, connections: [] })).toThrow('connections')
    expect(() => migrateConfig({ version: 1, apiKey: 'fixture-key' })).toThrow('Credentials')
    expect(() => importLegacy({ version: 3, model: 'search' })).toThrow('version')
    expect(() => importLegacy({ version: 2 })).toThrow('version 1')
  })
})
