/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-geo-earth`.
 * @module @deepseek-ai/dsh-client-ui-geo-earth/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-geo-earth'

/** Cordis companion plugin name. */
export const name = 'client-ui-geo-earth-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a browser-only overlay plugin that mounts a CesiumJS
 * viewer from local open/close state and emits no cordis events nor owns any
 * cross-plugin mutable state; its slot registration and disposal are asserted
 * directly by this package's component specs.
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
