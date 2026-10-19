/**
 * Bounded HTTP transport shared by the REST adapters, model search and the MCP
 * client: redirects are rejected, bodies are capped at 2 MiB, one operation
 * gets 90 s, and failures never carry upstream bodies.
 */
import { aborted, searchError } from './errors.ts'

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const TIMEOUT_MS = 90_000

export interface HttpRequest {
  readonly url: string
  readonly method: 'GET' | 'POST'
  readonly headers: Readonly<Record<string, string>>
  /** JSON body; GET requests carry none. */
  readonly body?: unknown
}

/** Who answers a request, as named by model-facing errors. */
export interface Upstream {
  readonly label: string
  readonly access: 'keyless' | 'api-key' | 'account'
}

/**
 * Run one search operation under the caller's signal and the operation deadline.
 * Every request and body read inside `operation` must use the signal it receives.
 */
export async function withDeadline<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new AbortController()
  const timer = setTimeout(() => { deadline.abort() }, TIMEOUT_MS)
  const fused = signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal])
  try {
    return await operation(fused)
  } catch (error) {
    if (signal?.aborted) throw aborted()
    if (deadline.signal.aborted) {
      throw searchError('WEB_PROVIDER_TIMEOUT', `no response within ${TIMEOUT_MS / 1000} s; retry later or choose another search connection`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Send one request; a non-2xx status fails without reading the body. */
export async function send(request: HttpRequest, signal: AbortSignal, upstream: Upstream): Promise<Response> {
  let response: Response
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      redirect: 'error',
      signal,
    })
  } catch {
    signal.throwIfAborted()
    throw searchError('WEB_PROVIDER_ERROR', `${upstream.label} could not be reached (network failure, or a redirect, which is never followed); retry later or choose another search connection`)
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    throw statusError(response.status, upstream)
  }
  return response
}

function statusError(status: number, { label, access }: Upstream) {
  if (status === 401 || status === 403) {
    if (access === 'keyless') return searchError('WEB_KEYLESS_UNAVAILABLE', `${label} refused anonymous access from this network (HTTP ${status}); ask the user to add a personal API key for it or choose another search connection`)
    if (access === 'account') return searchError('WEB_PROVIDER_AUTH_ERROR', `${label} rejected the DeepSeek account sign-in (HTTP ${status}); ask the user to sign in to DeepSeek again`)
    return searchError('WEB_PROVIDER_AUTH_ERROR', `${label} rejected the API key (HTTP ${status}); ask the user to check the key in the search connection settings`)
  }
  if (status === 402) return searchError('WEB_PROVIDER_ACCESS_ERROR', `${label} refused the request (HTTP 402); the account may lack credit or access to this API`)
  if (status === 429) return searchError('WEB_PROVIDER_RATE_LIMITED', `${label} is rate limiting requests (HTTP 429); retry later or choose another search connection`)
  return searchError('WEB_PROVIDER_ERROR', `${label} failed (HTTP ${status}); retry later or choose another search connection`)
}

/**
 * Read a body as UTF-8 text chunks within the size cap. Aborting `signal`
 * cancels the reader, which also settles a read the transport left pending.
 */
export async function* readText(response: Response, signal: AbortSignal): AsyncGenerator<string, void, undefined> {
  if (response.body === null) return
  const reader = response.body.getReader()
  const cancel = (): void => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const decoder = new TextDecoder()
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw tooLarge()
    for (;;) {
      const { done, value } = await read(reader, signal)
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw tooLarge()
      yield decoder.decode(value, { stream: true })
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

/** One body read; a broken stream (socket, decompression) fails without its cause. */
async function read(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  let result: ReadableStreamReadResult<Uint8Array>
  try {
    result = await reader.read()
  } catch {
    signal.throwIfAborted()
    throw searchError('WEB_PROVIDER_ERROR', 'the search response broke off while it was read; retry later or choose another search connection')
  }
  signal.throwIfAborted()
  return result
}

export async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  let text = ''
  for await (const chunk of readText(response, signal)) text += chunk
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalidResponse('a body that is not JSON')
  }
}

export async function requestJson(request: HttpRequest, signal: AbortSignal, upstream: Upstream): Promise<unknown> {
  return readJson(await send(request, signal, upstream), signal)
}

export function invalidResponse(detail: string) {
  return searchError('WEB_PROVIDER_RESPONSE_INVALID', `the search service returned ${detail}`)
}

const tooLarge = () => searchError('WEB_PROVIDER_ERROR', `the search response exceeds ${MAX_RESPONSE_BYTES / 1024 / 1024} MiB; narrow the query or choose another search connection`)