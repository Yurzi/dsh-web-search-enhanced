// @vitest-environment jsdom
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { V2Config } from '../src/settings/types.ts'
import type { CredentialStates } from '../src/client/settings/credentials.ts'
import type { SearchRoute } from '../src/client/settings/route.ts'
import { SettingsPage, type SettingsPageProps } from '../src/client/settings/SettingsPage.tsx'
import { bindHook, blur, byText, click, flush, observable, render, tZh, type } from './client-harness.tsx'

function mountPage({ user = { version: 2 } as Record<string, unknown>, writable = true, accepted = true } = {}) {
  const settings = observable({ status: 'ready', value: user as V2Config, base: {}, user, revision: 8, writable } as ConfigFormSnapshot<V2Config>)
  const credentials = observable<CredentialStates>({ SEMANTIC_SCHOLAR_API_KEY: { configured: false, writable: true } })
  const route = observable<SearchRoute>({ kind: 'this' })
  const mutate = vi.fn(async () => accepted)
  const saveCredential = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const props = { view: 'page', useSettings: bindHook(settings), useCredentials: bindHook(credentials), useRoute: bindHook(route), mutate, saveCredential, t: tZh } as unknown as SettingsPageProps
  const { container } = render(<SettingsPage {...props} />)
  const row = (name: string) => byText(container, 'li', name)!
  const configure = (name: string) => { click(row(name).querySelector('button[aria-expanded]')) }
  return { container, mutate, saveCredential, row, configure, route }
}

