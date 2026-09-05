/** Bounded, deterministic ground albedo textures; no external assets or terrain displacement. */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'
import type { ViewerSurface } from './viewer-presets.ts'

/**
 * Create one 256-square RGBA texture for a half-meter ground tile.
 * @param surface - purely visual ground selection.
 * @returns an owned texture; the caller must dispose it on replacement or unmount.
 */
export function createSurfaceTexture(surface: ViewerSurface): DataTexture {
  const resolution = 256
  const pixels = new Uint8Array(resolution * resolution * 4)
  const base = { studio: [155, 172, 188], concrete: [157, 156, 150], sand: [205, 177, 124], grass: [91, 120, 65] }[surface]
  let seed = 1739
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const noise = random() - 0.5
    const broad = Math.sin(x * Math.PI / 32) * Math.cos(y * Math.PI / 64)
    let grain: number
    switch (surface) {
      case 'studio': {
        const major = x < 2 || y < 2
        const minor = x % 51 < 1 || y % 51 < 1
        grain = major ? -28 : minor ? -12 : noise * 2
        break
      }
      case 'concrete': grain = noise * 23 + broad * 4; break
      case 'sand': grain = noise * 19 + broad * 5; break
      case 'grass': grain = noise * 29 + broad * 9 + Math.sin(x * 1.7 + y * 0.3) * 5; break
    }
    const offset = (y * resolution + x) * 4
    for (const [channel, value] of base.entries()) pixels[offset + channel] = Math.round(value + grain)
    pixels[offset + 3] = 255
  }
  const texture = new DataTexture(pixels, resolution, resolution, RGBAFormat)
  texture.name = `robot-studio-${surface}`
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
