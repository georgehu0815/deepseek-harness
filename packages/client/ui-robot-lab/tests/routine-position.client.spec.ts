import { describe, expect, it } from 'vitest'
import { routinePosition } from '../src/client/routine-position.ts'
import { fixtureBlockProject } from './fixtures.client.ts'

describe('frozen routine position', () => {
  const blocks = fixtureBlockProject.blocks
  it('does not invent a block for an empty project', () => {
    expect(routinePosition([], 120, 0)).toBeNull()
  })

  it.each([-2, 0])('clamps time %s to the beginning of the first block', (time) => {
    expect(routinePosition(blocks, 120, time)).toEqual({ index: 0, label: 'Gentle sway', firstBeat: 1, lastBeat: 4,
      localBeat: 0, fraction: 0 })
  })

  it('changes blocks exactly at the shared beat boundary, not one frame early', () => {
    expect(routinePosition(blocks, 120, 1.99)).toMatchObject({ index: 0, lastBeat: 4 })
    expect(routinePosition(blocks, 120, 2)).toEqual({ index: 1, label: 'Hello', firstBeat: 5, lastBeat: 8,
      localBeat: 0, fraction: 0 })
    expect(routinePosition(blocks, 120, 3)).toMatchObject({ index: 1, localBeat: 2, fraction: 0.5 })
  })

  it.each([4, 400])('holds the last block at and after the endpoint %s without wrapping', (time) => {
    expect(routinePosition(blocks, 120, time)).toEqual({ index: 1, label: 'Hello', firstBeat: 5, lastBeat: 8,
      localBeat: 4, fraction: 1 })
  })

  it('uses frozen BPM rather than assuming one fixed number of seconds per block', () => {
    expect(routinePosition(blocks, 60, 3)).toMatchObject({ index: 0, localBeat: 3, fraction: 0.75 })
    expect(routinePosition(blocks, 60, 4)).toMatchObject({ index: 1, localBeat: 0, fraction: 0 })
  })
})
