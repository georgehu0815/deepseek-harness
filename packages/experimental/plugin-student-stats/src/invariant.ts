/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-experimental-plugin-student-stats`.
 * @module @deepseek-ai/dsh-experimental-plugin-student-stats/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-plugin-student-stats'

/** Cordis companion plugin name. */
export const name = 'plugin-student-stats-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin holds only in-memory, non-durable session
 * counters and emits `student/session-summary` as a transient notification with
 * no package-local session-log stream to relate. The unit and assembled-transcript
 * snapshot tests cover the summary-from-lifecycle-events relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
