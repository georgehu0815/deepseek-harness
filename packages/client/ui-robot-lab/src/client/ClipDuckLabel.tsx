/** Canvas-owned labels identify companions in both the viewport and the recorded MP4. */
import { useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'

/**
 * Draw a localized duck label as a camera-facing sprite in the captured scene.
 * @param props - complete localized label and model-sized sprite dimensions.
 * @returns a sprite whose texture is released on label replacement or removal.
 */
export function ClipDuckLabel({ label, size }: { label: string; size: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 64
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Duck labels require a canvas drawing context')
    context.fillStyle = 'rgba(15, 25, 40, 0.85)'; context.fillRect(0, 0, 256, 64)
    context.fillStyle = '#ffffff'; context.font = '32px sans-serif'
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, 128, 32, 240)
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace
    return map
  }, [label])
  useEffect(() => () => { texture.dispose() }, [texture])
  return <sprite scale={[size, size / 4, 1]}><spriteMaterial map={texture} depthWrite={false} /></sprite>
}
