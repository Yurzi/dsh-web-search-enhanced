/** While a session's search is off, its Agent does not see web_search. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

export class SearchRestriction {
  private readonly lifts = new Map<Agent, () => void>()

  constructor(private readonly ctx: Context) {
    ctx.effect(() => () => {
      for (const lift of this.lifts.values()) lift()
      this.lifts.clear()
    }, 'web-search-enhanced web_search restriction')
  }

  sync(agent: Agent, connectionId: string | null): void {
    const lift = this.lifts.get(agent)
    if (connectionId !== null) {
      this.lifts.delete(agent)
      lift?.()
      return
    }
    // A composition without the web tool has nothing to restrict.
    if (lift !== undefined || this.ctx.get('tools')?.get('web_search') === undefined) return
    this.lifts.set(agent, agent.ctx.tools.restrict({ deny: ['web_search'] }))
  }

  /** The Agent's scope owns its restriction and has released it. */
  forget(agent: Agent): void {
    this.lifts.delete(agent)
  }
}
