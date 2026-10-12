// Spec 008 US7 (FR-030, research §6): the map as a PNG. The map's frame
// (and, on the globe, the sky behind it) is composed on a 2D canvas with the
// legend, drawn from the resolved style with canvas calls (not a DOM
// screenshot), and the basemap's attribution. Data colors are the style's;
// the legend box is light with dark text whatever the theme, for print.
import { dashPattern, markerExtent, markerPath, type SymbolSpec } from '@spatial-explorer/core'

export interface LegendSpec {
  title: string
  shape: 'area' | 'line' | 'point'
  /** Fill alpha of area and point swatches (lines are opaque). */
  alpha: number
  /** Visible classes, in legend order. */
  rows: Array<{ color: string; label: string; count?: number; symbol?: SymbolSpec }>
}

/** MapView's capture: the current view as a PNG at 1x or 2x the map's size. */
export type MapCapture = (opts: { scale: 1 | 2; legend: LegendSpec | null }) => Promise<{ bytes: Uint8Array; width: number; height: number; notes: string[] }>

export interface ComposeInput {
  /** The map's frame, already at the export's pixel ratio. */
  map: CanvasImageSource & { width: number; height: number }
  /** Drawn first (globe: the night sky), scaled to the frame. */
  under?: HTMLCanvasElement | null
  /** Under everything, for transparent parts of the frame. */
  background: string
  /** Device pixels per CSS pixel of the export. */
  ratio: number
  legend: LegendSpec | null
  attribution: string
}

const FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif'
const TITLE_FONT = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif'
const nf = new Intl.NumberFormat('en-US')

/** `© <a href="…">OpenStreetMap</a>` → `© OpenStreetMap` */
export function plainAttribution(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function composeMapImage(input: ComposeInput): HTMLCanvasElement {
  const { map, ratio } = input
  const out = document.createElement('canvas')
  out.width = map.width
  out.height = map.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas is available for the map image.')
  ctx.fillStyle = input.background
  ctx.fillRect(0, 0, out.width, out.height)
  if (input.under && input.under.width) ctx.drawImage(input.under, 0, 0, out.width, out.height)
  ctx.drawImage(map, 0, 0, out.width, out.height)

  ctx.save()
  ctx.scale(ratio, ratio)
  const w = out.width / ratio
  const h = out.height / ratio
  if (input.legend && input.legend.rows.length) drawLegend(ctx, input.legend, h)
  if (input.attribution) drawAttribution(ctx, input.attribution, w, h)
  ctx.restore()
  return out
}

function drawLegend(ctx: CanvasRenderingContext2D, legend: LegendSpec, h: number): void {
  const pad = 8
  const row = 18
  const sw = 14
  const maxRows = Math.max(1, Math.floor((h - 60) / row) - 1)
  const rows = legend.rows.slice(0, maxRows)
  const more = legend.rows.length - rows.length
  ctx.font = FONT
  const countW = (r: { count?: number }) => (r.count === undefined ? 0 : ctx.measureText(nf.format(r.count)).width + 12)
  const textW = Math.max(...rows.map((r) => ctx.measureText(r.label).width + countW(r)), more ? ctx.measureText(`+${more} more`).width : 0)
  ctx.font = TITLE_FONT
  const titleW = legend.title ? ctx.measureText(legend.title).width : 0
  const boxW = Math.min(320, Math.ceil(Math.max(titleW, sw + 8 + textW) + pad * 2))
  const lines = rows.length + (more ? 1 : 0) + (legend.title ? 1 : 0)
  const boxH = lines * row + pad * 2 - 2
  const x = 10
  const y = h - boxH - 28
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
  ctx.lineWidth = 1
  roundRect(ctx, x + 0.5, y + 0.5, boxW, boxH, 4)
  ctx.fill()
  ctx.stroke()

  let ty = y + pad + 12
  ctx.textBaseline = 'alphabetic'
  if (legend.title) {
    ctx.fillStyle = '#1f2328'
    ctx.font = TITLE_FONT
    ctx.fillText(clip(ctx, legend.title, boxW - pad * 2), x + pad, ty)
    ty += row
  }
  ctx.font = FONT
  // Markers keep their relative sizes, shrunk together to fit a row.
  const reach = Math.max(1, ...rows.map((r) => (r.symbol ? r.symbol.radius * markerExtent(r.symbol.shape) + Math.min(r.symbol.strokeWidth, 3) / 2 : 5)))
  const scale = Math.min(1, (row / 2 - 1) / reach)
  for (const r of rows) {
    const sy = ty - 11
    if (r.symbol) {
      drawSymbol(ctx, r.symbol, legend.shape, x + pad, sy - 2, sw, scale)
    } else if (legend.shape === 'line') {
      ctx.strokeStyle = r.color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x + pad, sy + 6)
      ctx.lineTo(x + pad + sw, sy + 6)
      ctx.stroke()
    } else {
      ctx.globalAlpha = Math.max(0.15, legend.alpha)
      ctx.fillStyle = r.color
      if (legend.shape === 'point') {
        ctx.beginPath()
        ctx.arc(x + pad + sw / 2, sy + 6, 5, 0, Math.PI * 2)
        ctx.fill()
      } else ctx.fillRect(x + pad, sy, sw, 12)
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.lineWidth = 1
      if (legend.shape === 'point') ctx.stroke()
      else ctx.strokeRect(x + pad + 0.5, sy + 0.5, sw - 1, 11)
    }
    ctx.fillStyle = '#1f2328'
    const cw = countW(r)
    ctx.fillText(clip(ctx, r.label, boxW - pad * 2 - sw - 8 - cw), x + pad + sw + 8, ty)
    if (r.count !== undefined) {
      ctx.fillStyle = '#57606a'
      ctx.textAlign = 'right'
      ctx.fillText(nf.format(r.count), x + boxW - pad, ty)
      ctx.textAlign = 'left'
    }
    ty += row
  }
  if (more) {
    ctx.fillStyle = '#57606a'
    ctx.fillText(`+${more} more`, x + pad + sw + 8, ty)
  }
}

