import { describe, expect, it } from 'vitest'
import { draftFrom, validateDraft } from '../src/client/SearchSettingsCard.tsx'
import { en, zh } from '../src/client/locales.ts'

describe('settings card helpers', () => {
  it('projects Host values into editable strings', () => {
    expect(draftFrom({ protocol: 'openai-responses', maxTokens: 8192, toolIdentifier: 'web_search_preview' }))
      .toMatchObject({ protocol: 'openai-responses', maxTokens: '8192', toolIdentifier: 'web_search_preview' })
  })
  it('validates URLs, identifiers, and positive integer limits', () => {
    const draft = draftFrom({})
    expect(validateDraft(draft)).toEqual({})
    expect(validateDraft({ ...draft, baseURL: 'ftp://bad', toolIdentifier: '__bad', maxTokens: '0' }))
      .toMatchObject({ baseURL: 'invalidURL', toolIdentifier: 'invalidIdentifier', maxTokens: 'invalidInteger' })
  })
  it('keeps Chinese and English dictionaries structurally paired', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })
})
