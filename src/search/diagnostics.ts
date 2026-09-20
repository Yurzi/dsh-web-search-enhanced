import type { Freshness } from '../catalog.ts'
/** Private facts, never extensions to DSH WebSearchResult or Session events. */
export interface FreshnessDiagnostic {
  requested: Freshness
  outcome: 'default' | 'applied' | 'ignored' | 'partial'
  sources: number
  contentSources: number
  /** Parameters and returned snippets cannot prove source freshness. */
  freshnessVerified: false
}
export function freshnessDiagnostic(requested: Freshness, supports: boolean, snippets: readonly (string | undefined)[]): FreshnessDiagnostic {
  const contentSources = snippets.filter(s => Boolean(s?.trim())).length
  return { requested, outcome: requested === 'auto' ? 'default' : !supports ? 'ignored' : contentSources < snippets.length ? 'partial' : 'applied', sources: snippets.length, contentSources, freshnessVerified: false }
}
