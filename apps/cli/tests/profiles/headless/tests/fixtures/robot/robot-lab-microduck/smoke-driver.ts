/** Drive real installed physics through a Loader-created agent and the production provider. */
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-robot-lab'

const config = process.argv[2]
if (config === undefined) throw new Error('Expected a Robot Lab fixture config path')
const backend = process.env.DSH_MICRODUCK_BACKEND ?? 'cpu'
if (backend !== 'cpu' && backend !== 'mlx') throw new Error('DSH_MICRODUCK_BACKEND must be cpu or mlx')
if (backend === 'mlx' && !process.env.DSH_MICRODUCK_MLX_PYTHON) throw new Error('MLX smoke requires DSH_MICRODUCK_MLX_PYTHON; no CPU fallback')
const learnerDevice = backend === 'mlx' ? 'metal' : 'cpu'
const trainingSteps = backend === 'mlx' ? 32 : 1024
const uninstall = installFailLoud('robot-provider-smoke')
let ctx: Context | undefined
try {
  ctx = await boot('robot-provider-smoke', config)
  const agents = ctx.get('agents')?.roots() ?? []
  const agent = agents[0]
  const lab = ctx.get('robotLab')
  if (agents.length !== 1 || agent === undefined || lab === undefined) throw new Error('Fixture requires one real root agent and Robot Lab')
  const signal = new AbortController().signal
  const readiness = await lab.execute(agent, { operation: 'readiness' }, signal)
  if (readiness.operation !== 'readiness' || !readiness.readiness.ready
    || !readiness.readiness.backends[backend].available) throw new Error(JSON.stringify(readiness))
  if (readiness.readiness.backends[backend].learnerDevice !== learnerDevice
    || readiness.readiness.backends[backend].physicsDevice !== 'cpu') throw new Error('Unexpected backend readiness devices')
  const scene = await lab.execute(agent, { operation: 'scene' }, signal)
  if (scene.operation !== 'scene') throw new Error('Expected native scene')
  const studio = await lab.execute(agent, { operation: 'studio' }, signal)
  if (studio.operation !== 'studio') throw new Error('Expected the installed Studio catalog')
  const profile = studio.catalog.profiles[0]
  const template = studio.catalog.templates.find(item => item.id === 'stand')
  const move = studio.catalog.templates.find(item => item.id === 'head-bob')
  if (profile === undefined || template === undefined || move === undefined) throw new Error('Expected MicroDuck Stand and Head Bob targets')
  const saved = await lab.execute(agent, { operation: 'save_project', recipe: {
    projectId: null, name: 'Host provider routine 鸭鸭 🦆', profileId: profile.id, templateId: template.id, templateVersion: template.version,
    parameters: { bpm: 96, beats: 16, moveSize: 0.25 }, music: { version: 1, style: 'disco', bpm: 96, beats: 16, seed: 17 },
    blocks: [
      { templateId: template.id, templateVersion: 1, beats: 4, moveSize: 1 },
      { templateId: move.id, templateVersion: 1, beats: 4, moveSize: 0.5 },
      { templateId: move.id, templateVersion: 1, beats: 8, moveSize: 1 },
    ],
  } }, signal)
  if (saved.operation !== 'save_project') throw new Error('Expected an immutable project revision')
  if (saved.project.blocks.length !== 3 || saved.project.blocks[1]?.moveSize !== 0.125
    || saved.project.training.behaviorId !== 'imitate' || saved.project.training.weights.travel !== 0) {
    throw new Error('Expected ordered blocks, master-scaled sizes and a whole-composition reward recommendation')
  }
  const behaviors = await lab.execute(agent, { operation: 'behaviors' }, signal)
  if (behaviors.operation !== 'behaviors') throw new Error('Expected registered reward behaviors')
  const behavior = behaviors.behaviors.find(item => item.id === saved.project.training.behaviorId)
  if (behavior === undefined) throw new Error('The frozen reward recipe must name an installed behavior')
  const restored = await lab.execute(agent, { operation: 'project', projectRevisionId: saved.project.id }, signal)
  if (restored.operation !== 'project' || restored.project.sha256 !== saved.project.sha256) throw new Error('Project revision changed')
  const preview = await lab.execute(agent, { operation: 'reference_preview', projectRevisionId: saved.project.id }, signal)
  if (preview.operation !== 'reference_preview' || preview.preview.mode !== 'kinematic-reference'
    || preview.preview.projectSha256 !== saved.project.sha256 || preview.preview.frames.length === 0) {
    throw new Error('Missing correctly labeled target preview')
  }
  if (preview.preview.frames.some(frame => frame.telemetry.jointVelocity !== null || frame.telemetry.rootSpeed !== null
    || frame.telemetry.rootLinearVelocityWorld !== null || frame.telemetry.controllerTarget !== null
    || frame.telemetry.actuatorTorque !== null)) {
    throw new Error('A target preview must not fabricate dynamic measurements')
  }
  const trial = await lab.execute(agent, {
    operation: 'save_trial',
    recipe: {
      spec: {
        ...(backend === 'mlx' ? { backend } : {}),
        name: `project-${saved.project.id}`, behaviorId: behavior.id, steps: trainingSteps, envs: 2, seed: 17,
        actuator: 'bam', weights: { ...Object.fromEntries(behavior.terms.map(term => [term.key, term.weight])), ...saved.project.training.weights },
        projectRevisionId: saved.project.id, clip: null,
      },
      brief: {
        goal: 'Follow a small three-block target while remaining upright.',
        prediction: 'A short setup check may not learn the full routine.',
        plannedChange: 'Baseline trial; keep motion and world fixed.',
        evidence: 'Inspect upright fraction, terminations and target tracking.',
      },
      evaluation: { episodes: 2, stepsPerEpisode: 50, seed: 23, maxTerminations: 0, minMeanUprightFraction: 0.5 },
      parentReflectionId: null,
    },
  }, signal)
  if (trial.operation !== 'save_trial' || trial.trial.projectSha256 !== saved.project.sha256) {
    throw new Error('Expected a durable preregistered learning trial')
  }
  const beforeTraining = await lab.execute(agent, { operation: 'trials' }, signal)
  if (beforeTraining.operation !== 'trials' || beforeTraining.trials.length !== 1
    || beforeTraining.trials[0]?.binding !== null || beforeTraining.trials[0]?.run !== null) {
    throw new Error('Saving a trial must not start or fabricate a training run')
  }
  const result = await lab.execute(agent, { operation: 'train_trial', trialId: trial.trial.id }, signal)
  if (result.operation !== 'train_trial' || result.binding.trialId !== trial.trial.id
    || result.binding.runId !== result.run.id || result.binding.trialSha256 !== trial.trial.sha256) {
    throw new Error('Expected an admitted training run bound to its immutable trial')
  }
  if (result.run.formatVersion !== 3 || result.run.spec.backend !== backend
    || result.run.provenance.trainer.backend !== backend || result.run.provenance.trainer.learnerDevice !== learnerDevice
    || result.run.provenance.trainer.physicsDevice !== 'cpu') {
    throw new Error('Training must admit the selected learner with CPU physics; no backend fallback')
  }
  if (result.run.spec.projectSnapshot?.id !== saved.project.id || result.run.spec.projectSnapshot.sha256 !== saved.project.sha256) {
    throw new Error('Training must freeze the exact saved project, clip and soundtrack recipe')
  }
  let run = result.run
  const deadline = Date.now() + 120_000
  while (run.state === 'starting' || run.state === 'running') {
    if (Date.now() >= deadline) throw new Error('Real training did not settle before the fixture deadline')
    await delay(500)
    const update = await lab.execute(agent, { operation: 'run', runId: run.id }, signal)
    if (update.operation !== 'run') throw new Error('Expected run status')
    run = update.run
  }
  if (run.state !== 'completed' || run.policyId === null) throw new Error(`Real training failed: ${JSON.stringify(run)}`)
  let duplicateRejected = false
  try { await lab.execute(agent, { operation: 'train_trial', trialId: trial.trial.id }, signal) }
  catch { duplicateRejected = true } // A saved trial already bound to a run cannot admit another trainer.
  if (!duplicateRejected) throw new Error('Duplicate trial training must be rejected')
  const simulation = await lab.execute(agent, { operation: 'simulate', policyId: run.policyId, steps: 50, seed: 19, command: [0, 0, 0] }, signal)
  const evaluation = await lab.execute(agent, { operation: 'evaluate_trial', trialId: trial.trial.id }, signal)
  const deployment = await lab.execute(agent, { operation: 'prepare', policyId: run.policyId }, signal)
  if (simulation.operation !== 'simulate' || evaluation.operation !== 'evaluate_trial' || deployment.operation !== 'prepare') throw new Error('Unexpected operation result')
  const { policyId: assessedPolicy, ...criteria } = evaluation.evaluation.spec
  if (evaluation.evaluation.policyHash !== run.policySha256 || assessedPolicy !== run.policyId
    || Object.entries(trial.trial.recipe.evaluation).some(([key, value]) => criteria[key as keyof typeof criteria] !== value)) {
    throw new Error('Evaluation must use the trial\'s frozen policy and criteria')
  }
  const history = await lab.execute(agent, { operation: 'evaluations' }, signal)
  if (history.operation !== 'evaluations' || history.incompleteCount !== 0
    || history.evaluations.find(report => report.id === evaluation.evaluation.id)?.policyHash !== run.policySha256) {
    throw new Error('Completed assessment must survive a fresh history read')
  }
  const replay = await lab.execute(agent, { operation: 'replay_evaluation', evaluationId: evaluation.evaluation.id, episodeIndex: 0 }, signal)
  if (replay.operation !== 'replay_evaluation' || replay.mode !== 'new-resimulation'
    || replay.evaluationId !== evaluation.evaluation.id || replay.simulation.policyHash !== run.policySha256
    || replay.simulation.frames.length === 0) throw new Error('Expected a labeled new re-simulation of saved assessment inputs')
  const reflection = await lab.execute(agent, { operation: 'save_reflection', reflection: {
    trialId: trial.trial.id, evaluationId: evaluation.evaluation.id,
    observation: `Assessment passed its named criteria: ${String(evaluation.evaluation.passed)}. This does not assess full choreography.`,
    interpretation: 'A small setup budget is integration evidence, not a learned-dance guarantee.',
    nextChange: 'Increase only the training budget and keep the target and assessment fixed.',
  } }, signal)
  if (reflection.operation !== 'save_reflection' || reflection.reflection.policyHash !== run.policySha256) {
    throw new Error('Reflection must bind the measured report and exact export')
  }
  const child = await lab.execute(agent, { operation: 'save_trial', recipe: {
    ...trial.trial.recipe,
    spec: { ...trial.trial.recipe.spec, steps: trainingSteps * 2 },
    brief: { ...trial.trial.recipe.brief, plannedChange: reflection.reflection.nextChange },
    parentReflectionId: reflection.reflection.id,
  } }, signal)
  if (child.operation !== 'save_trial' || child.trial.id === trial.trial.id
    || child.trial.recipe.parentReflectionId !== reflection.reflection.id) throw new Error('Improvement must create a distinct parent-linked trial')
  const trials = await lab.execute(agent, { operation: 'trials' }, signal)
  const reflections = await lab.execute(agent, { operation: 'reflections' }, signal)
  if (trials.operation !== 'trials' || reflections.operation !== 'reflections'
    || trials.trials.length !== 2 || reflections.reflections.length !== 1
    || trials.trials.find(entry => entry.trial.id === child.trial.id)?.binding !== null
    || trials.trials.find(entry => entry.trial.id === trial.trial.id)?.run?.state !== 'completed') {
    throw new Error('Saved reflection and child trial must reload without automatically starting training')
  }
  if (simulation.simulation.frames.length === 0 || deployment.allowed) throw new Error('Missing physics evidence or unsafe deployment allowance')
  if (simulation.simulation.frames.some(frame => frame.telemetry.jointPosition.length !== profile.joints.length
    || !Number.isFinite(frame.telemetry.rootSpeed))) throw new Error('Missing measured joint/root telemetry')
  process.stdout.write(JSON.stringify({
    mode: 'real-host-provider', backend, learnerDevice, trainingSteps, readiness: readiness.readiness,
    projectSha256: saved.project.sha256, referenceFrameCount: preview.preview.frames.length,
    run, frameCount: simulation.simulation.frames.length,
    policyHash: simulation.simulation.policyHash, evaluation: evaluation.evaluation,
    learning: { trial: trial.trial, binding: result.binding, reflection: reflection.reflection, child: child.trial,
      historyCount: history.evaluations.length, incompleteCount: history.incompleteCount,
      replay: { mode: replay.mode, evaluationId: replay.evaluationId, episodeIndex: replay.episodeIndex,
        policyHash: replay.simulation.policyHash, frameCount: replay.simulation.frames.length },
      childRunStarted: false },
    deployment, limitation: 'Short integration smoke, not evidence of a learned dance or physical safety.',
  }) + '\n')
} finally {
  await ctx?.fiber.dispose()
  uninstall()
}
