/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-geo-viewcontext`.
 * @module @deepseek-ai/dsh-geo-viewcontext/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-geo-viewcontext'

/** Cordis companion plugin name. */
export const name = 'geo-viewcontext-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this plugin reads the session's `geo/command` events
 * and appends a plugin-sourced message at pre-step; it owns no cross-plugin
 * mutable event stream of its own. Its view derivation and injection behavior
 * are asserted directly by this package's tests.
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
