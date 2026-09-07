import { describe, expect, it } from 'vitest'
import { createClipStageSettings } from '../src/client/clip-stage-settings.ts'

describe('Clip Gen viewing defaults', () => {
  it('creates independent studio settings with pose gestures enabled', () => {
    const first = createClipStageSettings()
    expect(first).toEqual({ surface: 'studio', ground: true, grid: false, axes: false,
      background: '#dce5ed', lightIntensity: 1, wireframe: false, cameraView: 'perspective', cameraMode: 'pose', cameraZoom: 1 })
    const second = createClipStageSettings()
    first.cameraMode = 'pan'
    first.ground = false
    expect(second.cameraMode).toBe('pose')
    expect(second.ground).toBe(true)
  })
})
