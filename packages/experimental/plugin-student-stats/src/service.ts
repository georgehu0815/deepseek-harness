/**
 * The `studentStats` service: tracks live agent sessions and answers activity
 * queries. Published on `ctx.studentStats` by the package's plugin.
 * @module @deepseek-ai/dsh-experimental-plugin-student-stats/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionStartSource } from '@deepseek-ai/dsh-agent'
import type { SessionRecord, SessionSummary } from './types.ts'

/**
 * Tracks agent session activity in memory for the lifetime of the plugin
 * fiber. State is not durable: it exists only to summarize a running session
 * and is discarded when the fiber unloads.
 */
export class StudentStatsService extends Service {
  private readonly live = new Map<SessionId, SessionRecord>()

  /**
   * @param ctx - the plugin context that publishes this service as `studentStats`.
   */
  constructor(ctx: Context) {
    super(ctx, 'studentStats')
  }

  /**
   * Begin tracking an agent session, replacing any prior record for the same id.
   * @param agentId - the agent's session id.
   * @param source - why the session started.
   */
  start(agentId: SessionId, source: SessionStartSource): void {
    this.live.set(agentId, { agentId, source, startedAt: Date.now(), turns: 0, errors: 0 })
  }

  /**
   * Record one completed turn for a tracked agent; ignored when untracked.
   * @param agentId - the agent's session id.
   */
  recordTurn(agentId: SessionId): void {
    const record = this.live.get(agentId)
    if (record) record.turns += 1
  }

  /**
   * Record one turn or step error for a tracked agent; ignored when untracked.
   * @param agentId - the agent's session id.
   */
  recordError(agentId: SessionId): void {
    const record = this.live.get(agentId)
    if (record) record.errors += 1
  }

  /**
   * Stop tracking an agent and return its final summary.
   * @param agentId - the agent's session id.
   * @returns the completed {@link SessionSummary}, or `undefined` when untracked.
   */
  finish(agentId: SessionId): SessionSummary | undefined {
    const record = this.live.get(agentId)
    if (!record) return undefined
    this.live.delete(agentId)
    const endedAt = Date.now()
    return { ...record, endedAt, durationMs: endedAt - record.startedAt }
  }

  /**
   * @returns a defensive copy of every session currently being tracked.
   */
  snapshot(): SessionRecord[] {
    return [...this.live.values()].map(record => ({ ...record }))
  }
}
