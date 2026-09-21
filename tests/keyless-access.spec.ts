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
  it('Tavily keyless sends only its access-mode header and preserves search options',async()=>{
    const credentials=vi.fn(async()=> 'must-not-read')
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({results:[{url:'https://example.org',title:'Example',content:'evidence'}]}))
    const settings=resolveSettings({connections:{'builtin:tavily':{options:{search_depth:'advanced',topic:'news'}}}})
    const s=new ExecutionContexts().capture({},'s',1,1,{connectionId:'builtin:tavily',revision:0},settings)
    const diagnose=vi.fn()
    const result=await executeSearch(s,{query:'public',maxResults:3},credentials,undefined,undefined,fetcher,diagnose)
    expect(result.sources[0]?.snippet).toBe('evidence')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.tavily.com/search')
    const init=fetcher.mock.calls[0]?.[1], headers=new Headers(init?.headers)
    expect(headers.get('x-tavily-access-mode')).toBe('keyless')
    expect(headers.has('authorization')).toBe(false);expect(headers.has('x-api-key')).toBe(false)
    expect(JSON.parse(String(init?.body))).toMatchObject({query:'public',max_results:3,search_depth:'advanced',topic:'news',include_answer:false,include_raw_content:false})
    expect(credentials).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['tavily','tinyfish'] as const)('%s personal mode uses Credentials and never sends keyless headers',async adapter=>{
    const credentials=vi.fn(async()=> 'fixture-key')
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({results:[]}))
    await executeSearch(snapshot('builtin:'+adapter,'api-key'),{query:'public'},credentials,undefined,undefined,fetcher)
    const [url,init]=fetcher.mock.calls[0]!, headers=new Headers(init?.headers)
    expect(String(url)).toContain(adapter==='tavily'?'https://api.tavily.com/search':'https://api.search.tinyfish.ai/')
    expect(headers.get(adapter==='tavily'?'authorization':'x-api-key')).toBe(adapter==='tavily'?'Bearer fixture-key':'fixture-key')
    expect(headers.has('x-tavily-access-mode')).toBe(false);expect(headers.has('x-tinyfish-access-mode')).toBe(false)
    expect(credentials).toHaveBeenCalledWith(adapter==='tavily'?'TAVILY_API_KEY':'TINYFISH_API_KEY')
  })
  it.each(['tavily','tinyfish'] as const)('%s keyless failures never read a personal key or retry',async adapter=>{
    for(const status of [401,403,429,500]) {
      const credentials=vi.fn(async()=> 'paid-secret')
      const fetcher=vi.fn<typeof fetch>(async()=>new Response('private upstream body',{status}))
      const error=await executeSearch(snapshot('builtin:'+adapter),{query:'private query'},credentials,undefined,undefined,fetcher).catch(e=>e)
      expect(error).toBeInstanceOf(Error);expect(error.message).not.toMatch(/private|paid-secret/)
      if(status===429) expect(error.code).toBe('WEB_PROVIDER_RATE_LIMITED')
      if(status===401 || status===403) expect(error.code).toBe('WEB_KEYLESS_UNAVAILABLE')
      expect(credentials).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it('rejects keyless REST with a personal key, including Tinyfish REST',async()=>{
    const fetcher=vi.fn<typeof fetch>()
    for(const [adapter,endpoint] of [['tavily','https://api.tavily.com/search'],['tinyfish','https://api.search.tinyfish.ai']] as const) {
      await expect(searchStructured(adapter,{query:'q'},{endpoint},{freshness:'auto',keyless:true,apiKey:'secret',fetcher})).rejects.toThrow()
    }
    await expect(searchStructured('tinyfish',{query:'q'},{endpoint:'https://api.search.tinyfish.ai'},{freshness:'auto',keyless:true,fetcher})).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('defaults supported builtins to keyless and rejects unknown access modes',()=>{
    const settings=resolveSettings()
    expect(settings.connections['builtin:exa']?.keyless).toBe(true)
    expect(settings.connections['builtin:firecrawl']?.keyless).toBe(true)
    expect(settings.connections['builtin:tinyfish']?.keyless).toBe(true)
    expect(settings.connections['builtin:tavily']?.keyless).toBe(true)
    expect(settings.connections['builtin:openalex']?.keyless).toBe(true)
    expect(settings.connections['builtin:semanticscholar']?.keyless).toBe(false)
    expect(settings.connections['builtin:semanticscholar']?.access).toBe('api-key')
    expect(()=>resolveSettings({connections:{'builtin:tinyfish':{options:{domain_type:'research_paper'}}}})).toThrow('API Key mode')
    expect(()=>resolveSettings({connections:{'builtin:tinyfish':{access:'api-key',options:{domain_type:'research_paper'}}}})).not.toThrow()
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
  it('anonymous OpenAlex uses official REST, no Credentials, and safe response normalization',async()=>{
    const credentials=vi.fn(async()=> 'should-never-be-read')
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({results:[{id:'https://openalex.org/W1',title:'OpenAlex Paper',abstract_inverted_index:{Test:[0]}}]}))
    const r=await executeSearch(snapshot('builtin:openalex'),{query:'public'},credentials,undefined,undefined,fetcher)
    expect(r.sources).toHaveLength(1);expect(credentials).not.toHaveBeenCalled()
    expect(fetcher.mock.calls[0]?.[0]).toContain('https://api.openalex.org/works')
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
