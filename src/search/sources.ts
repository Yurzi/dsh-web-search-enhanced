/** Normalization of untrusted search rows into DSH sources. */
import type { WebSearchSource } from '@deepseek-ai/dsh-web'

const MAX_URL_LENGTH = 8192
const MAX_TITLE_LENGTH = 1000
/** Also the per-source text budget requested from services that return page text. */
export const MAX_SNIPPET_LENGTH = 4000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A trimmed, non-empty string; anything else is absent. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** A calendar date or timestamp normalized to ISO 8601; free-form dates ("2 hours ago") are dropped. */
export function isoDate(value: unknown): string | undefined {
  const date = text(value)
  if (date === undefined || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.test(date)) return undefined
  const time = Date.parse(date)
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

/** Untrusted row fields; `url` is required for the row to count. */
export interface SourceFields {
  readonly url?: unknown
  readonly title?: unknown
  readonly snippet?: unknown
  readonly publishedAt?: unknown
}

type Source = { url: string; title?: string; snippet?: string; publishedAt?: string }

/**
 * Sources in arrival order. Rows without a public http(s) URL are dropped, and
 * a repeated URL only fills fields the first occurrence lacked.
 */
export class SourceList {
  private readonly byUrl = new Map<string, Source>()

  add(fields: SourceFields): void {
    const url = publicUrl(fields.url)
    if (url === undefined) return
    const title = text(fields.title)?.slice(0, MAX_TITLE_LENGTH)
    const snippet = text(fields.snippet)?.slice(0, MAX_SNIPPET_LENGTH)
    const publishedAt = isoDate(fields.publishedAt)
    const source = this.byUrl.get(url.href) ?? { url: url.raw }
    if (source.title === undefined && title !== undefined) source.title = title
    if (source.snippet === undefined && snippet !== undefined) source.snippet = snippet
    if (source.publishedAt === undefined && publishedAt !== undefined) source.publishedAt = publishedAt
    this.byUrl.set(url.href, source)
  }

  get sources(): WebSearchSource[] {
    return [...this.byUrl.values()]
  }
}

/** Map every object row through `fields`; other rows are dropped. */
export function collect(rows: readonly unknown[], fields: (row: Record<string, unknown>) => SourceFields): WebSearchSource[] {
  const list = new SourceList()
  for (const row of rows) if (isRecord(row)) list.add(fields(row))
  return list.sources
}

/** Up to five author names as `[Authors: …]`, for scholarly snippets. */
export function authors(value: unknown, name: (item: Record<string, unknown>) => unknown): string | undefined {
  const names = (Array.isArray(value) ? value : []).filter(isRecord).map(item => text(name(item))).filter(item => item !== undefined).slice(0, 5)
  return names.length === 0 ? undefined : `[Authors: ${names.join(', ')}]`
}

/** Join the present snippet parts with spaces. */
export function summary(parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter(part => part !== undefined)
  return present.length === 0 ? undefined : present.join(' ')
}

function publicUrl(value: unknown): { raw: string; href: string } | undefined {
  const raw = text(value)
  if (raw === undefined || raw.length > MAX_URL_LENGTH || !URL.canParse(raw)) return undefined
  const url = new URL(raw)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') return undefined
  return { raw, href: url.href }
}