/** Model-facing search failures: stable codes, concise English, an actionable hint. */
import { WebError } from '@deepseek-ai/dsh-web'

export type SearchErrorCode =
  | 'WEB_SEARCH_NOT_SELECTED'
  | 'WEB_SEARCH_CONNECTION_INVALID'
  | 'WEB_SEARCH_FOLLOW_UNSUPPORTED'
  | 'WEB_SEARCH_MIGRATION_REQUIRED'
  | 'WEB_SEARCH_CONFIG_INVALID'
  | 'WEB_SEARCH_STORAGE_UNAVAILABLE'
  | 'WEB_SEARCH_CONTEXT_UNAVAILABLE'
  | 'WEB_PROVIDER_CREDENTIAL_MISSING'
  | 'WEB_KEYLESS_UNAVAILABLE'
  | 'WEB_PROVIDER_AUTH_ERROR'
  | 'WEB_PROVIDER_ACCESS_ERROR'
  | 'WEB_PROVIDER_RATE_LIMITED'
  | 'WEB_PROVIDER_TIMEOUT'
  | 'WEB_ABORTED'
  | 'WEB_PROVIDER_ERROR'
  | 'WEB_PROVIDER_RESPONSE_INVALID'

/** Never carries a cause: upstream bodies, abort reasons and transport errors stay out of the message. */
export function searchError(code: SearchErrorCode, message: string): WebError {
  return new WebError(`dsh-web-search-enhanced: ${message}`, code)
}

export const aborted = (): WebError => searchError('WEB_ABORTED', 'search aborted')

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw aborted()
}

/** Race work that takes no signal (credential lookups) against cancellation. */
export function abortable<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return pending
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(aborted()) }
    if (signal.aborted) {
      // The work outlives the cancelled search; its outcome is observed, not reported.
      void pending.catch(() => {})
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}
