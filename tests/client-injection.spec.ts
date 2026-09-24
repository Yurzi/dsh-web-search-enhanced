import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import * as client from '../src/client/index.tsx'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const entries = new Map<string, any>()
  const value = { selection: { connectionId: null, revision: 0 }, freshness: 'auto', connections: [] }
  const search = { get: vi.fn(async () => ({ ok: true, value })), set: vi.fn(async () => ({ ok: true, value })) }
  const credentials = { describe: vi.fn(), set: vi.fn(async () => ({ ok: true, value: undefined })) }
  const form = { getSnapshot: vi.fn(), subscribe: vi.fn((_listener: () => void) => vi.fn()), mutate: vi.fn(async () => false) }
  const registerLocale = vi.fn(() => vi.fn())
  let served = true
  let syncSettings: (() => void) | undefined
  const configForms = {
    get: vi.fn(() => form),
    whileServed: vi.fn((_names: string[], register: () => () => void) => {
      let off: (() => void) | undefined
      syncSettings = () => {
        if (served && !off) off = register()
        else if (!served && off) { off(); off = undefined }
      }
      syncSettings()
      return () => { syncSettings = undefined; off?.() }
    }),
  }
  let provider: ReturnType<Context['plugin']> | undefined
  const mountNamespace = async () => {
    provider = ctx.plugin({ name: 'fixture-search-remote', apply(c) { c.provide('remote.searchConnections', search) } })
    await provider
  }
  class Remote extends Service {
    constructor(c: Context) { super(c, 'remote') }
    get credentials() { return (this.ctx as any)['remote.credentials'] }
    get searchConnections() { return (this.ctx as any)['remote.searchConnections'] }
    async $mount() { await mountNamespace(); return async () => { await provider?.dispose() } }
  }
  class Slots extends Service {
    constructor(c: Context) { super(c, 'slots') }
    inject(_name: string, callback: () => unknown) { return this.ctx.effect(callback as any) }
    register(options: any) {
      return this.ctx.effect(() => { entries.set(options.name, options); return () => { entries.delete(options.name) } })
    }
  }
  new Remote(ctx); new Slots(ctx)
  const generation = { subscribe: vi.fn((_listener: () => void) => vi.fn()) }
  ctx.provide('connection', { generation })
  ctx.provide('remote.credentials', credentials)
  ctx.provide('locale', { register: registerLocale })
  ctx.provide('configForms', configForms)
  return {
    ctx, entries, search, credentials, form, configForms, registerLocale, mountNamespace, generation,
    serve: (value: boolean) => { served = value; syncSettings?.() },
    unmount: async () => { await provider?.dispose() },
  }
}

it('reproduces the browser error when accessing a mounted namespace without inject', async () => {
  const h = await fixture(); await h.mountNamespace()
  let access!: () => unknown
  await h.ctx.plugin({ name:'unscoped-selector', inject:['remote'], apply(c) { access = () => (c.remote as any).searchConnections } })
  expect(access).toThrow('cannot get property "remote.searchConnections" without inject')
})

it('mounts before injecting, binds callbacks to the Session, and follows namespace lifecycle', async () => {
  const h = await fixture()
  expect(client.inject).not.toContain('remote.searchConnections')
  expect(client.inject).toContain('configForms')
  expect(client.inject).not.toContain('sessions')
  const plugin = h.ctx.plugin(client)
  await plugin
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(true))
  const selector = h.entries.get('conversation.input.right')
  const props = selector.inject('current-session')
  expect(Object.keys(props).sort()).toEqual(['getSelection', 'setSelection'])
  await props.getSelection()
  await props.setSelection({ connectionId: 'builtin:exa', expectedRevision: 4 })
  expect(h.search.get).toHaveBeenCalledWith({ sessionId: 'current-session' })
  expect(h.search.set).toHaveBeenCalledWith({ sessionId: 'current-session', connectionId: 'builtin:exa', expectedRevision: 4 })
  expect(selector.locale).toBe('settings.webSearchEnhanced')
  expect(h.entries.has('plugins.bundle.config')).toBe(true)
  await h.unmount()
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(false))
  expect(h.entries.has('plugins.bundle.config')).toBe(true)
  await h.mountNamespace()
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(true))
  await h.entries.get('conversation.input.right').inject('other-session').getSelection()
  expect(h.search.get).toHaveBeenLastCalledWith({ sessionId: 'other-session' })
  await plugin.dispose()
  expect(h.entries.size).toBe(0)
  expect(h.registerLocale.mock.results[0]!.value).toHaveBeenCalledOnce()
})