describe('settings page', () => {
  it('saves a key through Credentials only and leaves settings untouched', async () => {
    const { mutate, saveCredential, configure, row } = mountPage()
    configure('Semantic Scholar')
    type(row('Semantic Scholar').querySelector('input[type="password"]'), '  secret-value  ')
    click(byText(row('Semantic Scholar'), 'button', tZh('credential.save')))
    await flush()
    expect(saveCredential).toHaveBeenCalledExactlyOnceWith('SEMANTIC_SCHOLAR_API_KEY', 'secret-value')
    expect(mutate).not.toHaveBeenCalled()
    expect(row('Semantic Scholar').textContent).toContain(tZh('credential.saved'))
    expect(row('Semantic Scholar').querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('')
  })

  it('switches a keyless service to a personal key with one sparse write', async () => {
    const { mutate, configure, row } = mountPage()
    configure('Exa')
    expect(row('Exa').textContent).toContain(tZh('services.accessHint.keyless'))
    click(byText(row('Exa'), '[role="tab"]', tZh('services.accessPersonal')))
    await flush()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:exa', 'access'], value: 'api-key' }], 8)
  })

  it('saves a valid option when the field is left and keeps an invalid one with its error', async () => {
    const { mutate, configure, row } = mountPage({ user: { version: 2, connections: { 'builtin:firecrawl': { access: 'api-key', options: { safe: true } } } } })
    configure('Firecrawl')
    expect(row('Firecrawl').textContent).toContain(tZh('option.firecrawl.country'))
    const country = [...row('Firecrawl').querySelectorAll('input')].find(input => input.id.endsWith('-country'))!
    expect(country.title).toBe('country')
    type(country, 'usa')
    blur(country)
    await flush()
    expect(mutate).not.toHaveBeenCalled()
    expect(row('Firecrawl').textContent).toContain(tZh('options.invalid'))
    type(country, 'us')
    blur(country)
    await flush()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:firecrawl', 'options', 'country'], value: 'us' }], 8)
  })

  it('saves per-protocol search options of the session model', async () => {
    const { mutate, configure, row } = mountPage()
    configure(tZh('connection.followModel'))
    const maxUses = [...row(tZh('connection.followModel')).querySelectorAll('input')].find(input => input.id.endsWith('-maxUses'))
    type(maxUses, '3')
    blur(maxUses)
    await flush()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['connections', 'builtin:session-model', 'optionsByProtocol', 'anthropic-messages', 'maxUses'], value: 3 },
    ], 8)
  })

  it('hides options the keyless route rejects', () => {
    const { configure, row } = mountPage()
    configure('Exa')
    expect(row('Exa').textContent).not.toContain(tZh('option.exa.type'))
  })

  it('turns a service off and reports a refused write', async () => {
    const { mutate, row } = mountPage({ accepted: false })
    click(row('Tavily').querySelector('[role="switch"]'))
    await flush()
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['connections', 'builtin:tavily', 'disabled'], value: true }], 8)
    expect(row('Tavily').querySelector('[role="alert"]')?.textContent).toBe(tZh('settings.refused'))
  })

  it('writes defaults sparsely', async () => {
    const { mutate, container } = mountPage({ user: { version: 2, showSelector: false } })
    click(container.querySelector(`[role="switch"][aria-label="${tZh('defaults.showSelector')}"]`))
    await flush()
    expect(mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['showSelector'] }], 8)
  })

  it('adds a custom service with a suggested reference and its key, asking for trust only for another endpoint', async () => {
    const { mutate, saveCredential, container } = mountPage()
    click(byText(container, 'button', tZh('custom.addStructured')))
    const editor = container.querySelector('form[aria-labelledby]')!
    const input = (suffix: string) => [...editor.querySelectorAll('input')].find(element => element.id.endsWith(suffix))
    type(input('-id'), 'work-exa')
    type(input('-label'), 'Work Exa')
    expect(input('-ref')?.value).toBe('CUSTOM_WORK_EXA_API_KEY')
    type(input('-endpoint'), 'https://proxy.example/search')
    const save = byText<HTMLButtonElement>(editor, 'button', tZh('editor.save'))!
    expect(editor.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(save.disabled).toBe(true)
    type(input('-endpoint'), '')
    expect(editor.querySelector('input[type="checkbox"]')).toBeNull()
    type(input('-key'), 'secret-value')
    click(save)
    await flush()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{
      op: 'set', path: ['connections', 'custom:work-exa'],
      value: { kind: 'structured', label: 'Work Exa', adapter: 'exa', credentialRef: 'CUSTOM_WORK_EXA_API_KEY' },
    }], 8)
    expect(saveCredential).toHaveBeenCalledExactlyOnceWith('CUSTOM_WORK_EXA_API_KEY', 'secret-value')
    expect(container.querySelector('form[aria-labelledby]')).toBeNull()
  })

  it('removes a custom connection only after confirmation', async () => {
    const connection = { kind: 'structured', label: 'Work Exa', adapter: 'exa', credentialRef: 'WORK_KEY' }
    const { mutate, row } = mountPage({ user: { version: 2, connections: { 'custom:work': connection } } })
    click(byText(row('Work Exa'), 'button', tZh('custom.remove')))
    expect(mutate).not.toHaveBeenCalled()
    const confirm = row('Work Exa').querySelector('[role="group"]')!
    expect(confirm.textContent).toContain(tZh('custom.removeConfirm', { name: 'Work Exa' }))
    click(byText(confirm, 'button', tZh('custom.remove')))
    await flush()
    // The only connection override goes, so no empty `connections: {}` stays behind.
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'unset', path: ['connections'] }], 8)
  })

  it('restores defaults after confirmation without touching keys', async () => {
    const { mutate, saveCredential, container } = mountPage({ user: { version: 2, freshness: 'fresh' } })
    click(byText(container, 'button', tZh('reset.button')))
    expect(mutate).not.toHaveBeenCalled()
    click(byText(container, 'button', tZh('reset.confirmButton')))
    await flush()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'unset', path: ['version'] }, { op: 'unset', path: ['freshness'] }], 8)
    expect(saveCredential).not.toHaveBeenCalled()
  })

  it('says when web_search does not reach this plugin', () => {
    const { container, route } = mountPage()
    const notices = () => [...container.querySelectorAll('[role="status"]')].map(element => element.textContent)
    expect(notices()).toEqual([])
    act(() => { route.set({ kind: 'auto', providerId: 'deepseek-official' }) })
    expect(notices()).toEqual([tZh('route.auto', { id: 'deepseek-official' })])
    act(() => { route.set({ kind: 'other', provider: 'deepseek-search-api', providerId: 'deepseek-official' }) })
    expect(notices()).toEqual([tZh('route.deepseekApi', { id: 'deepseek-official' })])
    act(() => { route.set({ kind: 'other', provider: 'deepseek-official', providerId: 'enhanced-search' }) })
    expect(notices()).toEqual([tZh('route.other', { provider: 'deepseek-official', id: 'enhanced-search' })])
    act(() => { route.set({ kind: 'unknown' }) })
    expect(notices()).toEqual([])
  })

  it('locks every control while the document awaits migration', () => {
    const { container } = mountPage({ user: { model: 'legacy-model' } })
    expect(container.textContent).toContain(tZh('settings.migration'))
    expect([...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].every(control => control.disabled)).toBe(true)
  })
})