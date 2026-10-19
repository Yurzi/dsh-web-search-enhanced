/** Per-session connection list: how each would authenticate and whether it can serve now. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { ADAPTERS, honorsFreshness } from '../catalog.ts'
import type { ConnectionView } from '../remote-contract.ts'
import type { Connection, ResolvedSettings } from '../settings/resolve.ts'
import { ACCOUNT_PROVIDER, captureRoutes, followRoute, nextModel } from './follow-model.ts'

/** Judged from local facts only: `ready` never proves upstream access, quota or health. */
export async function describeConnections(ctx: Context, settings: ResolvedSettings, agent: Agent): Promise<ConnectionView[]> {
  const model = nextModel(ctx, agent)
  const account = model?.provider === ACCOUNT_PROVIDER ? ctx.get('deepseekAccount') : undefined
  const credentials = ctx.get('credentials')

  const withKey = async (connection: Connection, ref: string): Promise<ConnectionView> => {
    const configured = !connection.disabled && (await credentials?.describe(credentialRef(ref)))?.configured === true
    return { ...base(connection), access: 'api-key', credentialRef: ref, status: connection.disabled ? 'disabled' : configured ? 'ready' : 'needs-credential' }
  }

  return Promise.all([...settings.connections.values()].map(async (connection): Promise<ConnectionView> => {
    if (connection.kind === 'structured') {
      if (connection.access === 'keyless') return { ...base(connection), access: 'keyless', status: connection.disabled ? 'disabled' : 'ready' }
      const signedIn = !connection.disabled && account !== undefined && ADAPTERS[connection.adapter].account
        && await account.resolveToken(connection.endpoint) !== undefined
      return signedIn ? { ...base(connection), access: 'account', status: 'ready' } : withKey(connection, connection.credentialRef)
    }
    if (connection.route !== 'session') return withKey(connection, connection.route.credentialRef)
    const follow = followRoute(captureRoutes(ctx), model)
    if (follow.kind === 'route') return withKey(connection, follow.route.credentialRef)
    return { ...base(connection), access: 'api-key', status: connection.disabled ? 'disabled' : 'unsupported', detail: follow.detail }
  }))
}

function base(connection: Connection): Pick<ConnectionView, 'id' | 'label' | 'kind' | 'freshness'> {
  const { id, label, kind } = connection
  // Model search has no cache controls; structured adapters honor them per access mode.
  return { id, label, kind, freshness: connection.kind === 'structured' && honorsFreshness(connection.adapter, connection.access) }
}