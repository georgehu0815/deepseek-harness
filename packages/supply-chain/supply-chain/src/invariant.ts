/**
 * Package-owned invariants for the supply-chain run store.
 * @module @deepseek-ai/dsh-supply-chain/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SimulationRun } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-supply-chain'

/** Cordis companion plugin name. */
export const name = 'supply-chain-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Check the store contract every `supply-chain/run` announces: the run is
 * already committed when the event fires, the event carries the same object the
 * store holds, and eviction never lets the store exceed its retention bound.
 *
 * These are the two facts every consumer relies on — the panel reads the run
 * back by id after the event, and the store is the only thing keeping a long
 * session's completed runs from growing without limit.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('supply-chain/run', (run: SimulationRun) => {
    const retained = ctx.supplyChain.listRuns()
    if (!retained.includes(run.id)) {
      fail(`run ${run.id} was announced before it was committed to the store`)
    }
    if (ctx.supplyChain.getRun(run.id) !== run) {
      fail(`run ${run.id} in the store is not the run that was announced`)
    }
    if (retained.length > ctx.supplyChain.retentionLimit) {
      fail(
        `run store holds ${retained.length} runs, above the retention limit of `
        + `${ctx.supplyChain.retentionLimit}`,
      )
    }
  })
}, { inject: ['supplyChain'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
