/** Browser face for stateless supply-chain report derivation. */

export {
  buildBullwhipReport,
  buildEdgeReport,
  buildNodeReport,
  sampleVariance,
} from '../reports.ts'

/** Required services: none. */
export const inject: string[] = []

/** Supply report exports require no client service or lifecycle effect. */
export function apply(): void {}
