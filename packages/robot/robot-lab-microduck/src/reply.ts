/** Validation of bounded JSON replies crossing the Python process boundary. */
import { isDeepStrictEqual } from 'node:util'
import { validateRobotRequest, type RobotLabResult } from '@deepseek-ai/dsh-robot-lab'

/** Deployment limits applied to decoded project and frame collections. */
export interface RobotReplyLimits {
  maxClipKeys: number
  maxClipSeconds: number
  maxSimulationSteps: number
  maxProjects: number
  maxProjectBlocks: number
}
type Row = Record<string, unknown>
function object(value: unknown): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('MicroDuck bridge expected an object')
  return value as Row
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('MicroDuck bridge expected an array')
  return value
}
function text(value: unknown): void { if (typeof value !== 'string') throw new Error('MicroDuck bridge expected text') }
function checksum(value: unknown): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('MicroDuck bridge expected a SHA256 digest')
}
function bool(value: unknown): void { if (typeof value !== 'boolean') throw new Error('MicroDuck bridge expected a boolean') }
function numeric(value: unknown): void { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('MicroDuck bridge expected a finite number') }
function numbers(value: unknown, length?: number): void {
  const values = array(value)
  if (length !== undefined && values.length !== length) throw new Error('MicroDuck bridge returned an invalid vector width')
  values.forEach(numeric)
}
function profile(value: unknown): void {
  if (value !== 'microduck-standard-61' && value !== 'microduck-lab-body-phase-61') throw new Error('MicroDuck bridge returned unknown observation semantics')
}
function capability(value: unknown): void { const row = object(value); bool(row.available); if (row.reason !== null) text(row.reason) }
function bam(value: unknown): void {
  const row = object(value)
  text(row.source); text(row.sha256); Object.values(object(row.parameters)).forEach(numeric)
}
function physics(value: unknown): void {
  const row = object(value)
  bam(row.bam)
  if (row.actuator !== 'bam' || row.observationNoise !== false || row.actionDelay !== true
    || row.domainRandomization !== false || row.randomYaw !== false) throw new Error('Unexpected rollout physics')
}
function bamSettings(value: unknown): void {
  for (const setting of Object.values(object(value))) if (setting !== null) numeric(setting)
}
function run(value: unknown): void {
  const row = object(value)
  if (row.formatVersion !== 3) throw new Error('Unsupported Robot Lab run format; only version 3 is supported')
  const provenance = object(row.provenance)
  bam(provenance.bam)
  text(provenance.bridgeSha256); Object.values(object(provenance.dependencyVersions)).forEach(text)
  const environment = object(provenance.environment)
  for (const key of ['domainRandomization', 'randomYaw', 'standingSpawns', 'assistance', 'observationNoise', 'actionDelay']) bool(environment[key])
  const spec = object(row.spec)
  if (spec.projectRevisionId !== undefined || spec.projectSnapshot !== undefined) {
    identity(spec.projectRevisionId, 'revision'); project(spec.projectSnapshot)
    if (object(spec.projectSnapshot).id !== spec.projectRevisionId || JSON.stringify(object(spec.projectSnapshot).clip) !== JSON.stringify(spec.clip)) throw new Error('Training clip differs from frozen project')
  }
  const trainer = object(provenance.trainer)
  if ((spec.backend !== 'cpu' && spec.backend !== 'mlx') || trainer.backend !== spec.backend) throw new Error('Unexpected training backend')
  const device = spec.backend === 'mlx' ? 'metal' : 'cpu'
  if (trainer.learnerDevice !== device || environment.updateDevice !== device || trainer.physicsDevice !== 'cpu') throw new Error('Unexpected training device')
  for (const key of ['pythonVersion', 'platform', 'architecture', 'hardware']) text(trainer[key])
  checksum(trainer.sha256)
  Object.values(object(trainer.dependencyVersions)).forEach(text)
  const helpers = object(trainer.helperSha256)
  if (spec.backend === 'mlx' ? Object.keys(helpers).length !== 1 || !('mlx_ppo.py' in helpers) : Object.keys(helpers).length !== 0) throw new Error('Unexpected learner helper provenance')
  Object.values(helpers).forEach(checksum)
  object(trainer.recipe)
  text(row.id); text(row.createdAt); text(row.recipeHash); text(row.sourceFingerprint); object(row.spec); profile(row.observationProfile)
  if (!['starting', 'running', 'completed', 'failed', 'stopped', 'interrupted'].includes(String(row.state))) throw new Error('MicroDuck bridge returned an invalid run state')
  if (row.finishedAt !== null) text(row.finishedAt)
  if (row.error !== null) text(row.error)
  if (row.policyId !== null) text(row.policyId)
  if (row.policySha256 !== null) text(row.policySha256)
  if (row.state === 'completed' && (typeof row.policySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.policySha256))) throw new Error('Completed run requires frozen policySha256')
  if (row.progress !== null) {
    const progress = object(row.progress)
    numeric(progress.steps); numeric(progress.total); numeric(progress.elapsedSeconds)
    if (progress.reward !== null) numeric(progress.reward)
  }
}
function identity(value: unknown, prefix: string): void {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`).test(value)) throw new Error('MicroDuck bridge returned an invalid identity')
}
function positive(value: unknown): void {
  numeric(value)
  if ((value as number) <= 0) throw new Error('MicroDuck bridge expected a positive number')
}
function robotProfile(value: unknown): void {
  const row = object(value)
  text(row.id); text(row.label); checksum(row.modelSha256)
  const root = object(row.rootBody)
  text(root.name)
  if (!Number.isSafeInteger(root.index) || (root.index as number) <= 0) throw new Error('MicroDuck profile requires an identified non-world root body')
  const joints = array(row.joints)
  if (joints.length !== 14 || row.hardwareAvailable !== false) throw new Error('MicroDuck profile requires fourteen joints and no hardware activation')
  const names = new Set<string>()
  const indices = new Set<number>()
  for (const item of joints) {
    const joint = object(item)
    text(joint.name); numeric(joint.lower); numeric(joint.upper); numeric(joint.defaultPosition)
    if (!Number.isSafeInteger(joint.index) || (joint.index as number) < 0 || joint.unit !== 'rad'
      || (joint.lower as number) >= (joint.upper as number) || (joint.defaultPosition as number) < (joint.lower as number)
      || (joint.defaultPosition as number) > (joint.upper as number)) throw new Error('MicroDuck profile returned invalid joint metadata')
    names.add(joint.name as string); indices.add(joint.index as number)
  }
  if (names.size !== 14 || indices.size !== 14) throw new Error('MicroDuck profile joint metadata must be unique')
}
function studioParameters(value: unknown): void {
  const row = object(value)
  positive(row.bpm); positive(row.beats); numeric(row.moveSize)
  if (!Number.isSafeInteger(row.beats) || (row.moveSize as number) < 0 || (row.moveSize as number) > 1) throw new Error('Invalid studio parameters')
}
function template(value: unknown): void {
  const row = object(value)
  text(row.id); text(row.label); text(row.description); text(row.behaviorId); studioParameters(row.defaultParameters)
  if (!['dance', 'action'].includes(String(row.category)) || !['starter', 'intermediate', 'advanced'].includes(String(row.difficulty))
    || row.behaviorId === '') throw new Error('Invalid template category, difficulty or behavior identity')
  const weights = object(row.trainingWeights)
  for (const weight of Object.values(weights)) {
    numeric(weight)
    if ((weight as number) < 0) throw new Error('Template training weights must be nonnegative')
  }
  if (row.version !== 1 || row.experimental !== true) throw new Error('MicroDuck template must be version 1 and experimental')
}
function projectBlocks(row: Row, recipe: Row, parameters: Row): void {
  const blocks = array(row.blocks).map(object)
  const authored = Object.hasOwn(recipe, 'blocks') ? array(recipe.blocks).map(object)
    : [{ templateId: recipe.templateId, templateVersion: recipe.templateVersion, beats: parameters.beats, moveSize: 1 }]
  const first = blocks[0]
  if (first === undefined || blocks.length !== authored.length) throw new Error('Frozen blocks differ from the recipe')
  const weights = new Map<string, number>()
  let allStand = true
  for (const [index, block] of blocks.entries()) {
    const source = object(authored[index])
    template(block.template)
    studioParameters({ bpm: parameters.bpm, beats: block.beats, moveSize: block.moveSize })
    const frozen = object(block.template)
    if (frozen.id !== source.templateId || frozen.version !== source.templateVersion || block.beats !== source.beats
      || block.moveSize !== (source.moveSize as number) * (parameters.moveSize as number)) throw new Error('Frozen block differs from its authored parameters')
    allStand &&= frozen.behaviorId === 'stand'
    for (const [key, value] of Object.entries(object(frozen.trainingWeights))) {
      if (weights.has(key) && weights.get(key) !== value) throw new Error('Conflicting curated block weights')
      weights.set(key, value as number)
    }
  }
  if (!isDeepStrictEqual(first.template, row.template)) throw new Error('Project template differs from its first block')
  const training = object(row.training)
  const actual = object(training.weights)
  if (training.behaviorId !== (allStand ? 'stand' : 'imitate') || Object.keys(actual).length !== weights.size
    || Array.from(weights).some(([key, value]) => actual[key] !== value)) throw new Error('Resolved project training differs from frozen blocks')
}
function project(value: unknown): void {
  const row = object(value)
  if (row.version !== 2) throw new Error('Unsupported Robot Studio project version; expected 2')
  identity(row.id, 'revision'); identity(row.projectId, 'project'); text(row.createdAt); checksum(row.sha256)
  robotProfile(row.profile); template(row.template)
  const recipe = object(row.recipe)
  validateRobotRequest({ operation: 'save_project', recipe })
  text(recipe.name)
  if (recipe.projectId !== null) identity(recipe.projectId, 'project')
  const parameters = object(recipe.parameters)
  studioParameters(parameters)
  const music = object(recipe.music)
  if (music.version !== 1 || !['disco', 'electronic', 'lofi', 'chiptune'].includes(String(music.style))
    || music.bpm !== parameters.bpm || music.beats !== parameters.beats || !Number.isSafeInteger(music.seed)
    || (music.seed as number) < 0 || (music.seed as number) > 2147483647) throw new Error('Invalid project music recipe')
  if (recipe.profileId !== object(row.profile).id || recipe.templateId !== object(row.template).id
    || recipe.templateVersion !== object(row.template).version || (recipe.projectId !== null && recipe.projectId !== row.projectId)) throw new Error('Project identities differ from frozen recipe')
  projectBlocks(row, recipe, parameters)
  const clip = object(row.clip)
  text(clip.name); positive(clip.duration); bool(clip.loop)
  if (clip.name !== recipe.name) throw new Error('Project clip name differs from recipe display name')
  if (clip.version !== 1 || Math.abs((clip.duration as number) - (parameters.beats as number) * 60 / (parameters.bpm as number)) > 1e-8) throw new Error('Project clip duration differs from music recipe')
  const keys = array(clip.keys)
  if (keys.length < 2) throw new Error('Project clip requires endpoint keys')
  let previous = -1
  const joints = array(object(row.profile).joints).map(object)
  for (const item of keys) {
    const key = object(item)
    numeric(key.t); numeric(key.rootPitch); numbers(key.joints, 14)
    if ((key.t as number) <= previous || (key.t as number) > (clip.duration as number)) throw new Error('Project clip key times must increase within duration')
    previous = key.t as number
    array(key.joints).forEach((value, index) => {
      const joint = object(joints[index])
      if ((value as number) < (joint.lower as number) || (value as number) > (joint.upper as number)) throw new Error('Project clip exceeds model joint limits')
    })
  }
  if (object(keys[0]).t !== 0 || previous !== clip.duration) throw new Error('Project clip must include zero and duration endpoints')
  if (clip.loop && (JSON.stringify(object(keys[0]).joints) !== JSON.stringify(object(keys.at(-1)).joints)
    || object(keys[0]).rootPitch !== object(keys.at(-1)).rootPitch)) throw new Error('Looping project clip endpoints must match')
}
function frame(value: unknown, mode: 'kinematic-reference' | 'recorded-simulation'): void {
  const row = object(value)
  numeric(row.step); numeric(row.time); numeric(row.reward); bool(row.terminated)
  array(row.bodies).forEach((body) => { numbers(body, 7) })
  const telemetry = object(row.telemetry)
  numbers(telemetry.jointPosition, 14); text(telemetry.rootBody); numeric(telemetry.rootTilt)
  if ((telemetry.rootTilt as number) < 0 || (telemetry.rootTilt as number) > Math.PI) throw new Error('Invalid root tilt')
  if (mode === 'kinematic-reference') {
    for (const key of ['jointVelocity', 'controllerTarget', 'actuatorTorque', 'rootLinearVelocityWorld', 'rootSpeed']) {
      if (telemetry[key] !== null) throw new Error('Kinematic reference measurement channels must be null')
    }
  } else {
    numbers(telemetry.jointVelocity, 14); numbers(telemetry.controllerTarget, 14); numbers(telemetry.actuatorTorque, 14)
    numbers(telemetry.rootLinearVelocityWorld, 3); numeric(telemetry.rootSpeed)
    if ((telemetry.rootSpeed as number) < 0) throw new Error('Invalid root speed')
  }
}
function policy(value: unknown): void {
  const row = object(value)
  text(row.id); text(row.name); text(row.sha256); profile(row.observationProfile)
  if (row.runId !== null) text(row.runId)
  if (row.verification !== 'unverified' && row.verification !== 'evaluated') throw new Error('Unknown policy verification state')
  capability(row.runtimeCompatibility)
  capability(row.deployment)
  if (object(row.deployment).available !== false) throw new Error('Local MicroDuck policies cannot authorize deployment')
}
/**
 * Validate every consumed reply branch; malformed JSON or invalid reply fields throw.
 * @param source - Complete bounded stdout.
 * @param limits - Optional deployment bounds; providers supply their resolved configuration.
 * @returns Typed JSON reply.
 */
export function parseReply(source: string, limits?: RobotReplyLimits): RobotLabResult {
  const value = object(JSON.parse(source) as unknown)
  switch (value.operation) {
    case 'studio': {
      const catalog = object(value.catalog)
      array(catalog.profiles).forEach(robotProfile); array(catalog.templates).forEach(template)
      const limits = object(catalog.limits)
      positive(limits.minBpm); positive(limits.maxBpm); positive(limits.maxClipSeconds); positive(limits.maxClipKeys)
      positive(limits.maxProjectBlocks)
      if (!Number.isSafeInteger(limits.maxProjectBlocks)) throw new Error('Invalid project block limit')
      for (const key of ['beatChoices', 'blockBeatChoices']) {
        const choices = array(limits[key])
        if (choices.length === 0 || new Set(choices).size !== choices.length
          || choices.some(value => !Number.isSafeInteger(value) || (value as number) <= 0)
          || (limits.minBpm as number) > (limits.maxBpm as number)) throw new Error('Invalid studio limits')
      }
      break
    }
    case 'save_project': case 'project': project(value.project); break
    case 'projects': array(value.projects).forEach(project); break
    case 'reference_preview': {
      const preview = object(value.preview)
      if (preview.mode !== 'kinematic-reference' || preview.controlHz !== 50) throw new Error('Invalid reference preview mode or timing')
      identity(preview.projectRevisionId, 'revision'); checksum(preview.projectSha256)
      array(preview.frames).forEach((value) => { frame(value, 'kinematic-reference') })
      array(preview.limitations).forEach(text)
      break
    }
    case 'readiness': {
      const readiness = object(value.readiness)
      bool(readiness.ready)
      if (readiness.reason !== null) text(readiness.reason)
      Object.values(object(readiness.versions)).forEach(text)
      if (readiness.defaultBackend !== 'cpu') throw new Error('Robot Lab default backend must be CPU')
      const backends = object(readiness.backends)
      for (const backend of ['cpu', 'mlx']) {
        const value = object(backends[backend])
        capability(value)
        Object.values(object(value.versions)).forEach(text)
        if (value.physicsDevice !== 'cpu' || value.learnerDevice !== (backend === 'mlx' ? 'metal' : 'cpu')) throw new Error('Unexpected backend devices')
      }
      const capabilities = object(readiness.capabilities)
      for (const key of ['train', 'simulate', 'evaluate', 'deploy']) capability(capabilities[key])
      if (object(capabilities.deploy).available !== false) throw new Error('MicroDuck cannot enable hardware deployment')
      break
    }
    case 'behaviors':
      for (const item of array(value.behaviors)) {
        const row = object(item)
        text(row.id); text(row.label); text(row.description); numeric(row.defaultSteps)
        for (const item of array(row.terms)) {
          const term = object(item)
          text(term.key); text(term.label); numeric(term.weight); bool(term.penalty)
        }
      }
      break
    case 'scene': {
      const scene = object(value.scene)
      array(scene.bodies).forEach(text); array(scene.jointNames).forEach(text); numbers(scene.defaultJoints, 14)
      for (const item of array(scene.meshes)) { const mesh = object(item); numbers(mesh.v); numbers(mesh.f) }
      for (const item of array(scene.geoms)) {
        const geom = object(item)
        numeric(geom.mesh); numeric(geom.body); numbers(geom.pos, 3); numbers(geom.quat, 4); text(geom.mat); numbers(geom.rgba, 4)
      }
      break
    }
    case 'runs':
      array(value.runs).forEach(run)
      for (const item of array(value.incompatibleRuns)) {
        const row = object(item)
        text(row.id); text(row.reason)
        if (row.formatVersion !== null && (!Number.isSafeInteger(row.formatVersion) || row.formatVersion === 3)) throw new Error('Invalid unsupported run version')
      }
      break
    case 'run': case 'train': run(value.run); break
    case 'policies': array(value.policies).forEach(policy); break
    case 'simulate': {
      const simulation = object(value.simulation)
      if (simulation.mode !== 'recorded-simulation' || simulation.controlHz !== 50) throw new Error('Invalid simulation timing or mode')
      text(simulation.policyId); text(simulation.policyHash); profile(simulation.observationProfile)
      physics(simulation.physics); bamSettings(simulation.bamSettings)
      array(simulation.frames).forEach((value) => { frame(value, 'recorded-simulation') })
      break
    }
    case 'evaluate': {
      const evaluation = object(value.evaluation)
      text(evaluation.policyId); text(evaluation.policyHash); text(evaluation.evaluatedAt)
      text(evaluation.id); text(evaluation.createdAt); physics(evaluation.physics)
      profile(evaluation.observationProfile); object(evaluation.spec); bool(evaluation.passed)
      array(evaluation.limitations).forEach(text)
      for (const item of array(evaluation.episodes)) {
        const episode = object(item)
        bamSettings(episode.bamSettings)
        numeric(episode.seed); numeric(episode.steps); numeric(episode.reward); numeric(episode.uprightFraction); bool(episode.terminated)
        if (episode.poseRmse !== null) numeric(episode.poseRmse)
      }
      break
    }
    case 'prepare':
      text(value.policyId); array(value.reasons).forEach(text)
      if (value.allowed !== false) throw new Error('Local MicroDuck provider must never authorize physical deployment')
      break
    default: throw new Error('MicroDuck bridge returned an unsupported reply operation')
  }
  const result = value as unknown as RobotLabResult
  if (limits !== undefined) {
    const projects = result.operation === 'projects' ? result.projects
      : result.operation === 'project' || result.operation === 'save_project' ? [result.project]
        : result.operation === 'runs' ? result.runs.flatMap(run => run.spec.projectSnapshot === undefined ? [] : [run.spec.projectSnapshot])
          : (result.operation === 'run' || result.operation === 'train' || result.operation === 'stop') && result.run.spec.projectSnapshot !== undefined
            ? [result.run.spec.projectSnapshot] : []
    if (result.operation === 'projects' && projects.length > limits.maxProjects) throw new Error('MicroDuck reply exceeds maxProjects')
    for (const project of projects) {
      if (project.blocks.length > limits.maxProjectBlocks) throw new Error('MicroDuck reply exceeds maxProjectBlocks')
      if (project.clip.keys.length > limits.maxClipKeys || project.clip.duration > limits.maxClipSeconds) throw new Error('MicroDuck reply exceeds configured clip limits')
    }
    const frames = result.operation === 'reference_preview' ? result.preview.frames : result.operation === 'simulate' ? result.simulation.frames : []
    if (frames.length > limits.maxSimulationSteps + 1) throw new Error('MicroDuck reply exceeds maxSimulationSteps')
  }
  return result
}
