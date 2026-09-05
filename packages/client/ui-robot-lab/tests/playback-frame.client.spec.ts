import { describe, expect, it } from 'vitest'
import type { RobotFrame } from '@deepseek-ai/dsh-robot-lab/types'
import { playbackFrame } from '../src/client/playback-frame.ts'

import { sourceFrame } from './fixtures.client.ts'

const frame = (step: number, time: number): RobotFrame => sourceFrame({ step, time, bodies: [] })

describe('recorded simulation playback', () => {
  it('uses recorded times rather than treating 25 Hz frames as 50 Hz policy steps', () => {
    const frames = [frame(1, 0.02), frame(3, 0.06), frame(5, 0.1)]
    expect(playbackFrame(frames, 0)).toBe(frames[0])
    expect(playbackFrame(frames, 0.04)).toBe(frames[0])
    expect(playbackFrame(frames, 0.06)).toBe(frames[1])
    expect(playbackFrame(frames, 0.09)).toBe(frames[1])
    expect(playbackFrame(frames, 0.1)).toBe(frames[2])
  })

  it('holds the last pose after a recording ends', () => {
    const frames = [frame(0, 0), frame(4, 0.08)]
    expect(playbackFrame(frames, 10)).toBe(frames[1])
    expect(playbackFrame(frames, 0)).toBe(frames[0])
  })

  it('does not invent a pose for an empty recording', () => {
    expect(playbackFrame([], 1)).toBeUndefined()
  })
})
