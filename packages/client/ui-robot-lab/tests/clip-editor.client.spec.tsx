// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RobotClip } from '@deepseek-ai/dsh-robot-lab/types'
import { ClipEditor } from '../src/client/ClipEditor.tsx'

afterEach(cleanup)

it('explains a missing keyframe draft in English', () => {
  const clip: RobotClip = { version: 1, name: 'dance', duration: 4, loop: false, keys: [] }
  const { getByText } = render(<ClipEditor clip={clip} jointNames={[]} onChange={vi.fn()} />)
  expect(getByText('Provide at least two keyframes first.')).toBeTruthy()
})

it('edits one selected joint without mutating another keyframe', () => {
  const clip: RobotClip = { version: 1, name: 'dance', duration: 4, loop: false,
    keys: [0, 4].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) }
  const onChange = vi.fn()
  const { getByLabelText } = render(<ClipEditor clip={clip} jointNames={['Left hip']} onChange={onChange} />)
  fireEvent.change(getByLabelText('Current keyframe'), { target: { value: '1' } })
  fireEvent.change(getByLabelText('Left hip'), { target: { value: '0.25' } })
  const next = onChange.mock.calls[0]![0] as RobotClip
  expect(next.keys[0]!.joints[0]).toBe(0)
  expect(next.keys[1]!.joints[0]).toBe(0.25)
  expect(clip.keys[1]!.joints[0]).toBe(0)
})

it('extends the clip by duplicating the last pose at the next interval', () => {
  const clip: RobotClip = { version: 1, name: 'dance', duration: 4, loop: true,
    keys: [0, 4].map(t => ({ t, joints: Array<number>(14).fill(0), rootPitch: 0 })) }
  const onChange = vi.fn()
  const { getByRole } = render(<ClipEditor clip={clip} jointNames={[]} onChange={onChange} />)
  fireEvent.click(getByRole('button', { name: 'Duplicate last frame and extend clip' }))
  const next = onChange.mock.calls[0]![0] as RobotClip
  expect(next.duration).toBe(8)
  expect(next.keys.map(key => key.t)).toEqual([0, 4, 8])
  expect(next.keys[2]!.joints).not.toBe(clip.keys[1]!.joints)
})
