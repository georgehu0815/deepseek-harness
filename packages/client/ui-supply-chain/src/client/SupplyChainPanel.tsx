/**
 * The supply-chain emulator panel: scenario controls, the run summary, a
 * day-by-day replay transport that drives the 3D Earth network overlay, and the
 * three reports (node, bullwhip, edge) drawn as inline SVG.
 *
 * Every host call and every globe write arrives as an injected callback, so
 * this component holds only view state: the pending config, the current run,
 * the replay day, and which report is open.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BullwhipReport,
  EdgeReport,
  NodeReport,
  SimulationConfig,
  SimulationRun,
} from '@deepseek-ai/dsh-supply-chain/types'
import { barFraction, itemColor, sparkline, sparklinePoints, TIER_ROLES } from './derive.ts'
import type { ReplayState } from './replayController.ts'
import styles from './SupplyChainPanel.module.css'

/** Host and globe callbacks the plugin body injects. */
export interface SupplyChainPanelInject {
  /**
   * Live replay state, owned by the plugin body so playback survives this tab
   * unmounting. The renderer binds this source to a `useReplay` hook.
   */
  hooks: { replay: HostObservable<ReplayState> }
  /** Start a scenario; the result arrives through the replay source. */
  runSimulation: (config: Partial<SimulationConfig> & { preset?: string }) => void
  /** Jump the replay to one day. */
  setDay: (day: number) => void
  /** Start or stop playback. */
  togglePlay: () => void
  /** Move the globe camera to a facility. */
  flyTo: (lon: number, lat: number) => void
  /** Derive the node report for one facility and item. */
  nodeReport: (run: SimulationRun, nodeId: string, item: string) => NodeReport
  /** Derive the echelon amplification report for one item. */
  bullwhipReport: (run: SimulationRun, item: string) => BullwhipReport
  /** Derive the lane pressure report. */
  edgeReport: (run: SimulationRun) => EdgeReport
  /** Scenario presets offered by the host seam, each with its resolved config. */
  presets: readonly { name: string; config: SimulationConfig }[]
}

type Props = PropsRuntime<'conversation.view'> & InjectFace<SupplyChainPanelInject>

/** One slider exposed in the controls grid. */
interface Slider {
  readonly field: keyof SimulationConfig
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}

/**
 * The scenario settings worth a slider. Deliberately a small subset of the
 * seam's config: these are the levers that change the story a run tells, and a
 * wall of sliders would bury them.
 */
const SLIDERS: readonly Slider[] = [
  { field: 'days', label: 'Days simulated', min: 30, max: 400, step: 10 },
  { field: 'items', label: 'Items (SKUs)', min: 1, max: 5, step: 1 },
  { field: 'seed', label: 'Random seed', min: 0, max: 200, step: 1 },
  { field: 'capacityScale', label: 'Lane capacity', min: 0.1, max: 3, step: 0.1 },
  { field: 'safetyStockScale', label: 'Safety stock', min: 0.1, max: 3, step: 0.1 },
  { field: 'leadTimeScale', label: 'Lead time', min: 0.5, max: 6, step: 0.1 },
  { field: 'shockHeightScale', label: 'Demand shock size', min: 0, max: 6, step: 0.5 },
  { field: 'disruptionProbability', label: 'Lane failure chance', min: 0, max: 0.3, step: 0.01 },
]

/** Report tabs, in the order they answer questions about a run. */
const REPORTS = [
  { id: 'node', label: 'Node inventory' },
  { id: 'bullwhip', label: 'Bullwhip' },
  { id: 'edge', label: 'Lane pressure' },
] as const

type ReportKind = typeof REPORTS[number]['id']

/** Sparkline viewport in user units; the element is stretched by CSS. */
const SPARK_WIDTH = 300
const SPARK_HEIGHT = 44

/**
 * Format a fraction as a percentage.
 * @param value - the fraction.
 * @returns the formatted percentage.
 */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Format a magnitude for a compact metric readout.
 * @param value - the number.
 * @returns the rounded, thousands-separated text.
 */
