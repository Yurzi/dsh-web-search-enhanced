/** DSH integration: the web_search provider, step snapshots, selections and the Remote. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { WebError, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import { abortable, searchError } from '../search/errors.ts'
import { executeSearch, type SearchDeps, type SearchTarget } from '../search/execute.ts'
import type { ModelConnection, ResolvedSettings } from '../settings/resolve.ts'
import type { FixedModelBinding } from '../settings/types.ts'
import { ACCOUNT_PROVIDER, captureRoutes, followRoute, requestModel, type RouteDirectory } from './follow-model.ts'
import { Pairings } from './pairings.ts'
import { SearchConnectionsService } from './remote.ts'
import { SearchRestriction } from './restriction.ts'
import { SearchSessions } from './selections.ts'
import { planFor, Snapshots, type SearchPlan } from './snapshots.ts'
import { SearchStorage } from './storage.ts'

/**
 * The native DeepSeek search provider's id, registered by default. The shipped
 * `web` row already selects it, so the bundle patch disables the native row and
 * leaves the shared `web` row (and with it `fetchProvider`) untouched.
 */
export const DEFAULT_PROVIDER_ID = 'deepseek-official'

/** Provider ids: a letter or digit, then up to 127 letters, digits, dots, underscores or hyphens. */
export const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

/** @param providerId - the id registered in `ctx.web`; `web.searchProvider` must select it. */
export function installSearch(ctx: Context, settings: () => ResolvedSettings, providerId: string): void {
  const storage = new SearchStorage(ctx)
  const restriction = new SearchRestriction(ctx)
  const sessions = new SearchSessions(ctx, settings, storage, new Pairings(storage), restriction)
  const snapshots = new Snapshots()

  const capture = async (agent: Agent, signal: AbortSignal): Promise<SearchPlan> => {
    try {
      const current = settings()
      return planFor(await abortable(sessions.current(agent), signal), current, () => captureRoutes(ctx))
    } catch (error) {
      if (error instanceof WebError) return { kind: 'failed', error }
      ctx.logger.warn('web-search-enhanced: capturing the search selection failed: %s', error instanceof Error ? error.message : String(error))
      return { kind: 'failed', error: searchError('WEB_SEARCH_CONTEXT_UNAVAILABLE', 'the search selection could not be read; retry the request') }
    }
  }

  // Capture never fails the request: ordinary chat continues and only web_search reports the failure.
  ctx.on('agent/request', async ({ agent, turn, step, signal }, next) => {
    await snapshots.capture(agent, turn, step, () => capture(agent, signal))
    return next()
  })
  // Apply a stored "off" selection before the first request lists tools; creation awaits this listener.
  ctx.on('agent/created', async ({ agent }) => {
    try {
      await sessions.current(agent)
    } catch (error) {
      // Unavailable storage must not fail Agent creation; each request captures again.
      ctx.logger.debug('web-search-enhanced: selection not applied at Agent creation: %s', error instanceof Error ? error.message : String(error))
    }
  })
  ctx.on('agent/disposed', ({ agent }) => {
    snapshots.forget(agent)
    restriction.forget(agent)
  })

  ctx.inject(['sessionController', 'typert'], remoteCtx => { new SearchConnectionsService(remoteCtx, sessions, providerId) })

  ctx.web.registerSearchProvider({
    id: providerId,
    available: () => true,
    async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
      // Native and code-mode calls both run under the Agent whose step requested them.
      const agent = ctx.get('agents')?.currentInitiator()
      const plan = agent === undefined ? undefined : snapshots.get(agent)
      if (agent === undefined || plan === undefined) {
        throw searchError('WEB_SEARCH_CONTEXT_UNAVAILABLE', 'web search runs only inside a session\'s model request; retry from the conversation')
      }
      return executeSearch(targetOf(plan, agent), request, depsFor(ctx, agent), signal)
    },
  })
}

function targetOf(plan: SearchPlan, agent: Agent): SearchTarget {
  switch (plan.kind) {
    case 'failed': throw plan.error
    case 'off': throw searchError('WEB_SEARCH_NOT_SELECTED', 'web search is off for this session; the user can choose a search connection in the composer or with /setup-search')
    case 'invalid': throw searchError('WEB_SEARCH_CONNECTION_INVALID', `the selected search connection "${plan.connectionId}" was removed or disabled; ask the user to choose another one`)
    case 'structured': return { kind: 'structured', connection: plan.connection, freshness: plan.freshness }
    case 'model': return modelTarget(plan.connection, plan.route)
    case 'follow': return modelTarget(plan.connection, sessionRoute(plan.routes, agent))
  }
}

function modelTarget(connection: ModelConnection, route: FixedModelBinding): SearchTarget {
  return { kind: 'model', label: connection.label, route, options: connection.options[route.protocol] ?? {} }
}

/** The route of the model serving the request that called the search, from the step's route facts. */
function sessionRoute(routes: RouteDirectory, agent: Agent): FixedModelBinding {
  const follow = followRoute(routes, requestModel(agent))
  if (follow.kind === 'unsupported') {
    throw searchError('WEB_SEARCH_FOLLOW_UNSUPPORTED', `searching with the session model is unavailable: ${follow.detail}; ask the user to choose another search connection`)
  }
  return follow.route
}

function depsFor(ctx: Context, agent: Agent): SearchDeps {
  const account = agent.session.requestContext()?.provider === ACCOUNT_PROVIDER ? ctx.get('deepseekAccount') : undefined
  return {
    credential: async ref => (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value,
    accountToken: account === undefined ? undefined : endpoint => account.resolveToken(endpoint),
  }
}