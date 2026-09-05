import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-supply-chain',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
