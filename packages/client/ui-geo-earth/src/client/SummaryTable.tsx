/**
 * The "Summary" conversation view: a table of every drawn feature in the
 * session's `geoCommand` projection (segmentation polygons and any other
 * annotations), with id, type, area, and location. Hovering a row highlights
 * the matching polygon on the globe through the shared {@link earthController}
 * hover state; the row's Focus action flies the camera to it through the
 * injected `flyTo` callback. "Export GeoJSON" downloads the whole set as a
 * FeatureCollection. Reads live data through the framework `useProjection`
 * hook; the only ctx-reaching effect is the injected `flyTo`.
 */
import * as React from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: contributes the geoCommand key to SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-geo-command/client'
import type { GeoDrawnFeature } from '@deepseek-ai/dsh-geo-command/client'
import { earthController } from './earthController.ts'
import { centroidOf, formatArea, formatLocation, polygonAreaM2 } from './geoMetrics.ts'
import { featuresToGeoJson } from './geoExport.ts'

/** Owner share plus the injected camera-fly callback. */
export type SummaryTableProps =
  & PropsRuntime<'conversation.view'>
  & PropsRenderSlots<never>
  & { flyTo?: (lon: number, lat: number) => void }

const CSS = `
.geo-summary{display:flex;flex-direction:column;height:100%;min-height:0;font:13px/1.4 system-ui,sans-serif;color:var(--dsw-alias-text-l1,#e8e8ea)}
.geo-summary-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2c33)}
.geo-summary-bar h2{margin:0;font:600 14px/1.3 system-ui,sans-serif}
.geo-summary-count{opacity:.6;font-size:12px}
.geo-summary-export{background:var(--dsw-alias-button-floating-fill,#22242b);border:1px solid var(--dsw-alias-border-l2,#2a2c33);color:inherit;height:28px;padding:0 12px;border-radius:8px;cursor:pointer;font:12px/1 system-ui,sans-serif}
.geo-summary-export:hover:not(:disabled){filter:brightness(1.25)}
.geo-summary-export:disabled{opacity:.4;cursor:default}
.geo-summary-scroll{flex:1 1 auto;min-height:0;overflow:auto}
.geo-summary table{width:100%;border-collapse:collapse}
.geo-summary th,.geo-summary td{text-align:left;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l3,#22242b);white-space:nowrap}
.geo-summary th{position:sticky;top:0;background:var(--dsw-specific-sidebar-fill,#16171b);font-weight:600;font-size:12px;opacity:.8}
.geo-summary tbody tr{cursor:pointer}
.geo-summary tbody tr:hover,.geo-summary tbody tr[data-hovered='true']{background:rgba(255,153,0,.14)}
.geo-summary .type-chip{display:inline-block;padding:1px 8px;border-radius:999px;background:rgba(45,108,223,.22);color:#bcd6ff;font-size:12px}
.geo-summary-empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;color:#8a8d97;padding:24px;text-align:center}
.geo-summary-focus{background:transparent;border:1px solid var(--dsw-alias-border-l2,#2a2c33);color:inherit;height:24px;padding:0 8px;border-radius:6px;cursor:pointer;font:11px/1 system-ui,sans-serif}
.geo-summary-focus:hover{filter:brightness(1.3)}
`

/** One table row's derived cells for a drawn feature. */
interface Row {
  id: string
  type: string
  area: string
  location: string
  centroid: readonly [number, number] | null
}

/** Derive the display row for a feature (type/area/location). */
function rowOf(feature: GeoDrawnFeature): Row {
  const centroid = centroidOf(feature.geometry)
  const area = feature.geometry.type === 'polygon' ? polygonAreaM2(feature.geometry.coordinates) : 0
  return {
    id: feature.id,
    type: feature.featureType ?? feature.name ?? '—',
    area: feature.geometry.type === 'polygon' ? formatArea(area) : '—',
    location: formatLocation(centroid),
    centroid,
  }
}

/** Live hovered-feature id from the shared controller. */
function useHoveredId(): string | null {
  return React.useSyncExternalStore(
    earthController.subscribe,
    () => earthController.getHoveredId(),
    /* v8 ignore next -- getServerSnapshot: server-side render fallback, never reached in the browser or jsdom. */
    () => null,
  )
}

/** Trigger a browser download of `text` as a file named `filename`. */
function downloadText(filename: string, text: string, mime: string): void {
  /* v8 ignore next -- SSR guard: document is always present in the browser and jsdom. */
  if (typeof document === 'undefined') return
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Render the summary table for the session's drawn features.
 * @param props - the view runtime share plus the injected `flyTo` callback.
 * @returns the table element.
 */
export function SummaryTable(props: SummaryTableProps): React.JSX.Element {
  const state = props.useProjection('geoCommand')
  const features = state?.features ?? []
  const hoveredId = useHoveredId()
  const rows = React.useMemo(() => features.map(rowOf), [features])

  const onExport = React.useCallback(() => {
    const geojson = featuresToGeoJson(features)
    downloadText('drawings.geojson', JSON.stringify(geojson, null, 2), 'application/geo+json')
  }, [features])

  return (
    <div className="geo-summary">
      <style>{CSS}</style>
      <div className="geo-summary-bar">
        <h2>Segmentation Summary <span className="geo-summary-count">{rows.length} feature{rows.length === 1 ? '' : 's'}</span></h2>
        <button className="geo-summary-export" onClick={onExport} disabled={rows.length === 0}>Export GeoJSON</button>
      </div>
      {rows.length === 0
        ? <div className="geo-summary-empty">No polygons yet. Segment the 3D Earth view (e.g. “segment buildings”) to populate this table.</div>
        : (
          <div className="geo-summary-scroll">
            <table>
              <thead>
                <tr><th>ID</th><th>Type</th><th>Area</th><th>Location</th><th /></tr>
              </thead>
              <tbody onMouseLeave={() => earthController.setHovered(null)}>
                {rows.map(row => (
                  <tr
                    key={row.id}
                    data-hovered={row.id === hoveredId || undefined}
                    onMouseEnter={() => earthController.setHovered(row.id)}
                  >
                    <td>{row.id}</td>
                    <td><span className="type-chip">{row.type}</span></td>
                    <td>{row.area}</td>
                    <td>{row.location}</td>
                    <td>
                      {row.centroid
                        ? (
                          <button
                            className="geo-summary-focus"
                            onClick={() => props.flyTo?.(...row.centroid)}
                          >
                            Focus
                          </button>
                        )
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
