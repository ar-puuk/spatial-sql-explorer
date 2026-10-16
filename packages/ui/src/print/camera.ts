// Spec 016: what the composer asks of the live map besides a picture of it: its zoom (for a typed scale), a settle
// signal (after moving it), and the print extent box. MapView owns the map and hands this over once it is ready.
import type { PrintExtent } from './extent.js'

export interface PrintCamera {
  zoom(): number
  /** The zoom range the map can reach. */
  zoomLimits(): { min: number; max: number }
  /** Jumps to a zoom (no animation), the center kept. */
  setZoom(zoom: number): void
  /** Resolves once the map has drawn the view, or after `timeoutMs`. */
  settled(timeoutMs?: number): Promise<void>
  /** The next drag on the map draws the extent. Resolves with it, or null when cancelled (Escape) or aborted. */
  drawExtent(opts: { aspect: number; signal: AbortSignal }): Promise<PrintExtent | null>
  /** Shows the extent box on the map, or takes it down when null. */
  showExtent(extent: PrintExtent | null): void
}
