import { describe, expect, it, vi } from 'vitest'
import { resolveSettings } from '../src/config.ts'
import { executeSearch } from '../src/search/service.ts'
import { ExecutionContexts } from '../src/dsh/execution-context.ts'
import { searchStructured } from '../src/adapters/structured.ts'
function snapshot(id: string, access?: string) {
  const settings=resolveSettings(access ? {connections:{[id]:{access}}} : {})
  return new ExecutionContexts().capture({},'s',1,1,{connectionId:id,revision:0},settings)
}
describe('explicit keyless and personal API modes',()=>{
  it('defaults only Exa and Firecrawl to keyless and rejects unknown access modes',()=>{
    const settings=resolveSettings()
    expect(settings.connections['builtin:exa']?.keyless).toBe(true)
    expect(settings.connections['builtin:firecrawl']?.keyless).toBe(true)
    expect(settings.connections['builtin:tinyfish']?.keyless).toBe(false)
    expect(()=>resolveSettings({connections:{'builtin:tavily':{access:'keyless'}}})).toThrow()
    expect(()=>resolveSettings({connections:{'builtin:exa':{access:'auto'}}})).toThrow()
  })
  it('keyless Firecrawl uses official REST, no Credentials, and safe response normalization',async()=>{
    const credentials=vi.fn(async()=> 'should-never-be-read')
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({success:true,data:{web:[{url:'https://example.org',title:'Example',description:'evidence'}]}}))
    const r=await executeSearch(snapshot('builtin:firecrawl'),{query:'public'},credentials,undefined,undefined,fetcher)
    expect(r.sources).toHaveLength(1);expect(credentials).not.toHaveBeenCalled()
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.firecrawl.dev/v2/search')
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false)
  })
  it('reports Firecrawl keyless IP denial without leaking body or trying a paid key',async()=>{
    const credentials=vi.fn(async()=> 'paid-secret')
    const fetcher=vi.fn<typeof fetch>(async()=>new Response('sensitive upstream body',{status:403}))
    const error=await executeSearch(snapshot('builtin:firecrawl'),{query:'public'},credentials,undefined,undefined,fetcher).catch(e=>e)
    expect(error.code).toBe('WEB_KEYLESS_UNAVAILABLE');expect(error.message).not.toContain('sensitive')
    expect(credentials).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce()
  })
  it('personal mode never falls back to keyless on missing key or rate limits',async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(null,{status:429}))
    const s=snapshot('builtin:exa','api-key')
    await expect(executeSearch(s,{query:'public'},async()=>undefined,undefined,undefined,fetcher)).rejects.toMatchObject({code:'WEB_PROVIDER_CREDENTIAL_MISSING'})
    expect(fetcher).not.toHaveBeenCalled()
    await expect(executeSearch(s,{query:'public'},async()=> 'fixture-key',undefined,undefined,fetcher)).rejects.toMatchObject({code:'WEB_PROVIDER_RATE_LIMITED'})
    expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.exa.ai/search')
  })
  it('anonymous REST cannot target a custom endpoint or another provider',async()=>{
    const fetcher=vi.fn<typeof fetch>()
    for(const adapter of ['firecrawl','tavily'] as const) await expect(searchStructured(adapter,{query:'q'},{endpoint:'https://untrusted.invalid/search'},{freshness:'auto',keyless:true,fetcher})).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps Firecrawl freshness in anonymous REST and rejects unsupported Exa keyless options',async()=>{
    expect(()=>resolveSettings({connections:{'builtin:exa':{options:{type:'fast'}}}})).toThrow('API Key mode')
    expect(()=>resolveSettings({connections:{'builtin:exa':{access:'api-key',options:{type:'fast'}}}})).not.toThrow()
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({success:true,data:{web:[]}}))
    await searchStructured('firecrawl',{query:'q'},{endpoint:'https://api.firecrawl.dev/v2/search'},{freshness:'realtime',keyless:true,fetcher})
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).scrapeOptions.maxAge).toBe(0)
  })
})
