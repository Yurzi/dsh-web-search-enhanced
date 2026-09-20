import { describe, expect, it, vi } from 'vitest'
import { Config, DEFAULT_API_KEY_ENV, DEFAULT_PROVIDER_ID, inject, name, resolveConfig, resolveSettings } from '../src/index.ts'
import { ExecutionContexts } from '../src/dsh/execution-context.ts'
import { executeSearch } from '../src/search/service.ts'
import type { FixedBinding } from '../src/config.ts'
const fixed: FixedBinding = { mode: 'fixed', model: 'fixed-search', protocol: 'openai-responses', baseURL: 'https://model.example/v1', credentialRef: 'MODEL_API' }
function snapshot(id: string, freshness: 'auto'|'fresh'|'realtime' = 'auto') {
  return new ExecutionContexts().capture({}, 'session', 1, 1, {connectionId:id,revision:0}, resolveSettings({freshness, connections:{'custom:model':{kind:'model',label:'Fixed',binding:fixed,trustedEndpoint:true}}}))
}
const modelResponse = () => new Response(JSON.stringify({output:[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://source.test'}]}}]}))
describe('V2 host and model contracts', () => {
 it('exports one stable provider and an unmaterialized schema', () => {
  expect(name).toBe('web-search-enhanced');expect(inject).toEqual(['web']);expect(DEFAULT_PROVIDER_ID).toBe('enhanced-search')
  expect(Config({})).toEqual({connections:{}});expect(resolveConfig({}).apiKeyEnv).toBe(DEFAULT_API_KEY_ENV)
 })
 it('preserves checked-in protocol-specific identifiers', () => {
  expect(resolveConfig({}).toolIdentifier).toBe('web_search_20260209')
  expect(resolveConfig({protocol:'openai-responses'}).toolIdentifier).toBe('web_search')
  expect(resolveConfig({protocol:'openai-chat-completions'}).toolIdentifier).toBe('web_search_options')
 })
 it('fixed model ignores a different actual conversation binding', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => modelResponse()); const resolve = vi.fn(async ()=>'fixture-key')
  await executeSearch(snapshot('custom:model'),{query:'q'},resolve,undefined,{...fixed,model:'chat',credentialRef:'CHAT_API'},fetcher)
  expect(resolve).toHaveBeenCalledWith('MODEL_API')
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).model).toBe('fixed-search')
 })
 it('follows a complete explicit nonsecret binding using the SAME adapter', async () => {
  const fetcher = vi.fn<typeof fetch>(async ()=>modelResponse()), resolve = vi.fn(async ()=>'fixture-key')
  await executeSearch(snapshot('builtin:session-model'),{query:'q'},resolve,undefined,fixed,fetcher)
  expect(resolve).toHaveBeenCalledWith('MODEL_API');expect(fetcher.mock.calls[0]?.[0]).toBe('https://model.example/v1/responses')
 })
 it('rejects unprovable follow binding instead of falling back to live settings/defaults', async () => {
  const fetcher = vi.fn<typeof fetch>(), resolve = vi.fn(async ()=>'fixture-key')
  await expect(executeSearch(snapshot('builtin:session-model'),{query:'q'},resolve,undefined,undefined,fetcher)).rejects.toMatchObject({code:'WEB_SEARCH_FOLLOW_UNSUPPORTED'})
  expect(fetcher).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled()
 })
 it('resolves credentials per operation; revocation never selects another key', async () => {
  const resolve = vi.fn().mockResolvedValueOnce('fixture-key').mockResolvedValueOnce(undefined)
  const fetcher = vi.fn<typeof fetch>(async()=>modelResponse())
  await executeSearch(snapshot('custom:model'),{query:'a'},resolve,undefined,undefined,fetcher)
  await expect(executeSearch(snapshot('custom:model'),{query:'b'},resolve,undefined,undefined,fetcher)).rejects.toMatchObject({code:'WEB_PROVIDER_CREDENTIAL_MISSING'})
  expect(resolve.mock.calls).toEqual([['MODEL_API'],['MODEL_API']]); expect(fetcher).toHaveBeenCalledTimes(1)
 })
 it('cancels while credentials are unresolved without retaining secret causes', async () => {
  const controller = new AbortController()
  const pending = executeSearch(snapshot('custom:model'),{query:'q'},()=>new Promise(()=>{}),controller.signal)
  controller.abort('sensitive reason')
  const error = await pending.catch(error => error)
  expect(error.code).toBe('WEB_ABORTED'); expect(error.cause).toBeUndefined(); expect(error.message).not.toContain('sensitive reason')
 })
 it('fails deleted selections explicitly and never guesses another connection', async () => {
  await expect(executeSearch(snapshot('custom:deleted'),{query:'q'},async()=>undefined)).rejects.toMatchObject({code:'WEB_SEARCH_CONNECTION_INVALID'})
 })
 it('ignores unsupported freshness without changing the preference', async () => {
  const s = snapshot('custom:model','realtime');const fetcher = vi.fn<typeof fetch>(async()=>modelResponse())
  await executeSearch(s,{query:'q'},async ()=>'fixture-key',undefined,undefined,fetcher)
  expect(s.freshness).toBe('realtime');expect(JSON.stringify(fetcher.mock.calls)).not.toContain('maxAge')
 })
 it('caps model sources and sanitizes hostile upstream errors', async () => {
  const result = await executeSearch(snapshot('custom:model'),{query:'q',maxResults:0},async ()=>'fixture-key',undefined,undefined,vi.fn())
  expect(result.sources).toEqual([])
  await expect(executeSearch(snapshot('custom:model'),{query:'q'},async ()=>'fixture-key',undefined,undefined,async()=>{throw new Error('fixture-key private query')})).rejects.not.toThrow('fixture-key')
 })
})
