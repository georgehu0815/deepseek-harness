// @vitest-environment jsdom
/**
 * The summary table view: an empty state with a disabled export, one row per
 * drawn feature with type/area/location cells and an enabled export, hover
 * wiring to the shared controller, the Focus button's flyTo call, and the
 * Export GeoJSON browser download. The framework useProjection hook is a plain
 * stub; the controller hover methods are spied.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GeoDrawnFeature } from '@deepseek-ai/dsh-geo-command/client'
import { earthController } from '../src/client/earthController.ts'
import { SummaryTable } from '../src/client/SummaryTable.tsx'
import type { SummaryTableProps } from '../src/client/SummaryTable.tsx'

afterEach(() => {
  cleanup()
  earthController.setHovered(null)
})

/** Build table props whose useProjection returns the given geoCommand state. */
function props(
  features: readonly GeoDrawnFeature[] | undefined,
  flyTo?: (lon: number, lat: number) => void,
): SummaryTableProps {
  return {
    useProjection: () => (features === undefined ? undefined : { features }),
    flyTo,
  } as unknown as SummaryTableProps
}

const features: readonly GeoDrawnFeature[] = [
  { id: 'g1', geometry: { type: 'polygon', coordinates: [[0, 0], [1, 0], [1, 1]] }, featureType: 'house' },
  { id: 'p1', geometry: { type: 'point', coordinates: [10, 20] }, name: 'Marker' },
  { id: 'l1', geometry: { type: 'polyline', coordinates: [[0, 0], [2, 2]] } },
]

describe('SummaryTable', () => {
  it('renders the empty state with a disabled export when there are no features', () => {
    const { container, getByText } = render(<SummaryTable {...props([])} />)
    expect(getByText(/No polygons yet/)).toBeTruthy()
    const button = container.querySelector('.geo-summary-export') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('treats an undefined projection as empty', () => {
    const { getByText } = render(<SummaryTable {...props(undefined)} />)
    expect(getByText(/No polygons yet/)).toBeTruthy()
  })

  it('renders one row per feature with type cells and an enabled export', () => {
    const { container, getByText } = render(<SummaryTable {...props(features)} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(3)
    expect(getByText('house')).toBeTruthy()
    expect(getByText('Marker')).toBeTruthy()
    const button = container.querySelector('.geo-summary-export') as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })

  it('renders the singular feature count and omits Focus for a null-centroid feature', () => {
    const single: readonly GeoDrawnFeature[] = [
      { id: 'e1', geometry: { type: 'polyline', coordinates: [] } },
    ]
    const { container, getByText } = render(<SummaryTable {...props(single)} />)
    // Singular "1 feature" (no trailing 's').
    expect(getByText(/1 feature$/)).toBeTruthy()
    // Empty polyline has a null centroid, so no Focus button renders.
    expect(container.querySelector('.geo-summary-focus')).toBeNull()
  })

  it('marks the row matching the shared hovered id', () => {
    earthController.setHovered('g1')
    const { container } = render(<SummaryTable {...props(features)} />)
    const hoveredRow = container.querySelector('tbody tr[data-hovered="true"]') as HTMLTableRowElement
    expect(hoveredRow.querySelector('td')!.textContent).toBe('g1')
  })

  it('wires row hover and tbody leave to the controller hover state', () => {
    const setHovered = vi.spyOn(earthController, 'setHovered')
    const { container } = render(<SummaryTable {...props(features)} />)
    const firstRow = container.querySelector('tbody tr') as HTMLTableRowElement
    fireEvent.mouseEnter(firstRow)
    expect(setHovered).toHaveBeenCalledWith('g1')
    const tbody = container.querySelector('tbody') as HTMLElement
    fireEvent.mouseLeave(tbody)
    expect(setHovered).toHaveBeenCalledWith(null)
    setHovered.mockRestore()
  })

  it('flies to the feature centroid when Focus is clicked', () => {
    const flyTo = vi.fn()
    const { container } = render(<SummaryTable {...props(features, flyTo)} />)
    const focus = container.querySelector('.geo-summary-focus') as HTMLButtonElement
    fireEvent.click(focus)
    // First feature is a polygon [[0,0],[1,0],[1,1]] → centroid [0.666..., 0.333...].
    expect(flyTo).toHaveBeenCalledTimes(1)
    const [lon, lat] = flyTo.mock.calls[0]!
    expect(lon).toBeCloseTo(2 / 3, 6)
    expect(lat).toBeCloseTo(1 / 3, 6)
  })

  it('downloads a GeoJSON file when Export is clicked', () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('drawings.geojson')
    })
    const { container } = render(<SummaryTable {...props(features)} />)
    const button = container.querySelector('.geo-summary-export') as HTMLButtonElement
    fireEvent.click(button)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })
})
