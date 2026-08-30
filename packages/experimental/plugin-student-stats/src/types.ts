/**
 * Types for `@deepseek-ai/dsh-experimental-plugin-student-stats`.
 * @module @deepseek-ai/dsh-experimental-plugin-student-stats/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionStartSource } from '@deepseek-ai/dsh-agent'

/**
 * One agent session's running activity record, keyed by the agent's
 * {@link SessionId}. `turns` and `errors` accumulate from agent lifecycle
 * events; `startedAt` is the epoch millisecond the session began tracking.
 */
export interface SessionRecord {
  agentId: SessionId
  source: SessionStartSource
  startedAt: number
  turns: number
  errors: number
}

/**
 * A finished session's immutable summary, published on
 * `student/session-summary` when the tracked agent is disposed. Extends
 * {@link SessionRecord} with the end time and elapsed lifetime.
 */
export interface SessionSummary extends SessionRecord {
  endedAt: number
  durationMs: number
}
