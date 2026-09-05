import { describe, expect, it } from 'vitest'
import { parseReply } from '../src/reply.ts'

const revisionId = 'revision-00000000-0000-0000-0000-000000000000'
const projectId = 'project-00000000-0000-0000-0000-000000000000'
function project() {
  const template = { id: 'disco-groove', version: 1, label: 'Disco Groove', description: 'Authored reference', experimental: true,
    category: 'dance', difficulty: 'intermediate', behaviorId: 'imitate', trainingWeights: { travel: 0 },
    defaultParameters: { bpm: 96, beats: 32, moveSize: 0.5 } }
  return {
    version: 2, id: revisionId, projectId, createdAt: '2026-09-04T00:00:00Z', sha256: 'a'.repeat(64),
    recipe: { projectId: null, name: 'Disco', profileId: 'microduck', templateId: 'disco-groove', templateVersion: 1,
      parameters: { bpm: 96, beats: 32, moveSize: 0.5 }, music: { version: 1, style: 'disco', bpm: 96, beats: 32, seed: 42 } },
    profile: { id: 'microduck', label: 'MicroDuck', modelSha256: 'b'.repeat(64), rootBody: { name: 'root', index: 1 },
      joints: Array.from({ length: 14 }, (_, index) => ({ name: `joint-${index}`, index: index + 1, lower: -1, upper: 1, defaultPosition: 0, unit: 'rad' })), hardwareAvailable: false },
    template, blocks: [{ template, beats: 32, moveSize: 0.5 }], training: { behaviorId: 'imitate', weights: { travel: 0 } },
    clip: { version: 1, name: 'Disco', duration: 20, loop: true,
      keys: [0, 20].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) },
  }
}
function frame() {
  return { step: 0, time: 0, bodies: [[0, 0, 0, 1, 0, 0, 0]], reward: 0, terminated: false,
    telemetry: { jointPosition: Array<number>(14).fill(0), jointVelocity: null,
      controllerTarget: null, actuatorTorque: null, rootBody: 'root', rootLinearVelocityWorld: null, rootSpeed: null, rootTilt: 0 } }
}

