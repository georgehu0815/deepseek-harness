import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RobotScene, RobotSceneKinematics } from '@deepseek-ai/dsh-robot-lab/types'
import { parseReply } from '../src/reply.ts'

const fixture = JSON.parse(readFileSync(new URL('../../../client/ui-robot-lab/tests/fixtures/clip-pose-mujoco.json', import.meta.url), 'utf8')) as { scene: RobotScene }
const parse = (scene: RobotScene) => parseReply(JSON.stringify({ operation: 'scene', scene }))

describe('optional native pose metadata at the Python reply parser', () => {
  it('preserves the real model metadata and accepts recorded-only scenes without a rig', () => {
    const encoded = JSON.stringify({ operation: 'scene', scene: fixture.scene })
    expect(parseReply(encoded)).toEqual(JSON.parse(encoded))
    const { kinematics: _, ...recorded } = fixture.scene
    expect(parse(recorded)).toEqual({ operation: 'scene', scene: recorded })
  })

  const invalid: Array<[string, (rig: RobotSceneKinematics, scene: RobotScene) => void]> = [
    ['root outside bodies', (rig) => { rig.rootBody = 999 }],
    ['fractional root', (rig) => { rig.rootBody = 1.5 }],
    ['world as root', (rig) => { rig.rootBody = 0 }],
    ['root position width', (rig) => { rig.rootPosition = [0, 0] }],
    ['root position nonfinite', (rig) => { rig.rootPosition[0] = Infinity }],
    ['missing body', (rig) => { rig.bodies.pop() }],
    ['missing hinge', (rig) => { rig.joints.pop() }],
    ['duplicate joint names', (_, scene) => { scene.jointNames[1] = scene.jointNames[0]! }],
    ['missing joint name', (_, scene) => { scene.jointNames.pop() }],
    ['empty joint name', (_, scene) => { scene.jointNames[0] = '' }],
    ['nonidentity world', (rig) => { rig.bodies[0]!.pos[0] = 1 }],
    ['world parent', (rig) => { rig.bodies[0]!.parent = 1 }],
    ['world rotation', (rig) => { rig.bodies[0]!.quat = [0, 0, 0, 1] }],
    ['forward parent', (rig) => { rig.bodies[2]!.parent = 3 }],
    ['cyclic parent', (rig) => { rig.bodies[2]!.parent = 2 }],
    ['another world root', (rig) => { rig.bodies[2]!.parent = 0 }],
    ['non-world root parent', (rig) => { rig.rootBody = 2 }],
    ['rest position width', (rig) => { rig.bodies[2]!.pos = [] }],
    ['rest quaternion width', (rig) => { rig.bodies[2]!.quat = [1, 0, 0] }],
    ['rest quaternion magnitude', (rig) => { rig.bodies[2]!.quat = [2, 0, 0, 0] }],
    ['hinge on world', (rig) => { rig.joints[0]!.body = 0 }],
    ['hinge on root', (rig) => { rig.joints[0]!.body = 1 }],
    ['duplicate driven body', (rig) => { rig.joints[1]!.body = rig.joints[0]!.body }],
    ['hinge anchor width', (rig) => { rig.joints[0]!.pos = [0] }],
    ['hinge axis width', (rig) => { rig.joints[0]!.axis = [1, 0] }],
    ['zero hinge axis', (rig) => { rig.joints[0]!.axis = [0, 0, 0] }],
    ['nonunit hinge axis', (rig) => { rig.joints[0]!.axis = [2, 0, 0] }],
    ['nonfinite reference', (rig) => { rig.joints[0]!.reference = Infinity }],
  ]
  it.each(invalid)('rejects %s before a client can use it', (_, mutate) => {
    const scene = structuredClone(fixture.scene)
    mutate(scene.kinematics!, scene)
    expect(() => parse(scene)).toThrow()
  })
})
