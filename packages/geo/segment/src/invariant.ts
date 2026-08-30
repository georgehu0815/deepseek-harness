/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-geo-segment`.
 * @module @deepseek-ai/dsh-geo-segment/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-geo-segment'

/** Cordis companion plugin name. */
export const name = 'geo-segment-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package registers a last-wins provider registry
 * (`ctx.segment`) and one Consumer tool that emits `geo/command` draw-feature
 * events. It owns no independent mutable event stream; the drawn features fold
 * into the `geoCommand` projection owned and asserted by
 * `@deepseek-ai/dsh-geo-command`, and this package's tests assert the tool
 * emits one unique-id draw event per detection.
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
