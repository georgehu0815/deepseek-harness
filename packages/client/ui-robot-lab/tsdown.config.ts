/** Build the Cordis host entrypoint and the dynamic browser plugin. */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-robot-lab', ['lib/types/index.js'])
