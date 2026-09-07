/** Decorative model-derived part thumbnails; labels belong to the containing control. */
import clsx from 'clsx'
import type { ClipPartArtwork } from './clip-part-artwork.ts'
import css from './ClipPartIcon.module.css'

/** Plain inputs for a reusable, subscription-free SVG primitive. */
export interface ClipPartIconProps {
  artwork: ClipPartArtwork | null
  /** Joint indices in installed model order; empty selects the whole duck unless root is true. */
  joints: readonly number[]
  /** Include the trunk and fixed root attachments alongside any selected joints. */
  root?: boolean
  className?: string | undefined
}

/**
 * Highlight selected nearest-joint owners over the complete muted duck.
 * @param props - shared scene artwork and controlled selection; no geometry uses a generic mechanical joint glyph.
 * @returns a nonfocusable SVG hidden from assistive technology, without text or tooltips.
 */
export function ClipPartIcon({ artwork, joints, root = false, className }: ClipPartIconProps) {
  const selected = artwork === null ? [] : artwork.bodies.filter(body => (joints.length === 0 && !root)
    || (root && body.joint === -1) || (body.joint !== null && joints.includes(body.joint)))
  return <svg className={clsx(css.icon, className)} viewBox={artwork?.viewBox ?? '0 0 64 64'}
    aria-hidden="true" focusable="false">
    {artwork === null ? <g className={css.fallback}>
      <path d="M10 16L24 30M40 34L54 48" />
      <circle cx="32" cy="32" r="13" />
      <circle cx="32" cy="32" r="4" />
    </g> : <>
      <g className={css.context}>
        {artwork.bodies.map(body => <path key={body.body} d={body.path} />)}
      </g>
      <g className={css.selected}>
        {selected.map(body => <path key={body.body} d={body.path} />)}
      </g>
    </>}
  </svg>
}
