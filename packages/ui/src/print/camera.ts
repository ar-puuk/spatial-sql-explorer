// Spec 016: what the composer asks of the live map besides a picture of it: its zoom (for a typed scale), a settle
// signal (after moving it), the print extent box, and (the atlas) framing a page's feature. MapView owns the map
// and hands this over once it is ready.
import type { PrintExtent } from './extent.js'

/** Pixels kept clear on each side when fitting a page. */
export interface FitPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface CameraView {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

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
  /** The map's size on screen, CSS px: the viewport a page is framed in. */
  viewport(): { width: number; height: number }
  /** Frames `bounds` (west, south, east, north) inside the viewport less `padding`, north up, at once. */
  fit(bounds: PrintExtent, padding: FitPadding): void
  /** The position under a viewport pixel, or null off the map. */
  unproject(x: number, y: number): [number, number] | null
  view(): CameraView
  restoreView(view: CameraView): void
}
