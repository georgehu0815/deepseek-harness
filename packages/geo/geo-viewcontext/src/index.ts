/**
 * Opt-in Earth view-context injection. At each eligible pre-step, if the
 * session has a current 3D Earth view — a browser-reported `geo/view` (the real
 * on-screen camera and bounds) preferred over a `geo/command` camera the agent
 * flew — this appends a durable, plugin-sourced message stating the current
 * camera target and the viewport bbox, so domain-layer queries and segmentation
 * can be about what is currently on screen.
 * @module @deepseek-ai/dsh-geo-viewcontext
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: resolves the geo/command SessionEventMap merge read below.
import type {} from '@deepseek-ai/dsh-geo-command'
// Type-only: resolves the geo/view SessionEventMap merge preferred below.
import type {} from '@deepseek-ai/dsh-geo-view'
import { renderViewContext } from './viewport.ts'
import type { CameraPose, ViewBBox } from './viewport.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'geo-viewcontext'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/** Earth view-context injection scheduling. Invalid values fail plugin load. */
export interface Config {
  /** Minimum milliseconds between durable injections in one session. Omit or 0 to inject at every eligible step. */
  refreshIntervalMs?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  refreshIntervalMs: z.number(),
})

/** The current Earth view: a camera pose and, when the viewer reported it, the real on-screen bbox. */
interface CurrentView {
  /** The camera pose to state. */
  readonly pose: CameraPose
  /** The real on-screen rectangle, present only from a `geo/view` report that carried one. */
  readonly actualBBox?: ViewBBox
}

/**
 * Find the session's current Earth view, preferring the newest browser-reported
 * `geo/view` (real camera and, when present, real on-screen bounds) over the
 * newest `geo/command` camera the agent flew.
 * @param agent - the owning agent whose session log carries the view events.
 * @returns the current view, or undefined when the session has neither.
 */
function latestCurrentView(agent: Agent): CurrentView | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'geo/view') {
      const { pose, bbox } = event.data
      return {
        pose: { lat: pose.lat, lon: pose.lon, height: pose.height },
        ...(bbox === undefined ? {} : { actualBBox: [bbox.west, bbox.south, bbox.east, bbox.north] }),
      }
    }
  }
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'geo/command' && event.data.kind === 'camera') {
      return { pose: { lat: event.data.lat, lon: event.data.lon, height: event.data.height } }
    }
  }
  return undefined
}

/** Find this plugin's latest durable injection time in the session. */
function latestInjectionTime(agent: Agent): number | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === name) {
      return event.time
    }
  }
  return undefined
}

/** Reject refresh intervals that cannot represent an exact elapsed-millisecond threshold. */
function validateRefreshInterval(refreshIntervalMs: number | undefined): void {
  if (refreshIntervalMs !== undefined && (
    !Number.isSafeInteger(refreshIntervalMs)
    || refreshIntervalMs < 0
  )) {
    throw new TypeError(
      `geo-viewcontext: refreshIntervalMs must be a non-negative safe integer, got ${String(refreshIntervalMs)}`,
    )
  }
}

/**
 * Register a prepended pre-step listener for the lifetime of `ctx`. When the
 * session has an Earth camera pose, injects the current-view context.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - durable refresh scheduling configuration.
 * @throws when the refresh interval is invalid.
 */
export function apply(ctx: Context, config: Config): void {
  const refreshIntervalMs = config.refreshIntervalMs
  validateRefreshInterval(refreshIntervalMs)

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const view = latestCurrentView(agent)
    if (view === undefined) return decision
    if (refreshIntervalMs !== undefined && refreshIntervalMs > 0) {
      const last = latestInjectionTime(agent)
      const now = Date.now()
      if (last !== undefined && now >= last && now - last < refreshIntervalMs) return decision
    }
    const text = renderViewContext(view.pose, view.actualBBox)
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
