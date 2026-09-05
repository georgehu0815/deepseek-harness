import { describe, expect, it, vi } from 'vitest'
import { LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three'
import { createSurfaceTexture } from '../src/client/viewer-surface.ts'
import { SURFACE_PRESETS } from '../src/client/viewer-presets.ts'

describe('flat procedural ground', () => {
  it.each(SURFACE_PRESETS)('creates deterministic bounded $label albedo with owned disposal', ({ id }) => {
    const first = createSurfaceTexture(id)
    const second = createSurfaceTexture(id)
    expect(first.image.width).toBe(256)
    expect(first.image.height).toBe(256)
    expect(first.image.data.byteLength).toBe(256 * 256 * 4)
    expect(first.image.data).toEqual(second.image.data)
    expect(first.image.data).not.toBe(second.image.data)
    expect(first.wrapS).toBe(RepeatWrapping)
    expect(first.wrapT).toBe(RepeatWrapping)
    expect(first.colorSpace).toBe(SRGBColorSpace)
    expect(first.minFilter).toBe(LinearMipmapLinearFilter)
    const disposed = vi.fn()
    first.addEventListener('dispose', disposed)
    first.dispose()
    expect(disposed).toHaveBeenCalledTimes(1)
    second.dispose()
  })

  it('gives each floor a distinct palette and keeps opaque pixels', () => {
    const textures = SURFACE_PRESETS.map(({ id }) => createSurfaceTexture(id))
    const palettes = textures.map(texture => Array.from(texture.image.data.slice(0, 3)).join(','))
    expect(new Set(palettes).size).toBe(4)
    for (const texture of textures) {
      expect(texture.image.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
      texture.dispose()
    }
  })
})