/** One class's symbol in a `w` x 16 cell at (x, y): the map's shape, size, line width and pattern. */
function drawSymbol(ctx: CanvasRenderingContext2D, s: SymbolSpec, shape: LegendSpec['shape'], x: number, y: number, w: number, scale: number): void {
  const cy = y + 8
  ctx.save()
  if (shape === 'line') {
    const lw = Math.min(Math.max(s.lineWidth, 1), 8)
    ctx.strokeStyle = s.lineColor
    ctx.globalAlpha = Math.max(0.2, s.strokeOpacity)
    ctx.lineWidth = lw
    ctx.setLineDash(dashPattern(s.dash)?.map((n) => n * lw) ?? [])
    ctx.beginPath()
    ctx.moveTo(x, cy)
    ctx.lineTo(x + w, cy)
    ctx.stroke()
  } else {
    const outline = Math.min(s.strokeWidth, 3)
    const path = shape === 'point' ? new Path2D(markerPath(s.shape, Math.max(1.5, s.radius * scale), x + w / 2, cy)) : new Path2D(`M${x} ${y + 2}h${w}v12h${-w}Z`)
    ctx.globalAlpha = Math.max(0.15, s.fillOpacity)
    ctx.fillStyle = s.fillColor
    ctx.fill(path)
    if (outline > 0) {
      ctx.globalAlpha = s.strokeOpacity
      ctx.strokeStyle = s.strokeColor
      ctx.lineWidth = outline
      if (shape === 'area') ctx.setLineDash(dashPattern(s.dash)?.map((n) => n * Math.max(outline, 1)) ?? [])
      ctx.stroke(path)
    }
  }
  ctx.restore()
}

function drawAttribution(ctx: CanvasRenderingContext2D, text: string, w: number, h: number): void {
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
  const t = clip(ctx, text, w - 20)
  const tw = ctx.measureText(t).width
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fillRect(w - tw - 12, h - 18, tw + 12, 18)
  ctx.fillStyle = '#333333'
  ctx.textBaseline = 'middle'
  ctx.fillText(t, w - tw - 6, h - 9)
  ctx.textBaseline = 'alphabetic'
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** PNG bytes; throws the browser's SecurityError when the canvas is tainted. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('The map image could not be encoded.'))
        void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
      }, 'image/png')
    } catch (err) {
      reject(err)
    }
  })
}
