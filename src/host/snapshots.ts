/**
 * The search plan of each Agent step, captured when the step's model request
 * starts. Native and code-mode calls of that step search the same way even
 * if the selection, the settings or a provider profile change meanwhile.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebError } from '@deepseek-ai/dsh-web'
import type { Freshness } from '../catalog.ts'
import type { ModelConnection, ResolvedSettings, StructuredConnection } from '../settings/resolve.ts'
import type { FixedModelBinding } from '../settings/types.ts'
import type { RouteDirectory } from './follow-model.ts'
import type { Selection } from './selections.ts'

export type SearchPlan =
  /** The plan could not be captured; a retry of the same step captures again. */
  | { readonly kind: 'failed'; readonly error: WebError }
  | { readonly kind: 'off' }
  /** The selected connection was removed or disabled. */
  | { readonly kind: 'invalid'; readonly connectionId: string }
  | { readonly kind: 'structured'; readonly connection: StructuredConnection; readonly freshness: Freshness }
  | { readonly kind: 'model'; readonly connection: ModelConnection; readonly route: FixedModelBinding }
  /** The session model, resolved per search against this step's route facts. */
  | { readonly kind: 'follow'; readonly connection: ModelConnection; readonly routes: RouteDirectory }

/** @param routes - read only when the selection follows the session model. */
export function planFor(selection: Selection, settings: ResolvedSettings, routes: () => RouteDirectory): SearchPlan {
  if (selection.connectionId === null) return { kind: 'off' }
  const connection = settings.connections.get(selection.connectionId)
  if (connection === undefined || connection.disabled) return { kind: 'invalid', connectionId: selection.connectionId }
  if (connection.kind === 'structured') return { kind: 'structured', connection, freshness: selection.freshness }
  if (connection.route === 'session') return { kind: 'follow', connection, routes: routes() }
  return { kind: 'model', connection, route: connection.route }
}

export class Snapshots {
  private readonly steps = new WeakMap<Agent, { readonly turn: number; readonly step: number; readonly plan: SearchPlan }>()

  async capture(agent: Agent, turn: number, step: number, plan: () => Promise<SearchPlan>): Promise<void> {
    const previous = this.steps.get(agent)
    if (previous !== undefined && previous.turn === turn && previous.step === step && previous.plan.kind !== 'failed') return
    this.steps.set(agent, { turn, step, plan: await plan() })
  }

  get(agent: Agent): SearchPlan | undefined {
    return this.steps.get(agent)?.plan
  }

  forget(agent: Agent): void {
    this.steps.delete(agent)
  }
}