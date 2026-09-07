// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RobotProfile, RobotScene } from '@deepseek-ai/dsh-robot-lab/types'
import { ClipPoseControls } from '../src/client/ClipPoseControls.tsx'
import { createClipGenStore, type ClipGenDraft } from '../src/client/clip-gen-store.ts'
import type { ClipGenProps } from '../src/client/clip-gen-props.ts'
import { clipEn, clipZh } from '../src/client/clip-gen-locales.ts'
import { applyClipRig, clipRigs, compileClip, defaultClipPose, measureClipRig, rootPitchLimit, type ClipRig } from '../src/client/clip-motion.ts'
import { rootYawLimit } from '../src/client/clip-preview.ts'
import { fixtureProfile } from './fixtures.client.ts'
import { poseFixture } from './clip-pose-fixture.ts'
import { clipPartScene } from './clip-part-fixture.ts'

afterEach(cleanup)

const profile: RobotProfile = { ...fixtureProfile, joints: fixtureProfile.joints.map((joint, index) => ({
  ...joint, name: poseFixture.scene.jointNames[index]!, index: index + 1,
  lower: -1 - index / 100, upper: 1 + index / 100, defaultPosition: index / 100,
})) }

function mount({ copy = clipEn, scene = null, state = {} }: {
  copy?: Record<keyof typeof clipEn, string>
  scene?: RobotScene | null
  state?: Partial<ClipGenDraft>
} = {}) {
  const store = createClipGenStore(120, 8).create()
  store.actions.load(compileClip(profile, [{ action: 'stand', beats: 2 }], 120, 0.5, 'Pose', false))
  store.actions.mode('joints')
  const actions = { ...store.actions, joint: vi.fn(store.actions.joint), select: vi.fn(store.actions.select),
    heading: vi.fn(store.actions.heading), pose: vi.fn(store.actions.pose) }
  const t: ClipGenProps['t'] = (key, params) => {
    const template = copy[key as keyof typeof copy]
    return params === undefined ? template
      : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
  }
  const panel = () => <ClipPoseControls state={{ ...store.getSnapshot(), ...state }}
    profile={profile} scene={scene} actions={actions} t={t} />
  const view = render(panel())
  return { ...view, store, actions, t, sync: () => { view.rerender(panel()) } }
}

function change(input: HTMLElement, value: string | number) {
  fireEvent.change(input, { target: { value: String(value) } })
}

