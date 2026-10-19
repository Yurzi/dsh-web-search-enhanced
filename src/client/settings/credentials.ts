/**
 * Whether each referenced credential is configured, for the settings page.
 * Reads only while the page observes it, and again when the settings or any
 * credential change; later answers win.
 */
import type { CredentialInfo, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { V2Config } from '../../settings/types.ts'
import { credentialRefs } from './model.ts'

/** Known states by reference; a missing reference has not been described. */
export type CredentialStates = Readonly<Record<string, CredentialInfo>>

export interface CredentialDescriber {
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
}

export class CredentialStatus {
  readonly source: ObservableSnapshot<CredentialStates>
  private readonly store = createSnapshotStore<CredentialStates>({})
  private observers = 0
  private epoch = 0

  constructor(private readonly settings: () => V2Config | undefined, private readonly credentials: CredentialDescriber) {
    this.source = {
      getSnapshot: () => this.store.getSnapshot(),
      subscribe: (listener) => {
        const unsubscribe = this.store.subscribe(listener)
        this.observers += 1
        if (this.observers === 1) this.refresh()
        return () => {
          this.observers -= 1
          unsubscribe()
        }
      },
    }
  }

  /** Describe the current references when someone is looking. */
  refresh(): void {
    if (this.observers === 0) return
    const epoch = ++this.epoch
    void this.credentials.describe(credentialRefs(this.settings() ?? {})).then((result) => {
      // A failed read leaves the last known states; unknown references show no state.
      if (result.ok && epoch === this.epoch) this.store.set(result.value)
    })
  }
}
