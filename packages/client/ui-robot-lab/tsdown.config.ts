/** Build both Cordis entrypoints and the dynamic browser plugin. */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-robot-lab', ['lib/types/index.js', 'lib/types/invariant.js'])
