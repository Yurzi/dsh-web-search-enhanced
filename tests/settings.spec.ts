import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
class MemorySettings extends SettingsProvider {
 doc: Record<string, unknown> = {}
 get writable() { return true }
 protected load() { return Promise.resolve(structuredClone(this.doc)) }
 protected persist(ns:SettingsNamespace,section:Record<string,unknown>) { this.doc={...this.doc,[ns]:structuredClone(section)};return Promise.resolve() }
}
async function boot():Promise<{ctx:Context;pluginFiber:Fiber}> {
 const ctx=new Context();await ctx.plugin(WebRuntime,{searchProvider:plugin.DEFAULT_PROVIDER_ID});await ctx.plugin(MemorySettings)
 const pluginFiber=ctx.plugin(plugin,{});await pluginFiber.await();return {ctx,pluginFiber}
}
describe('V2 sparse settings integration',()=>{
 it('loads with no keys or settings and only stores actual preference changes',async()=>{
  const {ctx}=await boot()
  const ns=plugin.SETTINGS_NAMESPACE as unknown as SettingsNamespace
  expect(ctx.settings.get(ns)).toEqual({connections:{}})
  expect(ctx.settings.describe()[0]?.user).toBeUndefined()
  await ctx.settings.update(ns,{version:2,freshness:'realtime'})
  expect(ctx.settings.describe()[0]?.user).toEqual({version:2,freshness:'realtime'})
  expect(plugin.resolveSettings(ctx.settings.get(ns) as plugin.Config).freshness).toBe('realtime')
  await expect(ctx.web.search({query:'q'})).rejects.toMatchObject({code:'WEB_SEARCH_CONTEXT_UNAVAILABLE'})
  await ctx.fiber.dispose()
 })
 it('rejects unsafe live configuration and unregisters on disposal',async()=>{
  const {ctx,pluginFiber}=await boot();const ns=plugin.SETTINGS_NAMESPACE as unknown as SettingsNamespace
  await expect(ctx.settings.update(ns,{providerId:'other'})).rejects.toThrow('providerId cannot be changed')
  await expect(ctx.settings.update(ns,{connections:{'builtin:exa':{endpoint:'https://untrusted.test'}}})).rejects.toThrow()
  await expect(ctx.settings.update(ns,{apiKey:'fixture-not-real'})).rejects.toThrow('DSH Credentials')
  await pluginFiber.dispose();await expect(ctx.web.search({query:'q'})).rejects.toMatchObject({code:'WEB_PROVIDER_CONFIGURED_MISSING'});await ctx.fiber.dispose()
 })
 it('automatically detects and migrates legacy v1 settings on startup', async () => {
  class InitialLegacySettings extends SettingsProvider {
   doc = {
    [plugin.SETTINGS_NAMESPACE]: {
     modelMode: 'configured',
     model: 'deepseek-flash',
     apiKeyEnv: 'MY_SEARCH_KEY',
     maxTokens: 2048,
    }
   }
   get writable() { return true }
   protected load() { return Promise.resolve(structuredClone(this.doc)) }
   protected persist(ns: SettingsNamespace, section: Record<string, unknown>) { this.doc = { ...this.doc, [ns]: structuredClone(section) }; return Promise.resolve() }
  }
  const ctx = new Context(); await ctx.plugin(WebRuntime, { searchProvider: plugin.DEFAULT_PROVIDER_ID })
  await ctx.plugin(InitialLegacySettings)
  const pluginFiber = ctx.plugin(plugin, {}); await pluginFiber.await()
  // Wait for settings queue to settle
  await new Promise(r => setTimeout(r, 50))
  const user = ctx.settings.describe()[0]?.user as Record<string, unknown>
  expect(user?.version).toBe(2)
  expect(user?.defaultConnection).toBe('custom:legacy')
  expect((user?.connections as Record<string, unknown>)?.[('custom:legacy')]).toBeDefined()
  await ctx.fiber.dispose()
 })
})