describe('Robot Studio process replies', () => {
  it('accepts actual-model catalog independently of backend readiness', () => {
    const saved = project()
    const reply = { operation: 'studio', catalog: { profiles: [saved.profile], templates: [saved.template],
      limits: { minBpm: 40, maxBpm: 200, beatChoices: [16, 32], blockBeatChoices: [4, 8, 16, 32], maxProjectBlocks: 8,
        maxClipSeconds: 120, maxClipKeys: 512 } } }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    expect(() => parseReply(JSON.stringify({ ...reply, catalog: { ...reply.catalog, profiles: [{ ...saved.profile, hardwareAvailable: true }] } }))).toThrow('hardware')
    expect(() => parseReply(JSON.stringify({ ...reply, catalog: { ...reply.catalog, templates: [{ ...saved.template, experimental: false }] } }))).toThrow('experimental')
  })
  it.each(['save_project', 'project'])('preserves complete immutable %s results', (operation) => {
    const reply = { operation, project: project() }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
  })
  it.each([' 我的鸭鸭 / ディスコ 🦆💃 ', '🦆'.repeat(64)])('preserves exact Unicode display name %s', (name) => {
    const saved = project()
    saved.recipe.name = name
    saved.clip.name = name
    const reply = { operation: 'project', project: saved }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
  })
  it.each([
    ['wrong version', (saved: ReturnType<typeof project>) => { saved.version = 1 }],
    ['bad identity', (saved: ReturnType<typeof project>) => { saved.id = '../other-session' }],
    ['bad hash', (saved: ReturnType<typeof project>) => { saved.sha256 = 'bad' }],
    ['invalid category', (saved: ReturnType<typeof project>) => { saved.template.category = 'learned' }],
    ['invalid difficulty', (saved: ReturnType<typeof project>) => { saved.template.difficulty = 'certified' }],
    ['missing reward behavior', (saved: ReturnType<typeof project>) => { saved.template.behaviorId = '' }],
    ['negative curated weight', (saved: ReturnType<typeof project>) => { saved.template.trainingWeights.travel = -1 }],
    ['music mismatch', (saved: ReturnType<typeof project>) => { saved.recipe.music.bpm = 120 }],
    ['model mismatch', (saved: ReturnType<typeof project>) => { saved.recipe.profileId = 'humanoid' }],
    ['unsupported model joints', (saved: ReturnType<typeof project>) => { saved.profile.joints.pop() }],
    ['wrong root', (saved: ReturnType<typeof project>) => { saved.profile.rootBody.index = 0 }],
    ['duplicate joint', (saved: ReturnType<typeof project>) => { saved.profile.joints[1]!.index = 1 }],
    ['joint limit violation', (saved: ReturnType<typeof project>) => { saved.clip.keys[0]!.joints[0] = 1.1 }],
    ['bad duration', (saved: ReturnType<typeof project>) => { saved.clip.duration = 10 }],
    ['mismatched display name', (saved: ReturnType<typeof project>) => { saved.clip.name = '鸭鸭' }],
    ['missing frozen blocks', (saved: ReturnType<typeof project>) => { saved.blocks = [] }],
    ['changed effective move size', (saved: ReturnType<typeof project>) => { saved.blocks[0]!.moveSize = 0.8 }],
    ['changed resolved behavior', (saved: ReturnType<typeof project>) => { saved.training.behaviorId = 'stand' }],
    ['changed resolved overrides', (saved: ReturnType<typeof project>) => { saved.training.weights.travel = 1 }],
    ['missing endpoint', (saved: ReturnType<typeof project>) => { saved.clip.keys[0]!.t = 1 }],
    ['loop discontinuity', (saved: ReturnType<typeof project>) => { saved.clip.keys[1]!.joints[0] = 0.1 }],
  ] as const)('rejects project with %s', (_label, mutate) => {
    const saved = project()
    mutate(saved)
    expect(() => parseReply(JSON.stringify({ operation: 'project', project: saved }))).toThrow()
  })
  it('validates whole-sequence training and bounds frozen block counts', () => {
    const saved = project()
    const stand = { ...saved.template, id: 'stand', label: 'Stand Steady', category: 'action', difficulty: 'starter',
      behaviorId: 'stand', trainingWeights: {} }
    const composed = { ...saved, template: stand,
      recipe: { ...saved.recipe, templateId: 'stand', blocks: [
        { templateId: 'stand', templateVersion: 1, beats: 16, moveSize: 1 },
        { templateId: 'disco-groove', templateVersion: 1, beats: 16, moveSize: 0.5 },
      ] },
      blocks: [{ template: stand, beats: 16, moveSize: 0.5 }, { template: saved.template, beats: 16, moveSize: 0.25 }],
    }
    const reply = { operation: 'project', project: composed }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    expect(() => parseReply(JSON.stringify(reply), { maxClipKeys: 2, maxClipSeconds: 20,
      maxProjects: 1, maxProjectBlocks: 1, maxSimulationSteps: 1 })).toThrow('maxProjectBlocks')
    composed.training.behaviorId = 'stand'
    expect(() => parseReply(JSON.stringify(reply))).toThrow('training')
    const standing = { ...composed, training: { behaviorId: 'stand', weights: {} },
      recipe: { ...composed.recipe, blocks: composed.recipe.blocks.map(block => ({ ...block, templateId: 'stand' })) },
      blocks: composed.blocks.map(block => ({ ...block, template: stand })),
    }
    expect(parseReply(JSON.stringify({ operation: 'project', project: standing }))).toEqual({ operation: 'project', project: standing })
  })
  it('enforces deployment collection and duration budgets on decoded replies', () => {
    const limits = { maxClipKeys: 2, maxClipSeconds: 20, maxProjects: 1, maxProjectBlocks: 1, maxSimulationSteps: 1 }
    const reply = { operation: 'projects', projects: [project()] }
    expect(parseReply(JSON.stringify(reply), limits)).toEqual(reply)
    expect(() => parseReply(JSON.stringify({ ...reply, projects: [project(), project()] }), limits)).toThrow('maxProjects')
    expect(() => parseReply(JSON.stringify(reply), { ...limits, maxClipKeys: 1 })).toThrow('clip limits')
    expect(() => parseReply(JSON.stringify(reply), { ...limits, maxClipSeconds: 19 })).toThrow('clip limits')
    const preview = { mode: 'kinematic-reference', projectRevisionId: revisionId, projectSha256: 'a'.repeat(64), controlHz: 50,
      frames: [frame(), frame(), frame()], limitations: [] }
    expect(() => parseReply(JSON.stringify({ operation: 'reference_preview', preview }), limits)).toThrow('maxSimulationSteps')
  })
  it('requires null reference measurements and nonnull recorded simulation measurements', () => {
    const measurements = { jointVelocity: Array<number>(14).fill(0), controllerTarget: Array<number>(14).fill(0),
      actuatorTorque: Array<number>(14).fill(0), rootLinearVelocityWorld: [0, 0, 0], rootSpeed: 0 }
    const recorded = { ...frame(), telemetry: { ...frame().telemetry, ...measurements } }
    const simulation = { mode: 'recorded-simulation', controlHz: 50, policyId: 'shipped:alpha_stand', policyHash: 'a'.repeat(64),
      observationProfile: 'microduck-standard-61', bamSettings: {}, frames: [recorded],
      physics: { actuator: 'bam', observationNoise: false, actionDelay: true, domainRandomization: false, randomYaw: false,
        bam: { source: 'fixture', sha256: 'a'.repeat(64), parameters: {} } },
    }
    expect(parseReply(JSON.stringify({ operation: 'simulate', simulation }))).toEqual({ operation: 'simulate', simulation })
    const preview = { mode: 'kinematic-reference', projectRevisionId: revisionId, projectSha256: 'a'.repeat(64),
      controlHz: 50, frames: [frame()], limitations: [] }
    for (const [key, value] of Object.entries(measurements)) {
      const invented = { ...frame(), telemetry: { ...frame().telemetry, [key]: value } }
      expect(() => parseReply(JSON.stringify({ operation: 'reference_preview', preview: { ...preview, frames: [invented] } }))).toThrow('null')
      for (const absent of [null, undefined]) {
        const missing = { ...recorded, telemetry: { ...recorded.telemetry, [key]: absent } }
        expect(() => parseReply(JSON.stringify({ operation: 'simulate', simulation: { ...simulation, frames: [missing] } }))).toThrow()
      }
    }
  })
  it('tags kinematic frames and rejects absent, malformed or wrongly tagged telemetry', () => {
    const preview = { mode: 'kinematic-reference', projectRevisionId: revisionId, projectSha256: 'a'.repeat(64), controlHz: 50,
      frames: [frame()], limitations: ['Kinematic posing is not dynamic feasibility evidence.'] }
    const reply = { operation: 'reference_preview', preview }
    expect(parseReply(JSON.stringify(reply))).toEqual(reply)
    expect(() => parseReply(JSON.stringify({ ...reply, preview: { ...preview, mode: 'recorded-simulation' } }))).toThrow('mode')
    for (const patch of [undefined, { ...frame().telemetry, jointPosition: [0] }, { ...frame().telemetry, rootTilt: 4 },
      { ...frame().telemetry, rootSpeed: -1 }, { ...frame().telemetry, actuatorTorque: [0] }]) {
      expect(() => parseReply(JSON.stringify({ ...reply, preview: { ...preview, frames: [{ ...frame(), telemetry: patch }] } }))).toThrow()
    }
  })
})
