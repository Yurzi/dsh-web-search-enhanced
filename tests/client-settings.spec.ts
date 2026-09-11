import { describe, expect, it, vi } from 'vitest'
import { computeSettingsOperations, draftFrom, saveCredential, validateDraft } from '../src/client/SearchSettingsCard.tsx'
import { apply, inject } from '../src/client/index.tsx'
import { en, zh } from '../src/client/locales.ts'

describe('settings card helpers', () => {
  it('projects Host values into editable strings', () => {
    expect(draftFrom({ protocol: 'openai-responses', maxTokens: 8192, toolIdentifier: 'web_search_preview' }))
      .toMatchObject({ modelMode: 'configured', fallbackModel: '', apiKeyEnv: 'WEB_SEARCH_ENHANCED_API', protocol: 'openai-responses', maxTokens: '8192', toolIdentifier: 'web_search_preview' })
  })
  it('validates URLs, identifiers, and positive integer limits', () => {
    const draft = draftFrom({})
    expect(draft.model).toBe('deepseek-flash')
    expect(validateDraft(draft)).toEqual({})
    expect(validateDraft({ ...draft, baseURL: 'ftp://bad', toolIdentifier: '__bad', apiKeyEnv: 'bad ref', maxTokens: '0' }))
      .toMatchObject({ baseURL: 'invalidURL', toolIdentifier: 'invalidIdentifier', apiKeyEnv: 'invalidCredentialRef', maxTokens: 'invalidInteger' })
  })
  it('waits for the credential Remote namespace before activation', () => {
    expect(inject).toContain('remote.credentials')
  })

  it('writes non-empty credentials and skips blank input', async () => {
    const credentials = {
      describe: vi.fn(async () => ({ ok: true as const, value: {} })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    await expect(saveCredential(credentials, 'WEB_SEARCH_ENHANCED_API', '  secret  ')).resolves.toBe(true)
    expect(credentials.set).toHaveBeenCalledWith('WEB_SEARCH_ENHANCED_API', 'secret')
    await expect(saveCredential(credentials, 'WEB_SEARCH_ENHANCED_API', '  ')).resolves.toBe(false)
    expect(credentials.set).toHaveBeenCalledTimes(1)
  })

  it('surfaces credential Remote refusals', async () => {
    const credentials = {
      describe: vi.fn(async () => ({ ok: true as const, value: {} })),
      set: vi.fn(async () => ({ ok: false as const, error: { message: 'write refused' } })),
    }
    await expect(saveCredential(credentials, 'WEB_SEARCH_ENHANCED_API', 'secret')).rejects.toThrow('write refused')
  })

  it('keeps Chinese and English dictionaries structurally paired', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('registers /search-config action command when commandUi service is available', () => {
    const registered: any[] = []
    const commandUi = {
      register: vi.fn((cmd: any) => {
        registered.push(cmd)
        return () => {}
      }),
    }
    const injectedScopes: Record<string, any> = {
      commandUi: { commandUi, effect: (fn: () => void) => fn() },
    }
    const mockCtx = {
      locale: {
        bind: () => (k: string) => k,
        register: vi.fn(),
      },
      effect: (fn: () => void) => fn(),
      settingsScope: { bind: () => ({}) },
      slots: { inject: vi.fn(), register: vi.fn() },
      remote: { credentials: {} },
      inject: (deps: string[], cb: (scope: any) => void) => {
        if (deps.includes('commandUi')) cb(injectedScopes.commandUi)
      },
    }

    apply(mockCtx as any)

    expect(commandUi.register).toHaveBeenCalledTimes(1)
    expect(registered[0]?.name).toBe('search-config')
    expect(registered[0]?.ui?.kind).toBe('action')
    expect(typeof registered[0]?.ui?.run).toBe('function')
    expect(registered[0]?.available()).toBe(true)
  })

  describe('sparse configuration mutations (preventing settings.yaml bloat)', () => {
    it('produces zero operations when draft matches defaults on clean install', () => {
      const draft = draftFrom({})
      const ops = computeSettingsOperations(draft, { base: {}, user: undefined })
      expect(ops).toEqual([])
    })

    it('produces only the changed field operation when one setting is modified', () => {
      const draft = draftFrom({})
      draft.model = 'deepseek-chat'
      const ops = computeSettingsOperations(draft, { base: {}, user: undefined })
      expect(ops).toEqual([{ op: 'set', path: ['model'], value: 'deepseek-chat' }])
    })

    it('stores numeric and select fields with proper types', () => {
      const draft = draftFrom({})
      draft.maxTokens = '8192'
      draft.modelMode = 'current-session'
      const ops = computeSettingsOperations(draft, { base: {}, user: undefined })
      expect(ops).toEqual([
        { op: 'set', path: ['modelMode'], value: 'current-session' },
        { op: 'set', path: ['maxTokens'], value: 8192 },
      ])
    })

    it('prunes existing redundant user overrides when they match the baseline defaults', () => {
      const draft = draftFrom({})
      const bloatedUser = {
        baseURL: 'https://api.deepseek.com/anthropic/v1',
        model: 'deepseek-flash',
        maxTokens: 4096,
      }
      const ops = computeSettingsOperations(draft, { base: {}, user: bloatedUser })
      expect(ops).toEqual([
        { op: 'unset', path: ['baseURL'] },
        { op: 'unset', path: ['model'] },
        { op: 'unset', path: ['maxTokens'] },
      ])
    })

    it('unsets all user-layer fields when resetToProfile is true', () => {
      const draft = draftFrom({})
      const user = {
        model: 'custom-model',
        maxTokens: 2048,
      }
      const ops = computeSettingsOperations(draft, { base: {}, user }, true)
      expect(ops).toEqual([
        { op: 'unset', path: ['model'] },
        { op: 'unset', path: ['maxTokens'] },
      ])
    })

    it('respects base composition values and does not store identical target values', () => {
      const draft = draftFrom({})
      draft.fallbackModel = 'deepseek-flash'
      const base = { fallbackModel: 'deepseek-flash' }
      const ops = computeSettingsOperations(draft, { base, user: undefined })
      expect(ops).toEqual([])
    })
  })
})
