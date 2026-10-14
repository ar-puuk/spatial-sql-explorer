// Spec 008 US7 (FR-030, research §6): the map as a PNG. The map's frame
// (and, on the globe, the sky behind it) is composed on a 2D canvas with the
// legend, drawn from the resolved style with canvas calls (not a DOM
// screenshot), and the basemap's attribution. Data colors are the style's;
// the legend box is light with dark text whatever the theme, for print.
import { dashPattern, markerExtent, markerPath, type SymbolSpec } from '@spatial-explorer/core'

export interface LegendGroup {
  title: string
  shape: 'area' | 'line' | 'point'
  /** Fill alpha of area and point swatches (lines are opaque). */
  alpha: number
  /** Visible classes, in legend order. */
  rows: Array<{ color: string; label: string; count?: number; symbol?: SymbolSpec }>
  /** Spec 011 US4: a continuous color's ramp, with the domain's ends. */
  ramp?: { colors: string[]; min: string; max: string }
  /** Spec 011 US4: an as-is property's line. */
  note?: string
}

/** Spec 009 US6: a bivariate square: cells row-major from low/low (i + nx * j). */
export interface LegendBivariate {
  x: string
  y: string
  nx: number
  ny: number
  cells: Array<{ color: string; visible: boolean }>
  noValue?: { color: string; label: string; count: number; visible: boolean }
}

/** The first group (the color channel, or a bivariate square), plus (spec 009) more groups after it: the size channel. */
export interface LegendSpec extends LegendGroup {
  groups?: LegendGroup[]
  bivariate?: LegendBivariate
  /** A heatmap: its ramp, sparse to dense (zero density is transparent). */
  gradient?: string[]
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
  // Spec 009: a bivariate square or a size group is a legend even without color rows.
  const lg = input.legend
  if (lg && (lg.rows.length || lg.bivariate || lg.gradient?.length || lg.groups?.some((g) => g.rows.length))) drawLegend(ctx, lg, h)
  if (input.attribution) drawAttribution(ctx, input.attribution, w, h)
  ctx.restore()
  return out
}

