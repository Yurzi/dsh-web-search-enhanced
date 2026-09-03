import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProvider } from '../src/index.ts'

let seen: string[] = []
let server: Server
let serverUrl: string

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url ?? ''}`)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://proxied.example.com' }] },
      ],
    }))
  })
  const a = await new Promise<AddressInfo>((r) => { server.listen(0, '127.0.0.1', () => { r(server.address() as AddressInfo) }) })
  serverUrl = `http://127.0.0.1:${String(a.port)}`
})
afterAll(async () => { await new Promise<void>((r) => { server.close(() => { r() }) }) })

describe('enhanced search egress', () => {
  it('dispatches outbound search through the target endpoint via standard fetch', async () => {
    seen = []
    const provider = createProvider({
      apiKey: 'test-key',
      baseURL: serverUrl,
      protocol: 'anthropic-messages',
    })
    const result = await provider.search({ query: 'probe' })
    expect(result.sources).toEqual([{ url: 'https://proxied.example.com' }])
    expect(seen).toEqual(['POST /v1/messages'])
  })
})
