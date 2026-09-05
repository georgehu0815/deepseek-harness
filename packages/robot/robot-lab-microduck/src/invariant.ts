/** MicroDuck provider invariant ownership. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** Companion plugin identity. */
export const name = 'robot-lab-microduck-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: process replies are validated locally; no cross-plugin event relation is published. */
const install: InvariantInstaller = () => {}
/** Register ownership. @param ctx - Invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-robot-lab-microduck', install))
