import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, EARTH_DEFAULT, EARTH_MIN,
  SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns (earth closed — the three-column baseline)', () => {
  it('step 1: everything fits at preferred widths', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(EARTH_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360, details: 360, earth: 0 })
  })

  it('closed sidebar keeps its compact rail while closed details contribute zero width', () => {
    expect(computeColumns(1920, closed(300), closed(360), closed(0)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, details: 0, earth: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(1920, open(9999), open(1), closed(0))
    expect(cols.sidebar).toBe(420)
    expect(cols.details).toBe(300)
    expect(computeColumns(1920, open(1), open(DETAILS_DEFAULT), closed(0)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('step 2: details shrinks first, center pinned at min', () => {
    // 280 + 360 + 640 = 1280 > 1250; details concedes to 1250-280-640 = 330.
    const cols = computeColumns(1250, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, details: 330, earth: 0 })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(300 + 360 + CENTER_MIN, open(300), open(360), closed(0))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, details: 360, earth: 0 })
    const one = computeColumns(300 + 360 + CENTER_MIN - 1, open(300), open(360), closed(0))
    expect(one).toEqual({ sidebar: 300, center: CENTER_MIN, details: 359, earth: 0 })
  })

  it('details auto-closes when its min still starves center — sidebar holds its preference', () => {
    // 280 + 300 + 640 = 1220 > 1210 → details 0; sidebar untouched: center = 1210-280 = 930.
    const cols = computeColumns(1210, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(cols).toEqual({ sidebar: 280, center: 930, details: 0, earth: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 700 < 280+640: sidebar keeps 280, center takes 420 < CENTER_MIN.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), closed(0))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, details: 0, earth: 0 })
  })

  it('sidebar-closed narrow window: details concedes then auto-closes', () => {
    const fits = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN, closed(300), open(DETAILS_DEFAULT), closed(0))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, details: DETAILS_MIN, earth: 0 })
    const starved = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN - 1, closed(300), open(DETAILS_DEFAULT), closed(0))
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: DETAILS_MIN + CENTER_MIN - 1,
      details: 0,
      earth: 0,
    })
  })

  it('tiny viewport: details closes, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(cols.details).toBe(0)
    expect(cols.earth).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(squeezed.details).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — the earth column concedes ahead of details', () => {
  it('step 1: all four fit at preferred widths', () => {
    // 280 + 640 + 360 + 480 = 1760 <= 1920.
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(EARTH_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360 - 480, details: 360, earth: 480 })
  })

  it('step 2: earth shrinks first while details stays at its preference', () => {
    // 280 + 640 + 360 + 480 = 1760 > 1720; earth concedes to 1720-280-360-640 = 440.
    const cols = computeColumns(1720, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(EARTH_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, details: 360, earth: 440 })
  })

  it('step 3: earth pins at its min, then details shrinks', () => {
    // earth floored at EARTH_MIN=360; then details concedes.
    // viewport chosen so earth is already at min and details must give.
    const viewport = SIDEBAR_DEFAULT + CENTER_MIN + DETAILS_DEFAULT + EARTH_MIN - 20
    const cols = computeColumns(viewport, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(EARTH_DEFAULT))
    expect(cols.earth).toBe(EARTH_MIN)
    expect(cols.center).toBe(CENTER_MIN)
    expect(cols.details).toBe(DETAILS_DEFAULT - 20)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('step 4: earth auto-closes when its min still starves center; details survives, absorbing the freed room up to its clamp', () => {
    // viewport 1260: sidebar 280 + center-min 640 leaves 340 for the extra
    // columns. earth (min 360) cannot fit, so it auto-closes; details then
    // takes the freed room (340, above its 300 min, below its 520 max).
    const viewport = SIDEBAR_DEFAULT + CENTER_MIN + DETAILS_MIN + 40
    const cols = computeColumns(viewport, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(EARTH_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: CENTER_MIN, details: 340, earth: 0 })
  })

  it('step 5: both earth and details auto-close; center absorbs the remaining deficit', () => {
    // Not even sidebar + center-min + details-min fits: both extra columns close.
    const viewport = SIDEBAR_DEFAULT + CENTER_MIN + 100
    const cols = computeColumns(viewport, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(EARTH_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: viewport - SIDEBAR_DEFAULT, details: 0, earth: 0 })
  })

  it('earth open with details closed: earth concedes to its min, then auto-closes with center pinned at its min', () => {
    const fits = computeColumns(
      SIDEBAR_DEFAULT + CENTER_MIN + EARTH_MIN,
      open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), open(EARTH_DEFAULT),
    )
    expect(fits).toEqual({ sidebar: SIDEBAR_DEFAULT, center: CENTER_MIN, details: 0, earth: EARTH_MIN })
    // One px short of the earth min fitting: earth auto-closes and, with room
    // for sidebar + center-min, center holds at CENTER_MIN (step 4).
    const starved = computeColumns(
      SIDEBAR_DEFAULT + CENTER_MIN + EARTH_MIN - 1,
      open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), open(EARTH_DEFAULT),
    )
    expect(starved).toEqual({ sidebar: SIDEBAR_DEFAULT, center: CENTER_MIN, details: 0, earth: 0 })
  })

  it('recovery is pure for earth too: re-widening restores its preference', () => {
    const squeezed = computeColumns(1000, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(EARTH_DEFAULT))
    expect(squeezed.earth).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(EARTH_DEFAULT))
    expect(restored.earth).toBe(EARTH_DEFAULT)
    expect(restored.details).toBe(DETAILS_DEFAULT)
  })

  it('earth preference beyond the clamp range is clamped before solving', () => {
    const cols = computeColumns(3000, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(9999))
    expect(cols.earth).toBe(720) // EARTH_MAX
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: details auto-closes, center takes the rest', () => {
    // Reaches the auto-close fallback with the compact rail sidebar.
    expect(computeColumns(500, closed(300), open(DETAILS_DEFAULT), closed(0)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, details: 0, earth: 0 })
  })
})
