/** The `searchConnections` Remote; session authorization is the Session Controller's. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { z } from 'zod'
import {
  providerRequest, selectionChange, selectionRequest,
  type ProviderRequest, type ProviderView, type SelectionChange, type SelectionRequest, type SelectionView,
} from '../remote-contract.ts'
import { SelectionConflict, type SearchSessions, type Selection } from './selections.ts'

/** `get` and `set` read or write exactly the addressed Session, so session access control applies. */
const addressedSession = (request: { readonly sessionId: string }) => request.sessionId as SessionId

export class SearchConnectionsService extends TypertRemoteService {
  constructor(ctx: Context, private readonly sessions: SearchSessions, private readonly providerId: string) {
    super(ctx, 'searchConnections')
  }

  @Remote({ resources: { session: addressedSession } })
  async get(request: SelectionRequest): Promise<SelectionView> {
    const { sessionId } = parse(selectionRequest, request)
    const agent = await this.agent(sessionId)
    return this.view(agent, await this.sessions.current(agent))
  }

  @Remote({ resources: { session: addressedSession } })
  async set(request: SelectionChange): Promise<SelectionView> {
    const { sessionId, connectionId, freshness, expectedRevision } = parse(selectionChange, request)
    const agent = await this.agent(sessionId)
    if (typeof connectionId === 'string' && !this.sessions.selectable(connectionId)) {
      throw new RemoteError('searchConnections/unavailable', 'the search connection is missing or disabled', { connectionId })
    }
    let selection: Selection
    try {
      selection = await this.sessions.change(agent, {
        ...(connectionId === undefined ? {} : { connectionId }),
        ...(freshness === undefined ? {} : { freshness }),
      }, expectedRevision)
    } catch (error) {
      if (error instanceof SelectionConflict) throw new RemoteError('searchConnections/conflict', 'the search selection changed elsewhere; re-read it and retry', {})
      throw error
    }
    return this.view(agent, selection)
  }

  /** No session is involved: the settings page compares these facts with the `web` row it observes. */
  @Remote
  async provider(request: ProviderRequest): Promise<ProviderView> {
    parse(providerRequest, request)
    // ctx.web reads the variable once at startup, from this same process environment.
    return { providerId: this.providerId, envProvider: process.env.DSH_WEB_SEARCH_PROVIDER ?? null }
  }

  private async agent(sessionId: string): Promise<Agent> {
    const found = await this.ctx.sessionController.resolveAgent(sessionId as SessionId)
    if ('error' in found) throw found.error
    return found.agent
  }

  private async view(agent: Agent, selection: Selection): Promise<SelectionView> {
    return { selection, connections: await this.sessions.connections(agent) }
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new RemoteError('gateway/bad-request', 'invalid searchConnections request', { issues: result.error.issues })
  return result.data
}
