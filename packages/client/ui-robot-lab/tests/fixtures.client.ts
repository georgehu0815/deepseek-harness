import type {
  RobotFrame, RobotIncompatibleRun, RobotPhysics, RobotReadiness, RobotRun, RobotRunId,
  RobotProfile, RobotProfileId, RobotTemplate, RobotTemplateId, RobotProjectRevision, RobotProjectRevisionId,
  RobotProjectId, RobotStudioCatalog, RobotPolicyId, RobotSimulation, RobotReferencePreview,
} from '@deepseek-ai/dsh-robot-lab/types'
import { emptyLabSnapshot } from '../src/client/lab-client.ts'
import type { LabSnapshot } from '../src/client/lab-client.ts'

export const fixturePhysics: RobotPhysics = {
  actuator: 'bam', observationNoise: false, actionDelay: true,
  domainRandomization: false, randomYaw: false,
  bam: { source: 'fixture', parameters: { kt: 0.36 }, sha256: 'b'.repeat(64) },
}

export const fixtureProvenance: RobotRun['provenance'] = {
  trainer: { backend: 'cpu', learnerDevice: 'cpu', physicsDevice: 'cpu', pythonVersion: 'fixture', platform: 'fixture',
    architecture: 'fixture', hardware: 'fixture', dependencyVersions: {}, helperSha256: {}, recipe: {}, sha256: 'd'.repeat(64) },
  bam: fixturePhysics.bam, bridgeSha256: 'c'.repeat(64), dependencyVersions: { mujoco: 'fixture' },
  environment: { domainRandomization: false, randomYaw: false, standingSpawns: true,
    assistance: false, updateDevice: 'cpu', observationNoise: true, actionDelay: true },
}

export const fixtureUnavailableReadiness: RobotReadiness = {
  ready: false, reason: 'Python backend missing', versions: {}, defaultBackend: 'cpu', backends: {
    cpu: { available: false, reason: 'missing', learnerDevice: 'cpu', physicsDevice: 'cpu', versions: {} },
    mlx: { available: false, reason: 'MLX unavailable', learnerDevice: 'metal', physicsDevice: 'cpu', versions: {} },
  }, capabilities: {
    train: { available: false, reason: 'missing' }, simulate: { available: false, reason: 'missing' },
    evaluate: { available: false, reason: 'missing' }, deploy: { available: false, reason: 'unsafe' },
  },
}

export const fixtureRunningRun: RobotRun = {
  formatVersion: 3, id: 'run-one' as RobotRunId, state: 'running', createdAt: '2026-09-04', finishedAt: null,
  spec: { backend: 'cpu', name: 'dance', behaviorId: 'imitate', steps: 100, envs: 1, seed: 0, actuator: 'bam', weights: {}, clip: null },
  provenance: fixtureProvenance,
  observationProfile: 'microduck-standard-61', recipeHash: 'recipe', sourceFingerprint: 'source',
  progress: null, error: null, policyId: null, policySha256: null,
}

/** A complete physics-frame fixture; callers vary only measurements relevant to their test. */
export function sourceFrame(change: Partial<RobotFrame> = {}): RobotFrame {
  return { step: 1, time: 0.02, bodies: [[0, 0, 0.2, 1, 0, 0, 0]], reward: 0, terminated: false,
    telemetry: { jointPosition: Array<number>(14).fill(0.1), jointVelocity: Array<number>(14).fill(0.2),
      controllerTarget: Array<number>(14).fill(0.15), actuatorTorque: Array<number>(14).fill(0.01),
      rootBody: 'body', rootLinearVelocityWorld: [0.3, 0, 0], rootSpeed: 0.3, rootTilt: 0.05 }, ...change }
}

