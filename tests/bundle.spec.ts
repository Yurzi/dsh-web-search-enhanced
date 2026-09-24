import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { describe, expect, it } from 'vitest'
import { EnhancedSearchProvider, resolveConfig } from '../src/index.ts'

interface Manifest {
  readonly name: string
  readonly engines: { dsh: string }
  readonly peerDependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
  readonly files: readonly string[]
  readonly exports: Record<string, unknown>
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string }
    readonly client?: { readonly platform?: string; readonly inject?: readonly string[] }
  }
}

interface ClientBundleRegistration {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest
const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

function readClientBundle(): string | undefined {
  try {
    return readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  } catch {
    return undefined
  }
}

describe('installable DSH profile bundle', () => {
  it('requires DSH 0.1.7-rc.1 and builds against that exact prerelease', () => {
    expect(manifest.engines.dsh).toBe('>=0.1.7-rc.1')
    for (const [name, range] of Object.entries(manifest.peerDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(range).toBe('^0.1.7-rc.1')
    }
    for (const [name, version] of Object.entries(manifest.devDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(version).toBe('0.1.7-rc.1')
    }
    expect(manifest.devDependencies).not.toHaveProperty('@deepseek-ai/dsh-code-runtime')
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-session')
  })
  it('publishes built artifacts and bundle configuration', () => {
    expect(manifest.name).toBe('dsh-web-search-enhanced')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.exports).toHaveProperty('./cordis.patch.yml', './cordis.patch.yml')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.files).toContain('lib/client.js')
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-plugin-manager')
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-commands')
  })

  it('declares cordis.patch.yml with searchProvider without overriding fetchProvider', () => {
    expect(patchText).toContain('id: web')
    expect(patchText).toContain('searchProvider: enhanced-search')
    expect(patchText).not.toContain('fetchProvider:')
    expect(patchText).toContain('id: web-search-deepseek')
    expect(patchText).toContain('disabled: true')
    expect(patchText).toContain('id: web-search-enhanced')
    expect(patchText).toContain('name: dsh-web-search-enhanced')
  })

  const clientBundle = readClientBundle()

  it.skipIf(clientBundle === undefined)('registers the built client through the DSH module loader', async () => {
    let registration: ClientBundleRegistration | undefined
    runInNewContext(clientBundle!, {
      window: {
        __ModuleLoader__: {
          load: (value: ClientBundleRegistration) => { registration = value },
        },
      },
    })

    expect(registration).toBeDefined()
    const registered = registration!
    expect(registered.id).toBe(manifest.name)

    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
    ])
    const requested: string[] = []
    const exports = registered.factory((specifier) => {
      requested.push(specifier)
      if (!modules.has(specifier)) throw new Error(`unexpected client module request: ${specifier}`)
      return modules.get(specifier)
    })

    expect(new Set(requested)).toEqual(new Set(['react', 'react/jsx-runtime']))
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['slots', 'locale', 'configForms', 'remote', 'remote.credentials'])
  })

  it('allows seamless fetch auto-selection when fetchProvider is omitted in WebRuntime config', async () => {
    const ctx = new Context()
    // Configure WebRuntime with only searchProvider (as patched by cordis.patch.yml)
    await ctx.plugin(WebRuntime, { searchProvider: 'enhanced-search' })

    const searchProvider = new EnhancedSearchProvider(
      () => resolveConfig({ apiKey: 'dummy', protocol: 'openai-responses' }),
      async () => new Response(JSON.stringify({
        output: [
          { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://example.com' }] } },
          { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const dummyFetchProvider: WebFetchProvider = {
      id: 'http',
      available: () => true,
      fetch: async (request: WebFetchRequest): Promise<WebFetchResult> => ({
        url: request.url,
        statusCode: 200,
        body: { kind: 'text', content: 'fetched-content' },
        truncated: false,
      }),
    }

    ctx.web.registerSearchProvider(searchProvider)
    ctx.web.registerFetchProvider(dummyFetchProvider)

    // Search resolves explicitly configured searchProvider
    const searchRes = await ctx.web.search({ query: 'test' })
    expect(searchRes.content).toBe('ok')
    expect(searchRes.sources).toEqual([{ url: 'https://example.com' }])

    // Fetch resolves the single registered fetch provider without requiring fetchProvider in WebRuntime config
    const fetchRes = await ctx.web.fetch({ url: 'https://example.com' })
    expect(fetchRes.body).toEqual({ kind: 'text', content: 'fetched-content' })

    await ctx.fiber.dispose()
  })

  it('allows third-party fetch providers to auto-select without interference', async () => {
    const ctx = new Context()
    // WebRuntime with only searchProvider patched
    await ctx.plugin(WebRuntime, { searchProvider: 'enhanced-search' })

    const searchProvider = new EnhancedSearchProvider(
      () => resolveConfig({ apiKey: 'dummy', protocol: 'openai-responses' }),
      async () => new Response(JSON.stringify({
        output: [
          { type: 'web_search_call', status: 'completed', action: { sources: [{ url: 'https://example.com' }] } },
          { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    // A third-party enhanced fetch provider (like dsh-web-fetch-enhanced)
    const enhancedFetchProvider: WebFetchProvider = {
      id: 'http-enhanced',
      available: () => true,
      fetch: async (request: WebFetchRequest): Promise<WebFetchResult> => ({
        url: request.url,
        statusCode: 200,
        body: { kind: 'text', content: 'enhanced-fetched-content' },
        truncated: false,
      }),
    }

    ctx.web.registerSearchProvider(searchProvider)
    ctx.web.registerFetchProvider(enhancedFetchProvider)

    const fetchRes = await ctx.web.fetch({ url: 'https://192.168.1.1' })
    expect(fetchRes.body).toEqual({ kind: 'text', content: 'enhanced-fetched-content' })

    await ctx.fiber.dispose()
  })
})