describe('shared Clip Gen pose controls', () => {
  it.each([clipEn, clipZh])('keeps all fourteen servo slider names and adds localized exact radians', (copy) => {
    const view = mount({ copy, scene: clipPartScene() })
    expect(view.getByText(copy.anatomyHint)).toBeTruthy()
    expect(view.getAllByRole('spinbutton')).toHaveLength(16)
    for (const [index, joint] of profile.joints.entries()) {
      const slider = view.getByRole('slider', { name: joint.name }) as HTMLInputElement
      const exact = view.getByRole('spinbutton', { name: copy.preciseAngle.replace('{name}', joint.name) }) as HTMLInputElement
      expect(slider.min).toBe(String(joint.lower))
      expect(slider.max).toBe(String(joint.upper))
      expect(slider.step).toBe('0.001')
      expect(exact.min).toBe(slider.min)
      expect(exact.max).toBe(slider.max)
      expect(exact.step).toBe('any')
      expect(exact.valueAsNumber).toBe(joint.defaultPosition)
      for (const id of exact.getAttribute('aria-describedby')!.split(' ')) expect(document.getElementById(id)?.textContent).toBeTruthy()
      expect(slider.closest('label')!.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      change(exact, 0.123456789)
      expect(view.actions.select).toHaveBeenLastCalledWith(index)
      expect(view.actions.joint).toHaveBeenLastCalledWith(profile, index, 0.123456789)
      view.sync()
      expect(exact.valueAsNumber).toBe(0.123456789)
      expect(slider.valueAsNumber).toBe(0.123456789)
      expect(view.store.getSnapshot()).toMatchObject({ selectedJoint: index, unkeyed: true })
      expect(view.store.getSnapshot().clip!.keys[0]!.joints[index]).toBe(joint.defaultPosition)
      change(slider, 0.25)
      view.sync()
      expect(exact.valueAsNumber).toBe(0.25)
      fireEvent.click(view.getByRole('button', { name: copy.reset.replace('{name}', joint.name) }))
      view.sync()
      expect(exact.valueAsNumber).toBe(joint.defaultPosition)
    }
  })

  it('rejects empty, non-finite and out-of-range joint input without selecting or dispatching', () => {
    const view = mount()
    const joint = profile.joints[3]!
    const input = view.getByRole('spinbutton', { name: view.t('preciseAngle', { name: joint.name }) })
    for (const invalid of ['', 'NaN', 'Infinity', '1e309', joint.lower - 0.001, joint.upper + 0.001]) change(input, invalid)
    expect(view.actions.select).not.toHaveBeenCalled()
    expect(view.actions.joint).not.toHaveBeenCalled()
    for (const bound of [joint.lower, joint.upper]) {
      change(input, bound)
      expect(view.actions.joint).toHaveBeenLastCalledWith(profile, 3, bound)
      view.sync()
    }
  })

  it('allows sequential negative entry without replacing temporary text on unchanged numeric values', () => {
    const view = mount()
    const input = view.getByRole('spinbutton', { name: view.t('preciseAngle', { name: 'head_yaw' }) }) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.input(input, { target: { value: '' } })
    view.sync()
    expect(input.value).toBe('')
    expect(view.actions.joint).not.toHaveBeenCalled()
    fireEvent.input(input, { target: { value: '-' } })
    expect(view.actions.joint).not.toHaveBeenCalled()
    fireEvent.input(input, { target: { value: '-0' } })
    view.sync()
    expect(input.value).toBe('-0')
    expect(view.actions.joint).toHaveBeenLastCalledWith(profile, 7, -0)
    fireEvent.input(input, { target: { value: '-0.2' } })
    view.sync()
    expect(input.value).toBe('-0.2')
    expect(view.actions.joint).toHaveBeenLastCalledWith(profile, 7, -0.2)
    fireEvent.input(input, { target: { value: '-0.20' } })
    view.sync()
    expect(input.value).toBe('-0.20')
    expect(view.store.getSnapshot().pose!.joints[7]).toBe(-0.2)
    fireEvent.blur(input)
    expect(input.value).toBe('-0.2')
  })

  it('restores the committed angle on blur after empty or invalid edits without dispatching', () => {
    const view = mount()
    const input = view.getByRole('spinbutton', { name: view.t('preciseAngle', { name: 'head_yaw' }) }) as HTMLInputElement
    for (const invalid of ['', '-', '1e309', '-99', '99']) {
      fireEvent.focus(input)
      fireEvent.input(input, { target: { value: invalid } })
      view.sync()
      expect(view.actions.joint).not.toHaveBeenCalled()
      expect(view.actions.select).not.toHaveBeenCalled()
      fireEvent.blur(input)
      expect(input.valueAsNumber).toBe(profile.joints[7]!.defaultPosition)
    }
  })

  it('replaces unfinished numeric text when another pose control changes the committed value', () => {
    const view = mount()
    const input = view.getByRole('spinbutton', { name: view.t('preciseAngle', { name: 'head_yaw' }) }) as HTMLInputElement
    const slider = view.getByRole('slider', { name: 'head_yaw' })
    for (const [text, value] of [['', 0.3], ['99', 0.4]] as const) {
      fireEvent.input(input, { target: { value: text } })
      expect(input.value).toBe(text)
      change(slider, value)
      view.sync()
      expect(input.valueAsNumber).toBe(value)
      fireEvent.blur(input)
      expect(input.valueAsNumber).toBe(value)
    }
  })

  it.each([
    { key: 'root', limit: rootPitchLimit },
    { key: 'heading', limit: rootYawLimit },
  ] as const)('edits exact $key radians and retains reset, slider and numeric bounds', ({ key, limit }) => {
    const view = mount()
    const input = view.getByRole('spinbutton', { name: view.t('preciseAngle', { name: view.t(key) }) }) as HTMLInputElement
    const slider = view.getByRole('slider', { name: view.t(key) }) as HTMLInputElement
    const callback = key === 'root' ? view.actions.joint : view.actions.heading
    expect(input.min).toBe(String(-limit))
    expect(input.max).toBe(String(limit))
    expect(input.valueAsNumber).toBe(0)
    for (const invalid of ['', '1e309', -limit - 0.001, limit + 0.001]) change(input, invalid)
    expect(callback).not.toHaveBeenCalled()
    for (const value of [0.123456789, -limit, limit]) {
      change(input, value)
      view.sync()
      expect(input.valueAsNumber).toBe(value)
      expect(slider.valueAsNumber).toBe(value)
      if (key === 'root') expect(view.actions.joint).toHaveBeenLastCalledWith(profile, -1, value)
      else expect(view.actions.heading).toHaveBeenLastCalledWith(value)
    }
    change(slider, 0.25)
    view.sync()
    expect(input.valueAsNumber).toBe(0.25)
    fireEvent.click(view.getByRole('button', { name: view.t('reset', { name: view.t(key) }) }))
    view.sync()
    expect(input.valueAsNumber).toBe(0)
    if (key === 'heading') {
      expect(view.store.getSnapshot().clip!.version).toBe(2)
      expect(view.getByText(clipEn.previewOnly)).toBeTruthy()
    }
  })

  it.each([clipEn, clipZh])('retains all rig sliders, precise bounded amounts, reset and joint-mode access', (copy) => {
    const view = mount({ copy })
    fireEvent.click(view.getByRole('button', { name: copy.rig }))
    view.sync()
    expect(view.getByText(copy.rigControlHint)).toBeTruthy()
    for (const rig of Object.keys(clipRigs) as ClipRig[]) {
      const name = view.t(`rig.${rig}`)
      const input = view.getByRole('spinbutton', { name: view.t('preciseAmount', { name }) }) as HTMLInputElement
      const slider = view.getByRole('slider', { name }) as HTMLInputElement
      const before = view.store.getSnapshot().pose!
      const range = measureClipRig(profile, before, rig)
      expect(input.min).toBe(String(range.lower))
      expect(input.max).toBe(String(range.upper))
      view.actions.pose.mockClear()
      for (const invalid of ['', '1e309', range.lower - 0.001, range.upper + 0.001]) change(input, invalid)
      expect(view.actions.pose).not.toHaveBeenCalled()
      change(input, 0.123456789)
      expect(view.actions.pose).toHaveBeenLastCalledWith(applyClipRig(profile, before, rig, 0.123456789))
      expect(view.store.getSnapshot()).toMatchObject({ rig, unkeyed: true })
      view.sync()
      expect(input.valueAsNumber).toBeCloseTo(0.123456789, 12)
      expect(slider.valueAsNumber).toBe(input.valueAsNumber)
      change(slider, 0.25)
      view.sync()
      expect(input.valueAsNumber).toBeCloseTo(0.25, 12)
      fireEvent.click(view.getByRole('button', { name: view.t('reset', { name }) }))
      view.sync()
      expect(input.valueAsNumber).toBeCloseTo(0, 12)
    }
    fireEvent.click(view.getByRole('button', { name: copy.joints }))
    view.sync()
    expect(view.getAllByRole('spinbutton')).toHaveLength(16)
    fireEvent.click(view.getByRole('button', { name: 'head_yaw' }))
    expect(view.store.getSnapshot().selectedJoint).toBe(7)
    change(view.getByRole('spinbutton', { name: view.t('preciseAngle', { name: 'head_yaw' }) }), 0.8)
    fireEvent.click(view.getByRole('button', { name: copy.defaultPose }))
    view.sync()
    expect(view.store.getSnapshot().pose).toEqual(defaultClipPose(profile))
  })

  it.each(['export', 'walking'] as const)('locks all joint and rig controls during %s', (reason) => {
    const reference = compileClip(profile, [{ action: 'stand', beats: 2 }], 120, 0.5, 'Walking', false)
    const walking: ClipGenDraft['clip'] = { ...reference, version: 3, modelSha256: profile.modelSha256, contacts: [],
      keys: reference.keys.map(key => ({ ...key, rootYaw: 0, rootRoll: 0, rootPosition: [0, 0, 0.2] })) }
    const state: Partial<ClipGenDraft> = reason === 'export' ? { exporting: true } : { clip: walking }
    const view = mount({ state: { ...state, mode: 'rig' } })
    const editor = view.getByRole('button', { name: clipEn.defaultPose }).closest('fieldset')!
    expect(editor.disabled).toBe(true)
    expect(editor.querySelectorAll('input[type="number"]')).toHaveLength(25)
    for (const control of editor.querySelectorAll('input, button')) expect(control.matches(':disabled')).toBe(true)
    if (reason === 'walking') expect(view.getByText(clipEn.walkingLocked)).toBeTruthy()
    else expect(view.queryByText(clipEn.walkingLocked)).toBeNull()
  })

  it.each(['clip', 'pose'] as const)('renders nothing when the %s is absent', (missing) => {
    const view = mount({ state: { [missing]: null } })
    expect(view.container.textContent).toBe('')
    expect(view.queryAllByRole('spinbutton')).toHaveLength(0)
  })

  it('keeps exact fields synchronized across shared views without duplicate description IDs', () => {
    const view = mount()
    const props = { state: view.store.getSnapshot(), profile, scene: null, actions: view.actions, t: view.t }
    view.rerender(<><ClipPoseControls {...props} /><ClipPoseControls {...props} /></>)
    const inputs = view.getAllByRole('spinbutton', { name: view.t('preciseAngle', { name: 'head_yaw' }) }) as HTMLInputElement[]
    expect(inputs[0]!.getAttribute('aria-describedby')).not.toBe(inputs[1]!.getAttribute('aria-describedby'))
    change(inputs[1]!, 0.543219876)
    const updated = { ...props, state: view.store.getSnapshot() }
    view.rerender(<><ClipPoseControls {...updated} /><ClipPoseControls {...updated} /></>)
    for (const input of inputs) expect(input.valueAsNumber).toBe(0.543219876)
  })
})
