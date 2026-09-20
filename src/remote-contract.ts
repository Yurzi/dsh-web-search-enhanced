import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
export const getRequest = z.object({ sessionId: z.string().min(1).max(256) }).strict()
export const setRequest = getRequest.extend({ connectionId: z.string().min(1).max(128).nullable(), expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
export const selectionSchema = z.object({ connectionId: z.string().nullable(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
const responseSchema = z.object({ selection: selectionSchema, freshness: z.enum(['auto', 'fresh', 'realtime']), connections: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(['model', 'structured']), configured: z.boolean(), keyless: z.boolean().optional(), reason: z.string().optional(), credentialRef: z.string().optional() }).strict()) }).strict()
export type SelectionView = z.infer<typeof responseSchema>
/** Explicit client invocation descriptors for our own service, not invented host APIs. */
export const searchContribution: TypertRemoteContribution = {
  package: 'dsh-web-search-enhanced',
  descriptors: (['get', 'set'] as const).map(method => ({
    id: 'dsh-web-search-enhanced:searchConnections/' + method, service: 'searchConnections', namespace: 'searchConnections', method,
    invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'SearchSelectionRequest', schema: method === 'get' ? getRequest : setRequest } }],
    result: { mode: 'strict', typeSymbol: 'SearchSelectionView', schema: responseSchema },
  })),
}
