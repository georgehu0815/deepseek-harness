/**
 * Supply-chain emulator plugin, browser half. Adds a "Supply chain" tab to the center
 * column carrying the scenario controls, the three reports, and a day-by-day
 * replay; the replay draws the shipping network on the shared 3D Earth through
 * the `ctx.earthOverlays` face. Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ui-conversation SlotMap merge carrying the center-column tab seat.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.earthOverlays face this apply draws the network through.
import type {} from '@deepseek-ai/dsh-client-ui-geo-earth/client'
// Type-only: the ctx.remote.supplyChain namespace this apply calls.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  buildBullwhipReport,
  buildEdgeReport,
  buildNodeReport,
} from '@deepseek-ai/dsh-supply-chain/client'
import type { SimulationConfig, SimulationRun } from '@deepseek-ai/dsh-supply-chain/types'
import { goodsOverlay, networkOverlay } from './derive.ts'
import type { OverlayColors } from './derive.ts'
import { createReplayController } from './replayController.ts'
import { SupplyChainPanel } from './SupplyChainPanel.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'remote', 'remote.supplyChain', 'earthOverlays']

/** The globe layer this plugin owns; no other plugin writes it. */
const OVERLAY_LAYER = 'supply-chain'

/** Overlay layer holding goods in transit, redrawn on every replay frame. */
const GOODS_LAYER = 'supply-chain-goods'

/** Scenario list shown before the host's catalog answers. */
const FALLBACK_PRESETS: readonly { name: string; config: SimulationConfig }[] = []

/**
 * Theme colors for the globe overlay.
 *
 * Cesium needs concrete color strings rather than CSS variables, so these are
 * read from the document once per draw; the fallbacks keep the network visible
 * if a token is missing.
 * @returns the resolved overlay colors.
 */
function overlayColors(): OverlayColors {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim()
    return value.length > 0 ? value : fallback
  }
  return {
    healthy: token('--dsw-alias-state-success-primary', '#2ea043'),
    stressed: token('--dsw-alias-state-error-primary', '#f85149'),
    destination: token('--dsw-alias-brand-primary', '#4d6bfe'),
    lane: token('--dsw-alias-label-tertiary', '#8b949e'),
    saturated: token('--dsw-alias-state-warn-primary', '#d29922'),
    closed: token('--dsw-alias-state-error-primary', '#f85149'),
  }
}

/**
 * Unwrap a Remote result, turning a transport or host failure into a rejection
 * the panel can show.
 * @param result - the Remote envelope.
 * @returns the value on success.
 * @throws {Error} carrying the host's message when the call failed.
 */
function unwrap(result: { ok: true; value: SimulationRun } | { ok: false; error: { message: string } }): SimulationRun {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Register the center-column supply-chain tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The host's preset list, fetched once and reused by every mount of the tab.
  let presets: readonly { name: string; config: SimulationConfig }[] = FALLBACK_PRESETS
  void ctx.remote.supplyChain.catalog().then((result) => {
    if (result.ok) presets = result.value.presets
  })

  // The replay outlives any single mount of the panel: the tab unmounts on a
  // switch to Chat, while the globe it drives stays on screen.
  // Two layers, because they change at different rates. Lanes are draped ground
  // primitives that load asynchronously: rebuilding them every frame leaves them
  // permanently unloaded and the network looks like it has no edges during
  // playback. They are redrawn only when the whole day changes, while goods in
  // transit are redrawn on every frame.
  let drawnDay: number | null = null
  let drawnRun: SimulationRun | null = null
  const replay = createReplayController((run, position) => {
    const day = Math.floor(position)
    if (run !== drawnRun || day !== drawnDay) {
      ctx.earthOverlays.setOverlay(OVERLAY_LAYER, networkOverlay(run.network, day, overlayColors()))
      drawnRun = run
      drawnDay = day
    }
    ctx.earthOverlays.setOverlay(GOODS_LAYER, goodsOverlay(run.network, position))
  })
  ctx.effect(() => () => {
    replay.dispose()
    ctx.earthOverlays.clearOverlay(OVERLAY_LAYER)
    ctx.earthOverlays.clearOverlay(GOODS_LAYER)
  }, 'ui-supply-chain: replay controller')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'supply-chain',
    order: 30,
    label: () => 'Supply chain',
    inject: () => ({
      presets,
      hooks: { replay },
      runSimulation: (config: Partial<SimulationConfig> & { preset?: string }) => {
        const { preset, ...overrides } = config
        replay.setBusy()
        void ctx.remote.supplyChain
          .simulate(preset === undefined ? { overrides } : { preset, overrides })
          .then((result) => { replay.setRun(unwrap(result)) })
          .catch((cause: unknown) => {
            replay.setError(cause instanceof Error ? cause.message : String(cause))
          })
      },
      setDay: (day: number) => { replay.setDay(day) },
      togglePlay: () => { replay.togglePlay() },
      flyTo: (lon: number, lat: number) => { ctx.earthOverlays.flyTo({ lat, lon, height: 1_200_000 }) },
      // The reports are pure derivations over a run the panel already holds, so
      // reading one costs no round trip.
      nodeReport: (run: SimulationRun, nodeId: string, item: string) => buildNodeReport(run, nodeId, item),
      bullwhipReport: (run: SimulationRun, item: string) => buildBullwhipReport(run, item),
      edgeReport: (run: SimulationRun) => buildEdgeReport(run),
    }),
  }, SupplyChainPanel))
}
