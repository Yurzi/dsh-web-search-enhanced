import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import * as client from '../src/client/index.tsx'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const entries = new Map<string, any>()
  const search = { get: vi.fn(), set: vi.fn() }
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
  ctx.provide('remote.credentials', {})
  ctx.provide('locale', { register: () => () => {} })
  ctx.provide('settingsScope', { bind: () => ({}) })
  return { ctx, entries, search, mountNamespace, unmount: async () => { await provider?.dispose() } }
}

it('reproduces the browser error when accessing a mounted namespace without inject', async () => {
  const h = await fixture(); await h.mountNamespace()
  let access!: () => unknown
  await h.ctx.plugin({ name:'unscoped-selector', inject:['remote'], apply(c) { access = () => (c.remote as any).searchConnections } })
  expect(access).toThrow('cannot get property "remote.searchConnections" without inject')
})

it('mounts before injecting, renders props from the injected scope, and follows namespace lifecycle', async () => {
  const h = await fixture()
  expect(client.inject).not.toContain('remote.searchConnections')
  const plugin = h.ctx.plugin(client)
  await plugin
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(true))
  const props = h.entries.get('conversation.input.right').inject('current-session')
  expect(props.sessionId).toBe('current-session')
  expect(typeof props.remote.get).toBe('function')
  expect(h.entries.has('settings.plugin.item')).toBe(true)
  await h.unmount()
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(false))
  expect(h.entries.has('settings.plugin.item')).toBe(true)
  await h.mountNamespace()
  await vi.waitFor(() => expect(h.entries.has('conversation.input.right')).toBe(true))
  expect(h.entries.get('conversation.input.right').inject('other-session').sessionId).toBe('other-session')
  await plugin.dispose()
  expect(h.entries.size).toBe(0)
})
