/** Invariant ownership for the browser-only MicroDuck Studio package. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion name. */
export const name = 'client-ui-robot-lab-invariant'
/** The companion requires the invariant registry. */
export const inject = ['invariants']

/**
 * No runtime invariant: this host entry owns no experiment state; the robot
 * service owns operation authorization and durability. Browser frame ordering
 * and disposal are tested on the client object directly.
 */
const install: InvariantInstaller = () => {}

/**
 * Register package ownership.
 * @param ctx - host context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-client-ui-robot-lab', install))
