/**
 * Opt-in Earth view-context injection. At each eligible pre-step, if the
 * session has flown the 3D Earth camera (a `geo/command` of kind `camera`),
 * this appends a durable, plugin-sourced message stating the current camera
 * target and an approximate viewport bbox, so domain-layer queries can be
 * about what is currently on screen.
 * @module @deepseek-ai/dsh-geo-viewcontext
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: resolves the geo/command SessionEventMap merge read below.
import type {} from '@deepseek-ai/dsh-geo-command'
import { renderViewContext } from './viewport.ts'
import type { CameraPose } from './viewport.ts'

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

/** Find the most recent camera pose the session flew the Earth view to. */
function latestCameraPose(agent: Agent): CameraPose | undefined {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type === 'geo/command' && event.data.kind === 'camera') {
      return { lat: event.data.lat, lon: event.data.lon, height: event.data.height }
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
    const pose = latestCameraPose(agent)
    if (pose === undefined) return decision
    if (refreshIntervalMs !== undefined && refreshIntervalMs > 0) {
      const last = latestInjectionTime(agent)
      const now = Date.now()
      if (last !== undefined && now >= last && now - last < refreshIntervalMs) return decision
    }
    const text = renderViewContext(pose)
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
