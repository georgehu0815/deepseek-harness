/** Robot Lab service invariant ownership. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** Companion plugin identity. */
export const name = 'robot-lab-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: this service delegates operations and owns no event stream or artifact state. */
const install: InvariantInstaller = () => {}
/** Register ownership. @param ctx - Invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-robot-lab', install))
