/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-geo-command`.
 * @module @deepseek-ai/dsh-geo-command/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-geo-command'

/** Cordis companion plugin name. */
export const name = 'geo-command-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package declares one session event and registers
 * one pure last-wins projection fold; the fold's determinism is asserted by
 * this package's tests, and it owns no independent mutable event stream.
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
