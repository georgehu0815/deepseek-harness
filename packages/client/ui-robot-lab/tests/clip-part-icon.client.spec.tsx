// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ClipPartIcon } from '../src/client/ClipPartIcon.tsx'
import { buildClipPartArtwork } from '../src/client/clip-part-artwork.ts'
import { clipPartScene } from './clip-part-fixture.ts'

afterEach(cleanup)

function pathData(group: Element): Array<string | null> {
  return Array.from(group.querySelectorAll('path'), path => path.getAttribute('d'))
}

describe('decorative clip part icons', () => {
  it('renders an inaccessible, nonfocusable SVG without product copy, tooltip or canvas', () => {
    const artwork = buildClipPartArtwork(clipPartScene())!
    const { container } = render(<ClipPartIcon artwork={artwork} joints={[0]} className="caller-size" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(svg.hasAttribute('tabindex')).toBe(false)
    expect(svg.getAttribute('viewBox')).toBe(artwork.viewBox)
    expect(svg.classList.contains('caller-size')).toBe(true)
    expect(svg.textContent).toBe('')
    expect(svg.querySelector('title, text, canvas')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('reuses the whole-duck context and overlays distinct left, right, head and root body paths', () => {
    const artwork = buildClipPartArtwork(clipPartScene())!
    const before = structuredClone(artwork)
    const { container, rerender } = render(<ClipPartIcon artwork={artwork} joints={[0]} />)
    const selections: Array<Array<string | null>> = []
    for (const joint of [0, 9, 8, -1]) {
      rerender(<ClipPartIcon artwork={artwork} joints={joint < 0 ? [] : [joint]} root={joint < 0} />)
      const [context, selected] = container.querySelectorAll('svg > g')
      expect(pathData(context!)).toEqual(artwork.bodies.map(body => body.path))
      const paths = pathData(selected!)
      expect(paths).toEqual(artwork.bodies.filter(body => body.joint === joint).map(body => body.path))
      expect(paths.length).toBeGreaterThan(0)
      selections.push(paths)
    }
    expect(new Set(selections.map(paths => JSON.stringify(paths))).size).toBe(4)
    expect(artwork).toEqual(before)
  })

  it('selects the union of root and coupled joints, with empty joints selecting the whole duck', () => {
    const artwork = buildClipPartArtwork(clipPartScene())!
    const { container, rerender } = render(<ClipPartIcon artwork={artwork} joints={[]} />)
    expect(pathData(container.querySelectorAll('svg > g')[1]!)).toEqual(artwork.bodies.map(body => body.path))
    rerender(<ClipPartIcon artwork={artwork} joints={[0, 2, 9]} root />)
    expect(pathData(container.querySelectorAll('svg > g')[1]!))
      .toEqual(artwork.bodies.filter(body => [-1, 0, 2, 9].includes(body.joint!)).map(body => body.path))
    rerender(<ClipPartIcon artwork={artwork} joints={[0, 0, 9]} />)
    expect(pathData(container.querySelectorAll('svg > g')[1]!))
      .toEqual(artwork.bodies.filter(body => [0, 9].includes(body.joint!)).map(body => body.path))
  })

  it('highlights fixed descendants with their nearest joint but not unrelated world attachments', () => {
    const scene = clipPartScene()
    const rig = scene.kinematics!
    const fixed = scene.bodies.length
    for (const [index, parent] of [rig.joints[8]!.body, fixed, 0].entries()) {
      scene.bodies.push(`attachment-${index}`)
      rig.bodies.push({ parent, pos: [0.02, 0, 0], quat: [1, 0, 0, 0] })
      scene.geoms.push({ ...scene.geoms[0]!, body: fixed + index })
    }
    const artwork = buildClipPartArtwork(scene)!
    const { container } = render(<ClipPartIcon artwork={artwork} joints={[8]} />)
    const selected = pathData(container.querySelectorAll('svg > g')[1]!)
    expect(selected).toHaveLength(3)
    expect(selected).toEqual(artwork.bodies.filter(body => [rig.joints[8]!.body, fixed, fixed + 1].includes(body.body))
      .map(body => body.path))
  })

  it('uses the same generic mechanical fallback for unavailable artwork regardless of claimed part', () => {
    const { container, rerender } = render(<ClipPartIcon artwork={null} joints={[]} />)
    const svg = container.querySelector('svg')!
    const initial = svg.innerHTML
    expect(svg.querySelectorAll('circle')).toHaveLength(2)
    expect(svg.querySelectorAll('path')).toHaveLength(1)
    expect(svg.getAttribute('viewBox')).toBe('0 0 64 64')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    for (const joints of [[0], [8], [9]]) {
      rerender(<ClipPartIcon artwork={null} joints={joints} root />)
      expect(svg.innerHTML).toBe(initial)
    }
    expect(svg.textContent).toBe('')
  })
})
