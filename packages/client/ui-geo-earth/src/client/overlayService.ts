/**
 * The `ctx.earthOverlays` face: the cross-plugin contract for drawing a domain
 * layer on the shared globe.
 *
 * A domain plugin (supply chain, and any later one) owns a named layer and
 * replaces its whole contents; layers are independent of each other and of the
 * agent's "Drawings" layer, so no plugin can erase another's work. Consumers
 * type against this interface rather than importing the globe controller,
 * which stays private to this package.
 */
import type { FlyTarget, OverlayItem } from './earthController.ts'

/** The cross-plugin globe overlay contract published as `ctx.earthOverlays`. */
export interface IEarthOverlays {
  /**
   * Replace the whole contents of one named overlay layer.
   * @param name - layer name owned by the calling plugin.
   * @param items - the layer's complete contents.
   * @returns nothing.
   */
  setOverlay(name: string, items: readonly OverlayItem[]): void
  /**
   * Remove one overlay layer from the globe.
   * @param name - layer name to drop.
   * @returns nothing.
   */
  clearOverlay(name: string): void
  /**
   * Move the globe camera.
   * @param target - the destination and camera height.
   * @returns nothing.
   */
  flyTo(target: FlyTarget): void
}
