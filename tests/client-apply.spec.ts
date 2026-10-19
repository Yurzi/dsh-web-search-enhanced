import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import * as client from '../src/client/index.tsx'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  const entries = new Map<string, any>()
  const listeners = new Map<string, () => void>()
  const view = { selection: { connectionId: null, freshness: 'auto', revision: 0 }, connections: [] }
  const search = { get: vi.fn(async () => ({ ok: true, value: view })), set: vi.fn(async () => ({ ok: true, value: view })) }
  const form = { getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true }), subscribe: vi.fn(() => () => {}), mutate: vi.fn(async () => true) }
  class Remote extends Service {
    constructor(c: Context) { super(c, 'remote') }
    get credentials() { return (this.ctx as any)['remote.credentials'] }
    get searchConnections() { return (this.ctx as any)['remote.searchConnections'] }
    async $mount() {
      const provider = ctx.plugin({ name: 'search-remote', apply: c => { c.provide('remote.searchConnections', search) } })
      await provider
      return async () => { await provider.dispose() }
    }
    $on(event: string, listener: () => void) { listeners.set(event, listener); return () => { listeners.delete(event) } }
  }
  class Slots extends Service {
    constructor(c: Context) { super(c, 'slots') }
    inject(_name: string, callback: () => () => void) { return this.ctx.effect(callback) }
    register(options: any) { return this.ctx.effect(() => { entries.set(options.name, options); return () => { entries.delete(options.name) } }) }
  }
  new Remote(ctx)
  new Slots(ctx)
  ctx.provide('connection', { generation: { subscribe: () => () => {} } })
  ctx.provide('remote.credentials', { describe: vi.fn(async () => ({ ok: true, value: {} })), set: vi.fn() })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  ctx.provide('configForms', { get: () => form, whileServed: (_names: string[], register: () => () => void) => register() })
  const commands = vi.fn(() => () => {})
  ctx.provide('commandUi', { register: commands })
  const openBundle = vi.fn()
  ctx.provide('pluginNavigation', { openBundle })
  const plugin = ctx.plugin(client)
  await plugin
  await vi.waitFor(() => expect(entries.has('conversation.input.right')).toBe(true))
  return { plugin, entries, listeners, search, commands, openBundle }
}

it('registers the settings page, activation guidance, composer seat and /setup-search', async () => {
  const { entries, commands, plugin } = await fixture()
  expect(entries.get('plugins.bundle.config')).toMatchObject({ key: 'dsh-web-search-enhanced', locale: 'webSearchEnhanced' })
  expect(entries.get('plugins.bundle.activation')).toMatchObject({ key: 'dsh-web-search-enhanced' })
  expect(commands).toHaveBeenCalledWith(expect.objectContaining({ name: 'setup-search' }))
  await plugin.dispose()
  expect(entries.size).toBe(0)
})

it('binds the composer seat to its session and rereads observed sessions when settings change', async () => {
  const { entries, listeners, search, openBundle } = await fixture()
  const face = entries.get('conversation.input.right').inject('session-1')
  expect(entries.get('conversation.input.right').inject('session-1').hooks.selection).toBe(face.hooks.selection)
  await face.load('')
  await face.select({ connectionId: 'builtin:exa' })
  expect(search.set).toHaveBeenCalledWith({ sessionId: 'session-1', connectionId: 'builtin:exa', expectedRevision: 0 })
  const stop = face.hooks.selection.subscribe(() => {})
  listeners.get('settings/document-updated')!()
  await vi.waitFor(() => expect(search.get).toHaveBeenCalledTimes(2))
  stop()
  face.hooks.navigation.getSnapshot().openSettings()
  expect(openBundle).toHaveBeenCalledWith('dsh-web-search-enhanced')
})
