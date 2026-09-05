/** Robot Lab tool invariant ownership. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** Companion plugin identity. */
export const name = 'tool-robot-lab-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: the tool delegates to robotLab and owns no persistent or cross-plugin mutable state. */
const install: InvariantInstaller = () => {}
/** Register ownership. @param ctx - Invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-tool-robot-lab', install))
