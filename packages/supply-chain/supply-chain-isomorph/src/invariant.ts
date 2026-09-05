/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-supply-chain-isomorph`.
 * @module @deepseek-ai/dsh-supply-chain-isomorph/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supply-chain-isomorph'

/** Cordis companion plugin name. */
export const name = 'supply-chain-isomorph-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package installs one provider handle into the
 * supply-chain seam and otherwise owns no mutable state and emits no events.
 * The store and announcement contracts it feeds are asserted by
 * `@deepseek-ai/dsh-supply-chain`; the bridge subprocess contract is asserted
 * by this package's own tests.
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
