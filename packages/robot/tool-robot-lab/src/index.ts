/** Model-facing consumer of the same session-owned Robot Lab service used by the UI. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { validateRobotRequest, type RobotLabResult, type RobotProjectRevision, type RobotRun } from '@deepseek-ai/dsh-robot-lab'

function projectSummary(project: RobotProjectRevision) {
  return { id: project.id, projectId: project.projectId, createdAt: project.createdAt, sha256: project.sha256,
    recipe: project.recipe, training: project.training,
    blocks: project.blocks.map(block => ({ templateId: block.template.id, templateVersion: block.template.version,
      beats: block.beats, moveSize: block.moveSize })),
    clip: { name: project.clip.name, duration: project.clip.duration, keyCount: project.clip.keys.length } }
}

function runSummary(run: RobotRun) {
  return { ...run, spec: { ...run.spec,
    projectSnapshot: run.spec.projectSnapshot === undefined ? undefined : projectSummary(run.spec.projectSnapshot),
    clip: run.spec.clip === null ? null : {
      name: run.spec.clip.name, duration: run.spec.clip.duration, keyCount: run.spec.clip.keys.length } } }
}

/**
 * Project large visual responses into model-relevant summaries without mesh or frame dumps.
 * @param result - Full service result.
 * @returns Model-visible JSON text.
 */
export function summarizeResult(result: RobotLabResult): string {
  if (result.operation === 'save_project' || result.operation === 'project') return JSON.stringify({ operation: result.operation, project: projectSummary(result.project) })
  if (result.operation === 'projects') return JSON.stringify({ operation: result.operation, projects: result.projects.map(projectSummary) })
  if (result.operation === 'reference_preview') return JSON.stringify({ operation: result.operation, mode: result.preview.mode, projectRevisionId: result.preview.projectRevisionId, projectSha256: result.preview.projectSha256, frameCount: result.preview.frames.length, duration: result.preview.frames.at(-1)?.time, limitations: result.preview.limitations })
  if (result.operation === 'scene') return JSON.stringify({ operation: result.operation, bodyCount: result.scene.bodies.length, meshCount: result.scene.meshes.length, jointNames: result.scene.jointNames, defaultJoints: result.scene.defaultJoints })
  if (result.operation === 'simulate') return JSON.stringify({ operation: result.operation, mode: result.simulation.mode, policyId: result.simulation.policyId, policyHash: result.simulation.policyHash, observationProfile: result.simulation.observationProfile, frameCount: result.simulation.frames.length, finalFrame: result.simulation.frames.at(-1) === undefined ? null : { step: result.simulation.frames.at(-1)?.step, terminated: result.simulation.frames.at(-1)?.terminated, reward: result.simulation.frames.at(-1)?.reward } })
  if (result.operation === 'run' || result.operation === 'train' || result.operation === 'stop') return JSON.stringify({ operation: result.operation, run: runSummary(result.run) })
  if (result.operation === 'train_trial') return JSON.stringify({ ...result, run: runSummary(result.run) })
  if (result.operation === 'trials') return JSON.stringify({ ...result, trials: result.trials.map(entry => ({ ...entry, run: entry.run === null ? null : runSummary(entry.run) })) })
  if (result.operation === 'replay_evaluation') return JSON.stringify({ operation: result.operation, evaluationId: result.evaluationId,
    episodeIndex: result.episodeIndex, mode: result.mode, policyId: result.simulation.policyId, policyHash: result.simulation.policyHash,
    frameCount: result.simulation.frames.length, limitation: 'New re-simulation of the evaluated episode, not its original recording.' })
  if (result.operation === 'runs') return JSON.stringify({ operation: result.operation, incompatibleRuns: result.incompatibleRuns, runs: result.runs.map(run => ({ id: run.id, state: run.state, name: run.spec.name, backend: run.spec.backend, observationProfile: run.observationProfile, progress: run.progress, policyId: run.policyId })) })
  return JSON.stringify(result)
}

/** Tool plugin name. */
export const name = 'tool-robot-lab'
/** Required host capabilities. */
export const inject = ['tools', 'robotLab']
/** Model-result limit, including the structured result wrapper. */
export interface Config {
  /** Maximum UTF-8 bytes in the JSON result wrapper; values below 128 are rejected. */
  maxResultBytes: number
}
/** Result byte budget. */
export const Config: z<Config> = z.object({ maxResultBytes: z.natural().default(24_000) })
/** Register the JSON operation tool.
 * @param ctx - Tool registry and Robot Lab service.
 * @param config - Model-result budget. */
