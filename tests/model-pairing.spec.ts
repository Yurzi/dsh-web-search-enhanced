import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractSessionModel,
  formatModelKey,
  ModelPairingStore,
  resolveDefaultCacheDir,
} from '../src/dsh/model-pairing-store.ts'
import type { Context } from '@deepseek-ai/cordis'
import { sessionModelSelection, type SessionModelAgent } from '../src/dsh/session-model.ts'

describe('ModelPairingStore', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pairing-store-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('resolves default cache dir using DSH_HOME or homedir', () => {
    const original = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = '/custom/dsh/home'
      expect(resolveDefaultCacheDir()).toBe('/custom/dsh/home/cache/web-search-enhanced')
      delete process.env.DSH_HOME
      expect(resolveDefaultCacheDir()).toContain('.dsh/cache/web-search-enhanced')
    } finally {
      if (original !== undefined) process.env.DSH_HOME = original
      else delete process.env.DSH_HOME
    }
  })

  it('formats model key with and without provider', () => {
    expect(formatModelKey('deepseek', 'deepseek-chat')).toBe('deepseek:deepseek-chat')
    expect(formatModelKey(undefined, 'gpt-4o')).toBe('gpt-4o')
    expect(formatModelKey('', 'claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
    expect(formatModelKey('provider', '')).toBeUndefined()
    expect(formatModelKey(undefined, undefined)).toBeUndefined()
  })

  it('returns undefined on empty or non-existent store', () => {
    const store = new ModelPairingStore({ cacheDir: tempDir })
    expect(store.get('deepseek', 'deepseek-chat')).toBeUndefined()
    expect(store.get(undefined, 'unknown')).toBeUndefined()
    expect(store.snapshot()).toEqual({})
  })

  it('sets, persists to file and reloads pairings across store instances', async () => {
    const store1 = new ModelPairingStore({ cacheDir: tempDir })
    await store1.set('deepseek', 'deepseek-chat', 'builtin:tavily')
    await store1.set('anthropic', 'claude-3-5-sonnet', 'builtin:exa')

    expect(store1.get('deepseek', 'deepseek-chat')).toBe('builtin:tavily')
    expect(store1.get('anthropic', 'claude-3-5-sonnet')).toBe('builtin:exa')
    expect(store1.get('unknown', 'model')).toBeUndefined()

    // Verify written file structure
    const raw = await readFile(join(tempDir, 'model-connections.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version: number; pairings: Record<string, string>; updatedAt?: string }
    expect(parsed.version).toBe(1)
    expect(parsed.updatedAt).toBeDefined()
    expect(parsed.pairings['deepseek:deepseek-chat']).toBe('builtin:tavily')
    expect(parsed.pairings['anthropic:claude-3-5-sonnet']).toBe('builtin:exa')

    // Reload in a fresh instance
    const store2 = new ModelPairingStore({ cacheDir: tempDir })
    expect(store2.get('deepseek', 'deepseek-chat')).toBe('builtin:tavily')
    expect(store2.get('anthropic', 'claude-3-5-sonnet')).toBe('builtin:exa')
    expect(store2.snapshot()).toEqual({
      'deepseek:deepseek-chat': 'builtin:tavily',
      'anthropic:claude-3-5-sonnet': 'builtin:exa',
    })
  })

  it('supports explicit null pairing for disabling search', async () => {
    const store = new ModelPairingStore({ cacheDir: tempDir })
    await store.set('openai', 'gpt-4o', null)

    // Should return null (not undefined)
    expect(store.get('openai', 'gpt-4o')).toBeNull()

    const store2 = new ModelPairingStore({ cacheDir: tempDir })
    expect(store2.get('openai', 'gpt-4o')).toBeNull()
  })

  it('falls back to model-only key when provider is omitted', async () => {
    const store = new ModelPairingStore({ cacheDir: tempDir })
    await store.set(undefined, 'generic-model', 'builtin:firecrawl')

    expect(store.get(undefined, 'generic-model')).toBe('builtin:firecrawl')
    // A lookup with a provider should still fallback to model-only key
    expect(store.get('some-provider', 'generic-model')).toBe('builtin:firecrawl')
  })

  it('gracefully handles corrupted JSON file without crashing', async () => {
    const filePath = join(tempDir, 'model-connections.json')
    await writeFile(filePath, '{ corrupt json !!!', 'utf8')

    const store = new ModelPairingStore({ cacheDir: tempDir })
    expect(store.get('any', 'model')).toBeUndefined()
    expect(store.snapshot()).toEqual({})

    // Writing should recover and replace the corrupted file
    await store.set('provider', 'model', 'builtin:exa')
    expect(store.get('provider', 'model')).toBe('builtin:exa')
  })
})

describe('extractSessionModel', () => {
  it('returns undefined for missing agent', () => {
    expect(extractSessionModel(undefined)).toBeUndefined()
  })

  it('extracts from sessionProjections if present', () => {
    const agent = { session: {} } as unknown as SessionModelAgent
    const ctx = {
      get: vi.fn((name: string) => {
        if (name === 'sessionProjections') {
          return {
            stateOf: () => ({ pending: { provider: 'test-p', model: 'test-m' } }),
          }
        }
        return undefined
      }),
    } as unknown as Context

    expect(extractSessionModel(agent, ctx)).toEqual({ provider: 'test-p', model: 'test-m' })
  })

  it('never scans deprecated history or resurrects an old consumed selection', () => {
    const snapshotEvents = vi.fn(() => { throw new Error('deprecated reader') })
    const agent = {
      session: { snapshotEvents, requestHeader: () => ({ config: { provider: 'committed-p', model: 'committed-m' } }) },
    }
    expect(extractSessionModel(agent)).toEqual({ provider: 'committed-p', model: 'committed-m' })
    expect(snapshotEvents).not.toHaveBeenCalled()
  })

  it('prefers pending intent over lastUsed only for pairing preferences', () => {
    const agent: SessionModelAgent = { session: { requestHeader: () => ({ config: { provider: 'last-p', model: 'last-m' } }) } }
    const ctx = { get: () => ({ stateOf: () => ({ pending: { provider: 'next-p', model: 'next-m' }, lastUsed: { provider: 'last-p', model: 'last-m' } }) }) } as unknown as Context
    expect(extractSessionModel(agent, ctx)).toEqual({ provider: 'next-p', model: 'next-m' })
    expect(sessionModelSelection(agent)).toEqual({ provider: 'last-p', model: 'last-m' })
  })

  it('does not fill an incomplete committed header with unrelated options', () => {
    const agent: SessionModelAgent = { options: { provider: 'other', model: 'other-m' }, session: { requestHeader: () => ({ config: {} }) } }
    expect(extractSessionModel(agent)).toBeUndefined()
  })

  it('extracts from requestHeader config', () => {
    const agent: SessionModelAgent = {
      session: {
        requestHeader: () => ({ config: { provider: 'header-p', model: 'header-m' } }),
      },
    }

    expect(extractSessionModel(agent)).toEqual({ provider: 'header-p', model: 'header-m' })
  })

  it('extracts from agent.options when no header exists', () => {
    const agent: SessionModelAgent = {
      options: { provider: 'opt-p', model: 'opt-m' },
      session: { requestHeader: () => undefined },
    }

    expect(extractSessionModel(agent)).toEqual({ provider: 'opt-p', model: 'opt-m' })
  })

  it('falls back to ctx.agentDefaultModel', () => {
    const agent: SessionModelAgent = {
      session: { requestHeader: () => undefined },
    }
    const ctx = {
      get: vi.fn((name: string) => {
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => ({ provider: 'default-p', model: 'default-m' }),
          }
        }
        return undefined
      }),
    } as unknown as Context

    expect(extractSessionModel(agent, ctx)).toEqual({ provider: 'default-p', model: 'default-m' })
  })
})
