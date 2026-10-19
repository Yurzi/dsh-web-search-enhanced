/**
 * Model → connection preference: choosing a connection pairs it with the
 * session's model, and new sessions on that model start with it.
 */
import type { SessionModel } from './follow-model.ts'
import type { SearchStorage } from './storage.ts'

const keyOf = ({ provider, model }: SessionModel): string => JSON.stringify([provider, model])

export class Pairings {
  constructor(private readonly storage: SearchStorage) {}

  /** @returns the paired connection id, `null` for search off, or undefined without a pairing. */
  async get(model: SessionModel): Promise<string | null | undefined> {
    return (await this.storage.domain()).table('pairings').get(keyOf(model))?.connectionId
  }

  async set(model: SessionModel, connectionId: string | null): Promise<void> {
    await (await this.storage.domain()).table('pairings').put(keyOf(model), { connectionId })
  }
}