export function apply(ctx: Context, config: Config): void {
  if (config.maxResultBytes < 128) throw new Error('Robot Lab maxResultBytes must be at least 128')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'robot_lab',
    description: 'Inspect MicroDuck readiness, behaviors, scene, policies or runs; train and stop local CPU or optional MLX GPU experiments (MuJoCo physics stays on CPU); simulate or evaluate exported ONNX. Never activates hardware. Operations: studio, save_project, projects, project, reference_preview, readiness, behaviors, scene, policies, runs, run, train, stop, simulate, evaluate, prepare, save_trial, trials, train_trial, evaluate_trial, evaluations, save_reflection, reflections, replay_evaluation. Guided learning saves a prediction and evidence plan before training; reflections bind measured results to exact policy bytes. Studio templates are experimental authored motion, not trained skills. reference_preview is kinematic MuJoCo posing, not a learned-policy rollout. Use readiness first and inspect behaviors before training. Simulation is a recorded deterministic rollout, not a physical robot or live control stream.',
    parameters: {
      request_json: { type: 'string', required: true, description: 'JSON object with operation. Queries need only operation; run/stop require runId. studio returns installed profile, templates and limits, including actions Stand Steady (stand), Say Hello (hello), and Look Around (look-around). save_project requires recipe={projectId:null|savedId,name,profileId,templateId,templateVersion:1,parameters:{bpm,beats,moveSize},music:{version:1,style:"disco"|"electronic"|"lofi"|"chiptune",bpm,beats,seed}} with matching music tempo/beats. Optional recipe.blocks=[{templateId,templateVersion:1,beats,moveSize}] is the ordered motion sequence; first block matches the top-level template, beats sum to motion/music beats, and parameters.moveSize scales each block. Reorder/remove/duplicate blocks and save a new immutable revision. Project and clip display names preserve exact Unicode; use "project-" + project.id as the ASCII train name, not clip.name. Use project.training.behaviorId and explicitly merge its weights with the behavior defaults for whole-sequence training. project and reference_preview require projectRevisionId. Defaults recommended bpm96,beats32,moveSize0.5; bounds come from studio. train may include spec.projectRevisionId with clip:null to select its saved clip, or supply the identical clip; admission freezes the resolved clip and project snapshot. train accepts optional spec.backend="cpu"|"mlx" (default cpu; unavailable mlx fails without fallback) and requires spec={name,behaviorId,steps,envs,seed,actuator:"bam"|"xml",weights:{},clip:null|{version:1,name,duration,loop,keys:[{t,joints:[14 radians],rootPitch}]}}. simulate requires policyId,steps,seed,command:[vx,vy,yawRate]. evaluate requires spec={policyId,episodes,stepsPerEpisode,seed,maxTerminations,minMeanUprightFraction}. prepare requires policyId and always reports blocked physical deployment for local prototypes. save_trial requires recipe={spec:existing training request with projectRevisionId and clip:null,brief:{goal,prediction,plannedChange,evidence},evaluation:{episodes,stepsPerEpisode,seed,maxTerminations,minMeanUprightFraction},parentReflectionId:null|savedReflectionId}; all four brief fields are nonblank strings and evidence describes what to measure, not existing results. Save first; train_trial and evaluate_trial require trialId and use frozen settings. A trial admits one run only; save a new trial to retry. trials lists saved trials with bindings and run state. evaluations lists validated completed reports and incompleteCount, excluding unfinished attempts from evidence. save_reflection requires reflection={trialId,evaluationId,observation,interpretation,nextChange}; its evaluation must match the frozen assessment and exact completed policy. reflections lists saved observations. Improve can reopen an unsaved draft from a reflection; saving with parentReflectionId creates a child trial. replay_evaluation requires evaluationId and episodeIndex; returns a NEW re-simulation of an owned policy episode, not its original video.' },
    },
    output: { schema: { type: 'object', properties: { result: { type: 'string', required: true } }, additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('Robot Lab requires an owning agent session')
      const request = validateRobotRequest(JSON.parse(args.request_json) as unknown)
      const result = await ctx.robotLab.execute(exec.agent, request, exec.signal)
      const output = { result: summarizeResult(result) }
      if (Buffer.byteLength(JSON.stringify(output), 'utf8') > config.maxResultBytes) throw new Error('Robot Lab result exceeds maxResultBytes; request one run or inspect the full result in the Studio.')
      return output
    },
    presentCall: () => ({ card: 'generic', title: 'MicroDuck Lab', kind: 'other' }),
  })))
}
