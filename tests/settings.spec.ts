import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.doc)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<{ ctx: Context; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: plugin.DEFAULT_PROVIDER_ID })
  await ctx.plugin(MemorySettings)
  const pluginFiber = ctx.plugin(plugin, { apiKey: 'secret' })
  await pluginFiber.await()
  return { ctx, pluginFiber }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Web Profile settings integration', () => {
  it('applies a committed protocol change to the next search', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://source.test' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'answer', annotations: [] }] },
    ] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain(String(plugin.SETTINGS_NAMESPACE))
    await bench.ctx.settings.update(plugin.SETTINGS_NAMESPACE as unknown as SettingsNamespace, {
      protocol: 'openai-responses', baseURL: 'https://api.example/v1', model: 'search-model', maxTokens: 2048,
    })
    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'answer' })
    expect(fetcher).toHaveBeenCalledWith('https://api.example/v1/responses', expect.objectContaining({ redirect: 'error' }))
    await bench.ctx.fiber.dispose()
  })

  it('rejects provider identity changes and unregisters on disposal', async () => {
    const bench = await boot()
    await expect(bench.ctx.settings.update(plugin.SETTINGS_NAMESPACE as unknown as SettingsNamespace, { providerId: 'other' }))
      .rejects.toThrow('providerId cannot be changed')
    await bench.pluginFiber.dispose()
    await expect(bench.ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    await bench.ctx.fiber.dispose()
  })
})
