/**
 * Pure concession-chain column solver for the four-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by first
 * shrinking the earth column, then details, then auto-closing earth, then
 * details (derived zero width — preferred width preferences are never
 * rewritten, so widening the window restores them). The sidebar never
 * concedes: its rendered width is always the drag preference (or the collapsed
 * rail), and center absorbs any remaining deficit as the last resort. Inputs
 * are the layout store's plain width preferences (0 = closed); a closed sidebar
 * resolves to the fixed SIDEBAR_COLLAPSED control rail while closed details and
 * earth resolve to zero width. The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed
 * by AppFrame, which decides the effective sidebar preference before solving;
 * the solver itself stays breakpoint-free.
 *
 * The earth column concedes ahead of details because it is the most optional
 * panel: a supplementary 3D view yields viewport before the session-linked
 * details panel does.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; details: number; earth: number }

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360
/** Earth column drag clamp floor. */
export const EARTH_MIN = 360
/** Earth column drag clamp ceiling. */
export const EARTH_MAX = 720
/** Earth column width before any user drag. */
export const EARTH_DEFAULT = 480

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the four column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @param earth - earth column width preference in px (0 = closed).
 * @returns resolved widths; details/earth 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number, earth: number): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)
  const e0 = earth === 0 ? 0 : clampWidth(earth, EARTH_MIN, EARTH_MAX)

  // Step 1: everything fits at preferred widths.
  if (s + d0 + e0 + CENTER_MIN <= viewport) return { sidebar: s, center: viewport - s - d0 - e0, details: d0, earth: e0 }

  // Step 2: shrink earth toward its minimum (details untouched).
  const e1 = e0 === 0 ? 0 : Math.max(EARTH_MIN, viewport - s - d0 - CENTER_MIN)
  if (s + d0 + e1 + CENTER_MIN <= viewport) return { sidebar: s, center: CENTER_MIN, details: d0, earth: e1 }

  // Step 3: shrink details toward its minimum (earth pinned at its min).
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - e1 - CENTER_MIN)
  if (s + d1 + e1 + CENTER_MIN <= viewport) return { sidebar: s, center: CENTER_MIN, details: d1, earth: e1 }

  // Step 4: auto-close earth (derived — preferences untouched); retry details.
  const d2 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - CENTER_MIN)
  if (s + d2 + CENTER_MIN <= viewport) return { sidebar: s, center: CENTER_MIN, details: d2, earth: 0 }

  // Step 5: auto-close details too; center absorbs any remaining deficit
  // (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0, earth: 0 }
}