function units(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/**
 * One labelled sparkline over a day series, with the replay day marked.
 * @param props.label - series name.
 * @param props.series - the values in day order.
 * @param props.day - the replay day to mark.
 * @param props.warn - draw in the alert color.
 * @returns the chart row.
 */
function Spark(props: { label: string; series: readonly number[]; day: number; warn?: boolean }): JSX.Element {
  const points = useMemo(() => sparklinePoints(sparkline(props.series), SPARK_WIDTH, SPARK_HEIGHT), [props.series])
  const lastIndex = Math.max(props.series.length - 1, 1)
  const markerX = (Math.min(props.day, lastIndex) / lastIndex) * SPARK_WIDTH
  const current = props.series[props.day] ?? 0
  return (
    <div className={styles.chartRow}>
      <div className={styles.chartHead}>
        <span>{props.label}</span>
        <span className={styles.chartValue}>Day {props.day + 1}: {units(current)}</span>
      </div>
      <svg
        className={styles.spark}
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={props.label}
      >
        <polyline className={props.warn === true ? `${styles.sparkLine} ${styles.sparkLineWarn}` : styles.sparkLine} points={points} />
        <line className={styles.dayMarker} x1={markerX} y1={0} x2={markerX} y2={SPARK_HEIGHT} />
      </svg>
    </div>
  )
}

/**
 * One horizontal bar with a label and a value readout.
 * @param props.label - the row name.
 * @param props.value - the readout text.
 * @param props.fraction - fill fraction in 0..1.
 * @param props.warn - draw in the alert color.
 * @returns the bar row.
 */
function Bar(props: { label: string; value: string; fraction: number; warn?: boolean }): JSX.Element {
  return (
    <li className={styles.chartRow}>
      <div className={styles.chartHead}>
        <span>{props.label}</span>
        <span className={styles.chartValue}>{props.value}</span>
      </div>
      <div className={styles.bar}>
        <div
          className={props.warn === true ? `${styles.barFill} ${styles.barFillWarn}` : styles.barFill}
          style={{ width: `${(props.fraction * 100).toFixed(1)}%` }}
        />
      </div>
    </li>
  )
}

/**
 * Map legend: what a marker's size and color, and a lane's color, mean on the
 * globe. Echelon roles and their marker sizes match the upstream simulator's
 * map, so the same network reads the same way in both.
 * @returns the legend section.
 */
function MapLegend(props: { itemIds: readonly string[] }): JSX.Element {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Map legend</h3>
      <div className={styles.legendGrid}>
        <div>
          <p className={styles.legendHead}>Facilities (marker size = role)</p>
          <ul className={styles.list}>
            {TIER_ROLES.map(role => (
              <li className={styles.legendRow} key={role.tier}>
                <span
                  className={styles.legendDot}
                  style={{ width: role.pixels, height: role.pixels }}
                />
                <span>Tier {role.tier} — {role.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className={styles.legendHead}>Status (marker color)</p>
          <ul className={styles.list}>
            <li className={styles.legendRow}>
              <span className={`${styles.legendDot} ${styles.legendDestination}`} />
              <span>Demand destination</span>
            </li>
            <li className={styles.legendRow}>
              <span className={`${styles.legendDot} ${styles.legendHealthy}`} />
              <span>Meeting demand</span>
            </li>
            <li className={styles.legendRow}>
              <span className={`${styles.legendDot} ${styles.legendStressed}`} />
              <span>Carrying backlog today</span>
            </li>
          </ul>
          <p className={styles.legendHead}>Goods in transit</p>
          <ul className={styles.list}>
            {props.itemIds.map((id, index) => (
              <li className={styles.legendRow} key={id}>
                <span
                  className={styles.legendDot}
                  style={{ width: 8, height: 8, background: itemColor(index) }}
                />
                <span>{id} shipment</span>
              </li>
            ))}
          </ul>
          <p className={styles.legendHead}>Lanes (width = utilization)</p>
          <ul className={styles.list}>
            <li className={styles.legendRow}>
              <span className={`${styles.legendBar} ${styles.legendLane}`} />
              <span>Below capacity</span>
            </li>
            <li className={styles.legendRow}>
              <span className={`${styles.legendBar} ${styles.legendSaturated}`} />
              <span>At or above capacity</span>
            </li>
            <li className={styles.legendRow}>
              <span className={`${styles.legendBar} ${styles.legendClosed}`} />
              <span>Closed by a disruption</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

/**
 * The supply-chain emulator panel.
 * @param props - runtime share plus the injected host and globe callbacks.
 * @returns the panel element.
 */
export function SupplyChainPanel(props: Props): JSX.Element {
  const [preset, setPreset] = useState<string>('baseline')
  const [overrides, setOverrides] = useState<Partial<SimulationConfig>>({})
  const [report, setReport] = useState<ReportKind>('node')
  const [nodeId, setNodeId] = useState<string>('')
  const [item, setItem] = useState<string>('')

  // One selector per fact: the hook re-renders only when the selected value
  // changes, so scrubbing a day does not re-render on unrelated replay edits.
  const run = props.useReplay(state => state.run)
  const day = props.useReplay(state => state.day)
  const playing = props.useReplay(state => state.playing)
  const busy = props.useReplay(state => state.busy)
  const error = props.useReplay(state => state.error)
  const lastDay = run === null ? 0 : run.network.days - 1

  // Selections follow whichever run is on screen, including one that finished
  // while this tab was unmounted.
  useEffect(() => {
    if (run === null) return
    setNodeId(current => (run.network.nodes.some(each => each.id === current)
      ? current
      : run.network.nodes[0]?.id ?? ''))
    setItem(current => (run.network.itemIds.includes(current)
      ? current
      : run.network.itemIds[0] ?? ''))
  }, [run])

  const setField = useCallback((field: keyof SimulationConfig, value: number) => {
    setOverrides(current => ({ ...current, [field]: value }))
  }, [])

  const onRun = useCallback(() => {
    props.runSimulation({ ...overrides, preset })
  }, [props, overrides, preset])

  // A slider shows, in order: an explicit edit, the selected preset's resolved
  // setting, then the current run's. Falling back to the slider's minimum would
  // misreport every untouched setting as its most extreme value.
  const presetConfig = useMemo(
    () => props.presets.find(each => each.name === preset)?.config,
    [props.presets, preset],
  )

  const sliderValue = useCallback((slider: Slider): number => {
    const override = overrides[slider.field]
    if (typeof override === 'number') return override
    const fromPreset = presetConfig?.[slider.field]
    if (typeof fromPreset === 'number') return fromPreset
    const fromRun = run?.config[slider.field]
    if (typeof fromRun === 'number') return fromRun
    return slider.min
  }, [overrides, presetConfig, run])

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Scenario</h3>
        <div className={styles.controlGrid}>
          <div className={styles.control}>
            <span className={styles.controlLabel}>Preset</span>
            <select
              className={styles.select}
              value={preset}
              onChange={(event) => { setPreset(event.target.value); setOverrides({}) }}
            >
              {props.presets.map(each => <option key={each.name} value={each.name}>{each.name}</option>)}
            </select>
          </div>
          {SLIDERS.map((slider) => {
            const value = sliderValue(slider)
            return (
              <label className={styles.control} key={slider.field}>
                <span className={styles.controlLabel}>
                  {slider.label}
                  <span className={styles.controlValue}>{value}</span>
                </span>
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={value}
                  onChange={(event) => { setField(slider.field, Number(event.target.value)) }}
                />
              </label>
            )
          })}
        </div>
        <div className={styles.actions}>
          <button className={styles.runButton} onClick={onRun} disabled={busy}>
            {busy ? 'Simulating…' : 'Run simulation'}
          </button>
          <p className={styles.hint}>
            The simulation runs on the host; the network is drawn on the 3D Earth.
          </p>
        </div>
        {error !== null && <div className={styles.error}>{error}</div>}
      </section>

      {run === null
        ? <p className={styles.empty}>No run yet. Pick a scenario and choose Run simulation.</p>
        : (
          <>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Results</h3>
              <div className={styles.summaryRow}>
                {run.results.map(result => (
                  <div className={styles.metric} key={result.item}>
                    <span className={styles.metricLabel}>{result.item} fill rate</span>
                    <span className={result.fillRate < 0.95 ? `${styles.metricValue} ${styles.metricValueWarn}` : styles.metricValue}>
                      {percent(result.fillRate)}
                    </span>
                  </div>
                ))}
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Total backlog</span>
                  <span className={styles.metricValue}>
                    {units(run.results.reduce((sum, each) => sum + each.totalBacklog, 0))}
                  </span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Lane closures</span>
                  <span className={styles.metricValue}>{run.network.disruptions.length}</span>
                </div>
              </div>
              <div className={styles.replay}>
                <button className={styles.iconButton} onClick={props.togglePlay}>
                  {playing ? 'Pause' : 'Play'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={lastDay}
                  step={1}
                  value={day}
                  aria-label="Replay day"
                  onChange={(event) => { props.setDay(Number(event.target.value)) }}
                />
                <span className={styles.dayLabel}>Day {day + 1} / {run.network.days}</span>
              </div>
            </section>

            <MapLegend itemIds={run.network.itemIds} />

            <section className={styles.section}>
              <div className={styles.tabs}>
                {REPORTS.map(each => (
                  <button
                    key={each.id}
                    className={report === each.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => { setReport(each.id) }}
                  >
                    {each.label}
                  </button>
                ))}
              </div>
              {report === 'node' && (
                <NodeReportView
                  run={run}
                  day={day}
                  nodeId={nodeId}
                  item={item}
                  onNode={setNodeId}
                  onItem={setItem}
                  onFocus={props.flyTo}
                  derive={props.nodeReport}
                />
              )}
              {report === 'bullwhip' && <BullwhipReportView run={run} item={item} derive={props.bullwhipReport} />}
              {report === 'edge' && <EdgeReportView run={run} derive={props.edgeReport} />}
            </section>
          </>
        )}
    </div>
  )
}

/**
 * Inventory, backlog, and flow for one facility and item, with a facility
 * picker that also flies the globe there.
 * @param props - the run, selection, and derivation callback.
 * @returns the node report view.
 */
function NodeReportView(props: {
  run: SimulationRun
  day: number
  nodeId: string
  item: string
  onNode: (id: string) => void
  onItem: (id: string) => void
  onFocus: (lon: number, lat: number) => void
  derive: SupplyChainPanelInject['nodeReport']
}): JSX.Element {
  const node = props.run.network.nodes.find(each => each.id === props.nodeId)
  const report = useMemo(
    () => (node === undefined || props.item === '' ? null : props.derive(props.run, props.nodeId, props.item)),
    [props, node],
  )

  return (
    <>
      <div className={styles.controlGrid}>
        <div className={styles.control}>
          <span className={styles.controlLabel}>Facility</span>
          <select
            className={styles.select}
            value={props.nodeId}
            onChange={(event) => {
              props.onNode(event.target.value)
              const picked = props.run.network.nodes.find(each => each.id === event.target.value)
              if (picked !== undefined) props.onFocus(picked.longitude, picked.latitude)
            }}
          >
            {props.run.network.nodes.map(each => (
              <option key={each.id} value={each.id}>{each.id} (tier {each.tier})</option>
            ))}
          </select>
        </div>
        <div className={styles.control}>
          <span className={styles.controlLabel}>Item</span>
          <select className={styles.select} value={props.item} onChange={(event) => { props.onItem(event.target.value) }}>
            {props.run.network.itemIds.map(each => <option key={each} value={each}>{each}</option>)}
          </select>
        </div>
      </div>
      {report === null
        ? <p className={styles.empty}>Select a facility and an item.</p>
        : (
          <>
            <Spark label="Inventory" series={report.inventory} day={props.day} />
            <Spark label="Backlog" series={report.backlog} day={props.day} warn />
            <Spark label="Inflow" series={report.inflow} day={props.day} />
            <Spark label="Outflow" series={report.outflow} day={props.day} />
          </>
        )}
    </>
  )
}

/**
 * Order-variance amplification by echelon: how much each tier upstream distorts
 * the demand signal it passes on.
 * @param props - the run, item, and derivation callback.
 * @returns the bullwhip report view.
 */
function BullwhipReportView(props: {
  run: SimulationRun
  item: string
  derive: SupplyChainPanelInject['bullwhipReport']
}): JSX.Element {
  const report = useMemo(
    () => (props.item === '' ? null : props.derive(props.run, props.item)),
    [props],
  )
  if (report === null) return <p className={styles.empty}>Select an item first.</p>

  const max = report.tiers.reduce((peak, tier) => Math.max(peak, tier.amplification), 0)
  return (
    <>
      <p className={styles.hint}>
        {'Amplification = variance of what a tier receives ÷ variance of what it ships. '
          + 'Above 1× means that tier is enlarging the demand swing it passes upstream.'}
      </p>
      <ul className={styles.list}>
        {report.tiers.map(tier => (
          <Bar
            key={tier.tier}
            label={`Tier ${tier.tier}: ${tier.nodeIds.join(', ')}`}
            value={`${tier.amplification.toFixed(2)}×`}
            fraction={barFraction(tier.amplification, max)}
            warn={tier.amplification > 1}
          />
        ))}
      </ul>
    </>
  )
}

/**
 * Lane capacity pressure, most loaded first.
 * @param props - the run and derivation callback.
 * @returns the edge report view.
 */
function EdgeReportView(props: {
  run: SimulationRun
  derive: SupplyChainPanelInject['edgeReport']
}): JSX.Element {
  const report = useMemo(() => props.derive(props.run), [props])
  return (
    <>
      <p className={styles.hint}>
        {'Ranked by mean utilization. The more days a lane spends at or above capacity, '
          + 'the likelier it is the bottleneck.'}
      </p>
      <ul className={styles.list}>
        {report.edges.map(edge => (
          <Bar
            key={`${edge.source}->${edge.target}`}
            label={`${edge.source} → ${edge.target}`}
            value={`mean ${percent(edge.meanUtilization)} · peak ${percent(edge.peakUtilization)} · ${edge.saturatedDays} d saturated`}
            fraction={barFraction(edge.meanUtilization, 1)}
            warn={edge.peakUtilization >= 1}
          />
        ))}
      </ul>
    </>
  )
}
