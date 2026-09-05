/** Robot Lab capability; providers own physics, artifacts, and process supervision. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { RobotLabRequest, RobotLabResult } from './types.ts'
import { validateStudioFields } from './studio-validation.ts'
import { validateLearningFields } from './learning-validation.ts'
export type * from './types.ts'

/** Provider implementation receives an authoritative session, never a caller-supplied directory. */
export interface RobotLabProvider {
  /**
   * Execute an owned operation.
   * @param session - Owning session.
   * @param request - Validated wire request.
   * @param signal - Request cancellation.
   * @returns The committed result.
   */
  execute(session: Session, request: RobotLabRequest, signal: AbortSignal): Promise<RobotLabResult>
}
declare module '@deepseek-ai/cordis' {
  interface Context { robotLab: RobotLabRuntime }
}
/**
 * Validate untrusted operation names before provider-private commands are reachable.
 * @param value - Browser or model JSON.
 * @returns Public operation request.
 */
export function validateRobotRequest(value: unknown): RobotLabRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Robot Lab request must be an object')
  const row = value as Record<string, unknown>
  const fields: Record<string, readonly string[]> = {
    readiness: [], behaviors: [], scene: [], policies: [], runs: [], studio: [], projects: [],
    save_trial: ['recipe'], trials: [], train_trial: ['trialId'], evaluate_trial: ['trialId'], evaluations: [],
    save_reflection: ['reflection'], reflections: [], replay_evaluation: ['evaluationId', 'episodeIndex'],
    save_project: ['recipe'], project: ['projectRevisionId'], reference_preview: ['projectRevisionId'],
    run: ['runId'], stop: ['runId'], train: ['spec'],
    simulate: ['policyId', 'steps', 'seed', 'command'], evaluate: ['spec'], prepare: ['policyId'],
  }
  const required = typeof row.operation === 'string' && Object.hasOwn(fields, row.operation) ? fields[row.operation] : undefined
  if (required === undefined) throw new Error('Unsupported public Robot Lab operation')
  if (Object.keys(row).some(key => key !== 'operation' && !required.includes(key)) || required.some(key => !(key in row))) {
    throw new Error('Robot Lab request has missing or unsupported fields')
  }
  validateStudioFields(row)
  validateLearningFields(row)
  return row as unknown as RobotLabRequest
}

/** Service Definition shared by browser remotes and model-facing tools. */
export class RobotLabRuntime extends TypertRemoteService {
  private provider: RobotLabProvider | undefined
  /** @param ctx - Owning plugin context. */
  constructor(ctx: Context) { super(ctx, 'robotLab') }
  /**
   * Install one provider.
   * @param provider - Implementation.
   * @returns Effect disposer.
   */
  registerProvider(provider: RobotLabProvider): () => void {
    if (this.provider !== undefined) throw new Error('Robot Lab already has a provider')
    this.provider = provider
    return () => { if (this.provider === provider) this.provider = undefined }
  }
  /**
   * Execute through the same authority for UI and tools.
   * @param agent - Exact owning agent.
   * @param request - JSON request.
   * @param signal - Cancellation.
   * @returns Provider result.
   */
  async execute(agent: Agent, request: RobotLabRequest, signal: AbortSignal): Promise<RobotLabResult> {
    validateRobotRequest(request)
    if (this.provider === undefined) {
      if (request.operation !== 'readiness') throw new Error('Robot Lab provider is not configured')
      const disabled = { available: false, reason: 'Configure a MicroDuck Lab provider and Python environment.' }
      return { operation: 'readiness', readiness: {
        ready: false, reason: disabled.reason, versions: {}, defaultBackend: 'cpu',
        backends: {
          cpu: { ...disabled, learnerDevice: 'cpu', physicsDevice: 'cpu', versions: {} },
          mlx: { ...disabled, learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} },
        },
        capabilities: { train: disabled, simulate: disabled, evaluate: disabled, deploy: disabled },
      } }
    }
    return this.provider.execute(agent.session, request, signal)
  }
  /**
   * Submit a browser operation with the gateway-resolved session owner.
   * @param agent - Authoritative agent resolved by the API identity policy.
   * @param request - Requested operation and its validated input fields.
   * @returns Committed result; admitted training continues independently of the browser.
   */
  @Remote('request')
  request(agent: Agent, request: RobotLabRequest): Promise<RobotLabResult> {
    return this.execute(agent, request, new AbortController().signal)
  }
}
export default RobotLabRuntime
