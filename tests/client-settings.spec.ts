import { describe, expect, it, vi } from 'vitest'
import { draftFrom, saveCredential, validateDraft } from '../src/client/SearchSettingsCard.tsx'
import { inject } from '../src/client/index.tsx'
import { en, zh } from '../src/client/locales.ts'

describe('settings card helpers', () => {
  it('projects Host values into editable strings', () => {
    expect(draftFrom({ protocol: 'openai-responses', maxTokens: 8192, toolIdentifier: 'web_search_preview' }))
      .toMatchObject({ modelMode: 'configured', fallbackModel: '', apiKeyEnv: 'WEB_SEARCH_ENHANCED_API', protocol: 'openai-responses', maxTokens: '8192', toolIdentifier: 'web_search_preview' })
  })
  it('validates URLs, identifiers, and positive integer limits', () => {
    const draft = draftFrom({})
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
})
