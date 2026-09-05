/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-supply-chain`.
 * @module @deepseek-ai/dsh-client-ui-supply-chain/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-supply-chain'

/** Cordis companion plugin name. */
export const name = 'client-ui-supply-chain-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package contributes one slot registration and
 * holds only component-local view state. Registration and disposal are effects
 * the slot registry owns, the globe overlay it draws is owned by
 * `ctx.earthOverlays`, and the run data it renders is asserted by
 * `@deepseek-ai/dsh-supply-chain`.
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
