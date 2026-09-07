/** Delivers explicit View selections to the framework-owned Session store without mirroring its value. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Selection {
  owner: Owner
  target: string
  eligible: () => boolean
}
interface Owner {
  source: SessionBinding
  write?: (target: string) => void
  disposeScope: () => void
}

/** One pending command and mount-bound writers; neither is selected-view state. */
export class ConversationViewNavigation {
  private readonly owners = new Map<SessionBinding, Owner>()
  private pending: Selection | undefined
  private active = true

  /**
   * @param ctx - owning plugin lifetime.
   * @param sessions - current selection and binding authority.
   */
  constructor(ctx: Context, private readonly sessions: ISessions) {
    ctx.effect(() => {
      const unsubscribe = sessions.list.subscribe(() => { this.refresh() })
      return () => {
        this.active = false
        this.pending = undefined
        unsubscribe()
        for (const owner of [...this.owners.values()]) this.drop(owner, true)
      }
    }, 'ui-conversation: View command delivery')
  }

  /**
   * Deliver to the current owner or retain the latest command until its first committed mount.
   * @param source - current Session binding generation.
   * @param target - installed eligible View id.
   * @param eligible - rechecks the live roster and blank-session eligibility before delivery.
   */
  select(source: SessionBinding, target: string, eligible: () => boolean): void {
    if (!this.active || !this.current(source)) throw new Error('ui-conversation: View selection requires the current Session binding')
    if (!eligible()) throw new Error(`ui-conversation: View "${target}" is not installed or eligible for this Session`)
    const owner = this.owner(source)
    this.pending = { owner, target, eligible }
    this.deliver(owner)
  }

  /**
   * Bind the actual declared store action for a committed Conversation body.
   * @param source - renderer-bound Session generation.
   * @param write - selection action closed over the framework-owned store instance.
   * @returns identity-safe unbind; unmount cancels undelivered commands for this owner.
   */
  bind(source: SessionBinding, write: (target: string) => void): () => void {
    if (!this.active || this.sessions.binding(source.sessionId) !== source) return () => {}
    const owner = this.owner(source)
    owner.write = write
    this.deliver(owner)
    return () => {
      if (this.owners.get(source) !== owner || owner.write !== write) return
      this.drop(owner, true)
    }
  }

  /**
   * Cancel an older undelivered command when an owner handles a newer navigation gesture.
   * @param id - addressed Session.
   */
  cancel(id: SessionId): void {
    if (this.pending?.owner.source.sessionId !== id) return
    this.drop(this.pending.owner, true)
  }

  /** Discard commands invalidated by current Session, binding generation, or View roster changes. */
  refresh(): void {
    if (this.pending !== undefined && (!this.current(this.pending.owner.source) || !this.pending.eligible())) {
      const { owner } = this.pending
      this.pending = undefined
      if (owner.write === undefined) this.drop(owner, true)
    }
  }

  private current(source: SessionBinding): boolean {
    return this.sessions.list.getSnapshot().current === source.sessionId && this.sessions.binding(source.sessionId) === source
  }

  private owner(source: SessionBinding): Owner {
    const existing = this.owners.get(source)
    if (existing !== undefined) return existing
    const owner: Owner = { source, disposeScope: () => { void dispose() } }
    this.owners.set(source, owner)
    const dispose = source.ctx.effect(() => () => { this.drop(owner, false) }, 'ui-conversation: View command owner')
    return owner
  }

  private deliver(owner: Owner): void {
    this.refresh()
    const pending = this.pending
    if (pending?.owner !== owner || owner.write === undefined) return
    this.pending = undefined
    owner.write(pending.target)
  }

  private drop(owner: Owner, disposeScope: boolean): void {
    if (this.owners.get(owner.source) !== owner) return
    this.owners.delete(owner.source)
    if (this.pending?.owner === owner) this.pending = undefined
    delete owner.write
    if (disposeScope) owner.disposeScope()
  }
}