function drawLegend(ctx: CanvasRenderingContext2D, legend: LegendSpec, h: number): void {
  const pad = 8
  const row = 18
  const sw = 14
  // Spec 009: the color group, then each further group (its title, then its rows).
  const groups: LegendGroup[] = [legend, ...(legend.groups ?? [])].filter((g, i) => i === 0 || g.rows.length || g.ramp || g.note)
  type Line =
    | { kind: 'title'; text: string; main: boolean }
    | { kind: 'row'; group: LegendGroup; row: LegendGroup['rows'][number]; scale: number }
    | { kind: 'more'; n: number }
    | { kind: 'axis'; text: string }
    | { kind: 'cells'; j: number }
    | { kind: 'gradient'; colors: string[]; transparentStart?: boolean }
  const all: Line[] = []
  // A heatmap: the title, the ramp, and its ends.
  if (legend.gradient?.length) {
    if (legend.title) all.push({ kind: 'title', text: legend.title, main: true })
    all.push({ kind: 'gradient', colors: legend.gradient, transparentStart: true })
    all.push({ kind: 'axis', text: 'Sparse → Dense' })
  }
  // Spec 009 US6: the bivariate square, one 18 px line per row (high to low), with the axis labels.
  const biv = legend.bivariate
  if (biv) {
    if (legend.title) all.push({ kind: 'title', text: legend.title, main: true })
    all.push({ kind: 'axis', text: `↑ ${biv.y}` })
    for (let j = biv.ny - 1; j >= 0; j--) all.push({ kind: 'cells', j })
    all.push({ kind: 'axis', text: `${biv.x} →` })
    if (biv.noValue?.visible) all.push({ kind: 'row', group: { title: '', shape: 'area', alpha: 1, rows: [] }, row: { color: biv.noValue.color, label: biv.noValue.label, count: biv.noValue.count }, scale: 1 })
  }
  groups.forEach((g, i) => {
    if ((biv || legend.gradient?.length) && i === 0) return
    if (i === 0 ? g.title : true) all.push({ kind: 'title', text: g.title, main: i === 0 })
    // Spec 011 US4: a continuous color's ramp and ends; an as-is property's line.
    if (g.ramp) {
      all.push({ kind: 'gradient', colors: g.ramp.colors })
      all.push({ kind: 'axis', text: `${g.ramp.min} → ${g.ramp.max}` })
    }
    if (g.note) all.push({ kind: 'axis', text: g.note })
    // Markers keep their relative sizes within a group, shrunk together to fit a row.
    const reach = Math.max(1, ...g.rows.map((r) => (r.symbol ? r.symbol.radius * markerExtent(r.symbol.shape) + Math.min(r.symbol.strokeWidth, 3) / 2 : 5)))
    const scale = Math.min(1, (row / 2 - 1) / reach)
    for (const r of g.rows) all.push({ kind: 'row', group: g, row: r, scale })
  })
  const maxLines = Math.max(1, Math.floor((h - 60) / row))
  const lines = all.length > maxLines ? [...all.slice(0, maxLines - 1), { kind: 'more' as const, n: all.length - (maxLines - 1) }] : all
  ctx.font = FONT
  const countW = (r: { count?: number }) => (r.count === undefined ? 0 : ctx.measureText(nf.format(r.count)).width + 12)
  const rowW = Math.max(
    0,
    ...lines.map((l) =>
      l.kind === 'row'
        ? ctx.measureText(l.row.label).width + countW(l.row)
        : l.kind === 'more'
          ? ctx.measureText(`+${l.n} more`).width
          : l.kind === 'axis'
            ? ctx.measureText(l.text).width - sw - 8
            : l.kind === 'cells' && biv
              ? biv.nx * 18 - sw - 8
              : l.kind === 'gradient'
                ? 120 - sw - 8
                : 0
    )
  )
  ctx.font = TITLE_FONT
  const titleW = Math.max(0, ...lines.map((l) => (l.kind === 'title' ? ctx.measureText(l.text).width : 0)))
  const boxW = Math.min(320, Math.ceil(Math.max(titleW, sw + 8 + rowW) + pad * 2))
  const boxH = lines.length * row + pad * 2 - 2
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
  for (const l of lines) {
    if (l.kind === 'title') {
      ctx.fillStyle = l.main ? '#1f2328' : '#57606a'
      ctx.font = TITLE_FONT
      ctx.fillText(clip(ctx, l.text, boxW - pad * 2), x + pad, ty)
    } else if (l.kind === 'axis') {
      ctx.font = FONT
      ctx.fillStyle = '#57606a'
      ctx.fillText(clip(ctx, l.text, boxW - pad * 2), x + pad, ty)
    } else if (l.kind === 'cells') {
      for (let i = 0; i < (biv?.nx ?? 0); i++) {
        if (!biv) break
        const c = biv.cells[i + biv.nx * l.j]
        if (!c) continue
        const cx = x + pad + i * 18
        const cy = ty - 13
        if (c.visible) {
          ctx.fillStyle = c.color
          ctx.fillRect(cx, cy, 16, 16)
        } else {
          // Hidden: hollow, the color kept as its outline.
          ctx.strokeStyle = c.color
          ctx.lineWidth = 2
          ctx.strokeRect(cx + 1, cy + 1, 14, 14)
        }
      }
    } else if (l.kind === 'gradient') {
      const gx = x + pad
      const gw = boxW - pad * 2
      const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0)
      // A heatmap starts transparent (zero density); a continuous color runs through its stops.
      if (l.transparentStart) {
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
        l.colors.forEach((c, i) => grad.addColorStop((i + 1) / l.colors.length, c))
      } else l.colors.forEach((c, i) => grad.addColorStop(l.colors.length > 1 ? i / (l.colors.length - 1) : 0, c))
      ctx.fillStyle = grad
      ctx.fillRect(gx, ty - 12, gw, 12)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.lineWidth = 1
      ctx.strokeRect(gx + 0.5, ty - 11.5, gw - 1, 11)
    } else if (l.kind === 'more') {
      ctx.font = FONT
      ctx.fillStyle = '#57606a'
      ctx.fillText(`+${l.n} more`, x + pad + sw + 8, ty)
    } else {
      ctx.font = FONT
      const r = l.row
      const g = l.group
      const sy = ty - 11
      if (r.symbol) {
        drawSymbol(ctx, r.symbol, g.shape, x + pad, sy - 2, sw, l.scale)
      } else if (g.shape === 'line') {
        ctx.strokeStyle = r.color
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(x + pad, sy + 6)
        ctx.lineTo(x + pad + sw, sy + 6)
        ctx.stroke()
      } else {
        ctx.globalAlpha = Math.max(0.15, g.alpha)
        ctx.fillStyle = r.color
        if (g.shape === 'point') {
          ctx.beginPath()
          ctx.arc(x + pad + sw / 2, sy + 6, 5, 0, Math.PI * 2)
          ctx.fill()
        } else ctx.fillRect(x + pad, sy, sw, 12)
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
        ctx.lineWidth = 1
        if (g.shape === 'point') ctx.stroke()
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
    }
    ty += row
  }
}

/** One class's symbol in a `w` x 16 cell at (x, y): the map's shape, size, line width and pattern. */
function drawSymbol(ctx: CanvasRenderingContext2D, s: SymbolSpec, shape: LegendSpec['shape'], x: number, y: number, w: number, scale: number): void {
  const cy = y + 8
  // Spec 011: the property opacity on top of the fill and outline opacities, as the on-map legend draws it.
  const o = s.opacity ?? 1
  ctx.save()
  if (shape === 'line') {
    const lw = Math.min(Math.max(s.lineWidth, 1), 8)
    ctx.strokeStyle = s.lineColor
    ctx.globalAlpha = Math.max(0.2, s.strokeOpacity * o)
    ctx.lineWidth = lw
    ctx.setLineDash(dashPattern(s.dash)?.map((n) => n * lw) ?? [])
    ctx.beginPath()
    ctx.moveTo(x, cy)
    ctx.lineTo(x + w, cy)
    ctx.stroke()
  } else {
    const outline = Math.min(s.strokeWidth, 3)
    const path = shape === 'point' ? new Path2D(markerPath(s.shape, Math.max(1.5, s.radius * scale), x + w / 2, cy)) : new Path2D(`M${x} ${y + 2}h${w}v12h${-w}Z`)
    // Spec 011: a marker's rotation, clockwise about its center.
    if (shape === 'point' && s.rotation) {
      ctx.translate(x + w / 2, cy)
      ctx.rotate((s.rotation * Math.PI) / 180)
      ctx.translate(-(x + w / 2), -cy)
    }
    ctx.globalAlpha = Math.max(0.15, s.fillOpacity * o)
    ctx.fillStyle = s.fillColor
    ctx.fill(path)
    if (outline > 0) {
      ctx.globalAlpha = s.strokeOpacity * o
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