it('shares session reads and invalidates on settings, credential and carrier changes', async () => {
  const h = await fixture()
  const plugin = h.ctx.plugin(client)
  await plugin
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(true))
  const selector = h.entries.get('conversation.input.right')
  const first = selector.inject('same-session')
  const second = selector.inject('same-session')
  await Promise.all([first.getSelection(), second.getSelection()])
  expect(h.search.get).toHaveBeenCalledTimes(1)
  await second.getSelection()
  expect(h.search.get).toHaveBeenCalledTimes(1)

  h.form.subscribe.mock.calls[0]![0]()
  await first.getSelection()
  expect(h.search.get).toHaveBeenCalledTimes(2)
  await h.entries.get('plugins.bundle.config').inject().setCredential('KEY', 'value')
  await first.getSelection()
  expect(h.search.get).toHaveBeenCalledTimes(3)
  h.generation.subscribe.mock.calls[0]![0]()
  await second.getSelection()
  expect(h.search.get).toHaveBeenCalledTimes(4)

  await h.unmount()
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(false))
  expect(() => first.getSelection()).toThrow('disposed')
  expect(h.form.subscribe.mock.results[0]!.value).toHaveBeenCalledOnce()
  expect(h.generation.subscribe.mock.results[0]!.value).toHaveBeenCalledOnce()
  await h.mountNamespace()
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(true))
  await h.entries.get('conversation.input.right').inject('same-session').getSelection()
  expect(h.search.get).toHaveBeenCalledTimes(5)
  await plugin.dispose()
})

it('registers bundle configuration only while served, with framework hooks and no service props', async () => {
  const h = await fixture()
  h.serve(false)
  const plugin = h.ctx.plugin(client)
  await plugin
  expect(h.entries.has('plugins.bundle.config')).toBe(false)
  expect(h.configForms.get).toHaveBeenCalledWith('web-search-enhanced')
  expect(h.configForms.whileServed).toHaveBeenCalledWith(['web-search-enhanced'], expect.any(Function))
  h.serve(true)
  const entry = h.entries.get('plugins.bundle.config')
  expect(entry.key).toBe('dsh-web-search-enhanced')
  expect(entry.locale).toBe('settings.webSearchEnhanced')
  expect(h.entries.has('settings.plugin.item')).toBe(false)
  const face = entry.inject()
  expect(face.hooks.settings).toBe(h.form)
  expect(face.scope).toBeUndefined()
  expect(face.credentials).toBeUndefined()
  await expect(face.mutateSettings([{ op: 'unset', path: ['freshness'] }], 7)).resolves.toBe(false)
  expect(h.form.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['freshness'] }], 7)
  await face.describeCredentials(['EXA_API_KEY'])
  await face.setCredential('EXA_API_KEY', 'placeholder')
  expect(h.credentials.describe).toHaveBeenCalledWith(['EXA_API_KEY'])
  expect(h.credentials.set).toHaveBeenCalledWith('EXA_API_KEY', 'placeholder')
  h.serve(false)
  expect(h.entries.has('plugins.bundle.config')).toBe(false)
  h.serve(true)
  expect(h.entries.get('plugins.bundle.config').inject()).toBe(face)
  await plugin.dispose()
  expect(h.entries.size).toBe(0)
  h.serve(true)
  expect(h.entries.size).toBe(0)
})
