/** Robot Lab composition invariant registration. @module dsh-robot-lab-bundle/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Companion plugin identity. */
export const name = 'robot-lab-bundle-invariant'
/** Registry required for package ownership. */
export const inject = ['invariants']

// No runtime invariant: this package carries static composition rows and owns
// no running experiments or mutable state; the inserted plugins verify those.
const install: InvariantInstaller = () => {}

/**
 * Register the composition package's invariant ownership.
 * @param ctx - context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-robot-lab-bundle', install))