export const fixtureProfile: RobotProfile = {
  id: 'microduck' as RobotProfileId, label: 'MicroDuck', modelSha256: 'model-hash', rootBody: { name: 'body', index: 0 },
  joints: Array.from({ length: 14 }, (_, index) => ({ name: `joint_${index}`, index, lower: -1, upper: 1,
    defaultPosition: 0, unit: 'rad' as const })), hardwareAvailable: false,
}
export const fixtureTemplate: RobotTemplate = {
  id: 'gentle-sway' as RobotTemplateId, version: 1, label: 'Gentle sway', description: 'A small authored sway.',
  experimental: true, category: 'dance', difficulty: 'starter', behaviorId: 'imitate', trainingWeights: {},
  defaultParameters: { bpm: 120, beats: 8, moveSize: 0.25 },
}
export const fixtureCatalog: RobotStudioCatalog = {
  profiles: [fixtureProfile], templates: [fixtureTemplate],
  limits: { minBpm: 60, maxBpm: 160, beatChoices: [8, 16, 32], blockBeatChoices: [4, 8, 16], maxProjectBlocks: 8,
    maxClipSeconds: 60, maxClipKeys: 256 },
}
export const fixtureProject: RobotProjectRevision = {
  version: 2, id: 'revision-one' as RobotProjectRevisionId, projectId: 'project-one' as RobotProjectId,
  createdAt: '2026-09-04T00:00:00Z', sha256: 'project-hash', profile: fixtureProfile, template: fixtureTemplate,
  blocks: [{ template: fixtureTemplate, beats: 8, moveSize: 0.25 }], training: { behaviorId: 'imitate', weights: {} },
  recipe: { projectId: null, name: 'My routine', profileId: fixtureProfile.id, templateId: fixtureTemplate.id,
    templateVersion: 1, parameters: { ...fixtureTemplate.defaultParameters },
    music: { version: 1, style: 'disco', bpm: 120, beats: 8, seed: 0 } },
  clip: { version: 1, name: 'my-routine', duration: 4, loop: false,
    keys: [0, 4].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) },
}
export const fixtureSecondTemplate: RobotTemplate = {
  ...fixtureTemplate, id: 'hello' as RobotTemplateId, label: 'Hello', category: 'action',
}
export const fixtureBlockProject: RobotProjectRevision = {
  ...fixtureProject,
  recipe: { ...fixtureProject.recipe, blocks: [
    { templateId: fixtureTemplate.id, templateVersion: 1, beats: 4, moveSize: 1 },
    { templateId: fixtureSecondTemplate.id, templateVersion: 1, beats: 4, moveSize: 0.5 },
  ] },
  blocks: [{ template: fixtureTemplate, beats: 4, moveSize: 0.25 }, { template: fixtureSecondTemplate, beats: 4, moveSize: 0.125 }],
}

export const fixtureSimulation: RobotSimulation = {
  mode: 'recorded-simulation', policyId: 'policy-one' as RobotPolicyId, policyHash: 'policy-hash',
  observationProfile: 'microduck-lab-body-phase-61', controlHz: 50, physics: fixturePhysics, bamSettings: {},
  frames: [sourceFrame(), sourceFrame({ step: 100, time: 2, terminated: true })],
}
export const fixturePreview: RobotReferencePreview = {
  mode: 'kinematic-reference', projectRevisionId: fixtureProject.id, projectSha256: fixtureProject.sha256,
  controlHz: 50, limitations: ['Not physics-tested'],
  frames: [sourceFrame({ telemetry: { ...sourceFrame().telemetry, jointVelocity: null, controllerTarget: null,
    actuatorTorque: null, rootLinearVelocityWorld: null, rootSpeed: null } })],
}

/** Ready business data without any admitted training or selected recording. */
export function readySnapshot(): LabSnapshot {
  return { ...emptyLabSnapshot(), catalog: fixtureCatalog,
    readiness: { ...fixtureUnavailableReadiness, ready: true, reason: null,
      backends: { ...fixtureUnavailableReadiness.backends,
        cpu: { ...fixtureUnavailableReadiness.backends.cpu, available: true, reason: null } },
      capabilities: { ...fixtureUnavailableReadiness.capabilities,
        train: { available: true, reason: null }, simulate: { available: true, reason: null },
        evaluate: { available: true, reason: null } } },
    behaviors: [{ id: 'imitate', label: 'Imitate', description: 'Reference motion', defaultSteps: 100, terms: [] }],
    policies: [{ id: fixtureSimulation.policyId, name: 'Learned sway', runId: null, sha256: fixtureSimulation.policyHash,
      observationProfile: 'microduck-lab-body-phase-61' as const, verification: 'unverified' as const,
      runtimeCompatibility: { available: true, reason: null }, deployment: { available: false, reason: 'Hardware blocked' } }],
  }
}

export const fixtureIncompatibleRuns: RobotIncompatibleRun[] = [
  { id: 'run-unsupported-v2' as RobotRunId, formatVersion: 2, reason: 'Unsupported Robot Lab run format 2; files preserved.' },
  { id: 'run-unknown-format' as RobotRunId, formatVersion: null, reason: 'Missing format version; files preserved.' },
]
