/** Wire module of every catalog adapter. */
import type { AdapterId } from '../../catalog.ts'
import { deepseek } from './deepseek.ts'
import { exa } from './exa.ts'
import { firecrawl } from './firecrawl.ts'
import { openalex } from './openalex.ts'
import { semanticscholar } from './semanticscholar.ts'
import { tavily } from './tavily.ts'
import { tinyfish } from './tinyfish.ts'
import type { Adapter } from './types.ts'

export type { Adapter, Auth, McpRoute, SearchInput } from './types.ts'

export const ADAPTER_WIRES: Readonly<Record<AdapterId, Adapter>> = { exa, firecrawl, tavily, tinyfish, deepseek, openalex, semanticscholar }
