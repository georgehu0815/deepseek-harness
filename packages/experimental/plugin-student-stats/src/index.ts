/**
 * Session-activity tracker plugin. Publishes the `studentStats` service and
 * summarizes each agent session from agent lifecycle events, emitting one
 * `student/session-summary` when the agent is disposed.
 * @module @deepseek-ai/dsh-experimental-plugin-student-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import { StudentStatsService } from './service.ts'
import type { SessionSummary } from './types.ts'

export type { SessionRecord, SessionSummary } from './types.ts'
export { StudentStatsService } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-activity tracker published by this package's plugin. */
    studentStats: StudentStatsService
  }
  interface Events {
    /**
     * A tracked agent session ended and its final summary is available.
     * @param summary - the completed session's turns, errors, and lifetime.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'student/session-summary'(summary: SessionSummary): void
  }
}

/** Cordis plugin name. */
export const name = 'plugin-student-stats'

/**
 * `agents` supplies the lifecycle events this plugin consumes. `studentStats`
 * is provided by this plugin, so it is not injected here; the listeners read it
 * back through a nested `ctx.inject` child that waits for the published service.
 */
export const inject = ['agents']

/**
 * Publish the tracker service and wire the agent lifecycle listeners.
 * @param ctx - the plugin context; `agents` is available per {@link inject}.
 */
export function apply(ctx: Context): void {
  ctx.plugin(StudentStatsService)

  ctx.inject(['studentStats'], (self) => {
    self.on('agent/session-start', ({ agent, source }) => {
      self.studentStats.start(agent.id, source)
    })

    self.on('agent/turn-stopping', ({ agent }) => {
      self.studentStats.recordTurn(agent.id)
    })

    self.on('agent/error', ({ agent }) => {
      self.studentStats.recordError(agent.id)
    })

    // `agent/disposed` is the end-of-session signal: AgentLoop emits it after
    // driver quiescence. There is no `agent/session-end` event.
    self.on('agent/disposed', ({ agent }) => {
      const summary = self.studentStats.finish(agent.id)
      if (summary === undefined) return
      self.emit('student/session-summary', summary)
    })
  })
}
