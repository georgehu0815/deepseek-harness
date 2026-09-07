// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'
import { robotRpcFixture } from './snapshots/robot-studio/rpc-fixture.ts'
import { clipPartScene } from '../../../packages/client/ui-robot-lab/tests/clip-part-fixture.ts'

installAssembledBootEnv()

it('loads planted-foot walking turns through the built plugin graph without admitting a training run', async () => {
  const network = vi.fn(() => { throw new Error('Walking preview must not use network transport') })
  vi.stubGlobal('fetch', network); vi.stubGlobal('WebSocket', network)
  vi.stubGlobal('innerWidth', 1920); vi.stubGlobal('__fxTiming', undefined)
  const scene = clipPartScene()
  const fixture = robotRpcFixture({ sessionIds: ['fx-alpha'] })
  const respond: typeof fixture.respond = (sessionId, request) => {
    const result = fixture.respond(sessionId, request)
    if (result.operation === 'scene') result.scene = structuredClone(scene)
    if (result.operation === 'studio') {
      result.catalog.limits.maxClipKeys = 512
      result.catalog.profiles[0]!.joints.forEach((joint, index) => {
        joint.name = scene.jointNames[index]!; joint.index = index + 1
        joint.defaultPosition = scene.defaultJoints[index]!
      })
    }
    return result
  }
  mountAssembledApp('?fixture&fixtureRobot=studio', ['robot-lab'])
  await waitFor(() => {
    const timing = (globalThis as typeof globalThis & {
      __fxTiming?: { setRobotLabResponder: (responder: typeof respond) => void }
    }).__fxTiming
    expect(timing).toBeDefined(); timing?.setRobotLabResponder(respond)
  })
  const tree = await screen.findByRole('tree', { name: 'Sessions' })
  fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
  fireEvent.click(await screen.findByRole('tab', { name: 'RL Training' }))
  const lab = await screen.findByRole('region', { name: 'Micro Duck control panel' })
  await within(lab).findByText('Local robot lab connected')
  fireEvent.click(screen.getByRole('tab', { name: 'Clip & Motion Gen' }))
  const panel = await screen.findByRole('region', { name: 'Clip Gen' })
  const before = fixture.requests.length
  fireEvent.click(within(panel).getByRole('button', { name: 'Walk left 360° + right 360° · 20 s' }))
  const heading = within(panel).getByRole('slider', { name: 'Heading · preview only' })
  const timeline = within(panel).getByRole('slider', { name: 'Animation timeline' })
  const angles: string[] = []
  for (const time of [0, 6, 10, 14, 18, 20]) {
    fireEvent.change(timeline, { target: { value: String(time) } })
    angles.push(`${time}s: ${heading.getAttribute('aria-valuetext')}`)
  }
  const training = within(panel).getByRole<HTMLButtonElement>('button', { name: 'Use for training' })
  fireEvent.click(training)
  expect({ angles, poseEditsLocked: heading.closest('fieldset')!.disabled, trainingDisabled: training.disabled,
    keyCount: within(panel).getAllByRole('button', { name: /^Key at / }).length,
    guide: within(panel).getByLabelText<HTMLTextAreaElement>('What should the duck do?').value }).toMatchInlineSnapshot(`
      {
        "angles": [
          "0s: 0.000 rad · 0.0°",
          "6s: 3.142 rad · 180.0°",
          "10s: 6.283 rad · 360.0°",
          "14s: 3.142 rad · 180.0°",
          "18s: 0.000 rad · 0.0°",
          "20s: 0.000 rad · 0.0°",
        ],
        "guide": "120 BPM · 0–2 s: neutral double support; 2–10 s: 32 short alternating steps turn left one full circle; 10–18 s: reverse the stepping order and turn right one full circle; 18–20 s: neutral double support. Each swing foot lifts about 5 mm; the support foot is held in place while the body translates and sways. Kinematic preview only, not physics-tested balance.",
        "keyCount": 259,
        "poseEditsLocked": true,
        "trainingDisabled": true,
      }
    `)
  expect(fixture.requests.slice(before).some(({ request }) => ['train', 'train_trial', 'simulate', 'evaluate'].includes(request.operation))).toBe(false)
  expect(network).not.toHaveBeenCalled()
})
