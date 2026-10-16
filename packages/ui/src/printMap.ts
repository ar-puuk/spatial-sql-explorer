// Spec 016: the map as a printed page, in three formats (GeoLibre's Print
// options: PNG, PDF and editable SVG). One drawing routine puts the page
// together (the map frame, a title, the legend, a north arrow, a scale bar and
// the basemap's credit) on a 2D canvas for PNG and PDF, and on svgcanvas for
// SVG, where the text, swatches and gradients stay vectors; only the map
// itself is an embedded image. The page is laid out in CSS px (96 per inch).
// Adapted from GeoLibre's print layout (north arrow and scale bar drawing).
import { clip, drawAttribution, drawLegend, legendHasContent, type LegendSpec, type MapShot, type Rect } from './mapImage.js'

export type PrintFormat = 'png' | 'pdf' | 'svg'
export type PaperId = 'map' | 'a4' | 'a3' | 'letter' | 'legal' | 'tabloid'
export type PageOrientation = 'auto' | 'portrait' | 'landscape'

/** Paper sizes, portrait, in millimeters. 'map' is the map's size on screen. */
export const PAPERS: ReadonlyArray<{ id: PaperId; label: string; mm?: [number, number] }> = [
  { id: 'map', label: 'Size of the map on screen' },
  { id: 'a4', label: 'A4 (210 × 297 mm)', mm: [210, 297] },
  { id: 'a3', label: 'A3 (297 × 420 mm)', mm: [297, 420] },
  { id: 'letter', label: 'Letter (8.5 × 11 in)', mm: [215.9, 279.4] },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', mm: [215.9, 355.6] },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', mm: [279.4, 431.8] },
]

export interface PrintOptions {
  format: PrintFormat
  paper: PaperId
  orientation: PageOrientation
  title: string
  /** The legend to draw, or null for none. */
  legend: LegendSpec | null
  scaleBar: boolean
  northArrow: boolean
  units: 'metric' | 'imperial'
  /** The map-size page: device pixels per CSS pixel of the file (PNG, PDF raster). */
  scale: 1 | 2
  /** A paper page: dots per inch of the raster (PNG, PDF). */
  dpi: 150 | 300
}

export interface PagePlan {
  /** CSS px. */
  width: number
  height: number
  /** Where the map goes, and how much it is scaled from its size on screen. */
  map: Rect
  zoom: number
  /** A title above the map (paper pages), or null: a map-size page overlays the title on the map. */
  titleRect: Rect | null
  /** The paper's millimeters (landscape or portrait as printed), or null for a map-size page. */
  mm: [number, number] | null
  label: string
}

const PX_PER_MM = 96 / 25.4
const MARGIN = 10 * PX_PER_MM
const TITLE_H = 44
const OVERLAY_TITLE_H = 36
const INK = '#1f2328'
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif'
/** The most pixels along one side of a raster page. */
const MAX_SIDE = 8192

export function planPage(shot: Pick<MapShot, 'width' | 'height'>, o: Pick<PrintOptions, 'paper' | 'orientation' | 'title'>): PagePlan {
  const paper = PAPERS.find((p) => p.id === o.paper)
  if (!paper?.mm) return { width: shot.width, height: shot.height, map: { x: 0, y: 0, w: shot.width, h: shot.height }, zoom: 1, titleRect: null, mm: null, label: `${shot.width} × ${shot.height} px` }
  const landscape = o.orientation === 'auto' ? shot.width >= shot.height : o.orientation === 'landscape'
  const mm: [number, number] = landscape ? [paper.mm[1], paper.mm[0]] : [paper.mm[0], paper.mm[1]]
  const width = mm[0] * PX_PER_MM
  const height = mm[1] * PX_PER_MM
  const titleH = o.title.trim() ? TITLE_H : 0
  const body: Rect = { x: MARGIN, y: MARGIN + titleH, w: width - 2 * MARGIN, h: height - 2 * MARGIN - titleH }
  const zoom = Math.min(body.w / shot.width, body.h / shot.height)
  const w = shot.width * zoom
  const h = shot.height * zoom
  return {
    width,
    height,
    map: { x: body.x + (body.w - w) / 2, y: body.y + (body.h - h) / 2, w, h },
    zoom,
    titleRect: titleH ? { x: MARGIN, y: MARGIN, w: width - 2 * MARGIN, h: titleH } : null,
    mm,
    label: `${paper.label.split(' (')[0]}, ${landscape ? 'landscape' : 'portrait'}`,
  }
}

/** A "nice" ground length (1, 2 or 5 times a power of ten) of at most `maxMeters`, with its label. */
export function niceDistance(maxMeters: number, units: 'metric' | 'imperial'): { meters: number; label: string } {
  const [unit, name] =
    units === 'metric'
      ? maxMeters >= 1000
        ? [1000, 'km']
        : maxMeters >= 1
          ? [1, 'm']
          : [0.01, 'cm']
      : maxMeters >= 1609.344
        ? [1609.344, 'mi']
        : [0.3048, 'ft']
  const n = maxMeters / unit
  const pow = 10 ** Math.floor(Math.log10(n))
  const lead = n / pow
  const nice = (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * pow
  return { meters: nice * unit, label: `${Number(nice.toPrecision(6)).toLocaleString('en-US')} ${name}` }
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, bearing: number): void {
  const r = 11
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.translate(cx, cy)
  // North is at -bearing when the map is turned clockwise by `bearing`.
  ctx.rotate((-bearing * Math.PI) / 180)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.lineTo(r * 0.55, r * 0.7)
  ctx.lineTo(0, r * 0.35)
  ctx.lineTo(-r * 0.55, r * 0.7)
  ctx.closePath()
  ctx.fill()
  // The letter stays upright: only the arrow turns.
  ctx.translate(0, -r - 6)
  ctx.rotate((bearing * Math.PI) / 180)
  ctx.font = `700 11px ${SANS}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', 0, 0)
  ctx.restore()
}

/** A two-tone bar with its length above it, its right end at `right` and its foot at `bottom`. */
function drawScaleBar(ctx: CanvasRenderingContext2D, right: number, bottom: number, metersPerPixel: number, units: 'metric' | 'imperial'): void {
  if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel)) return
  const { meters, label } = niceDistance(120 * metersPerPixel, units)
  const barW = Math.max(8, meters / metersPerPixel)
  const barH = 6
  const x0 = right - barW
  const y0 = bottom - barH
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.fillRect(x0 - 6, y0 - 22, barW + 12, barH + 28)
  ctx.fillStyle = INK
  ctx.fillRect(x0, y0, barW / 2, barH)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x0 + barW / 2, y0, barW / 2, barH)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, barW - 1, barH - 1)
  ctx.fillStyle = INK
  ctx.font = `500 11px ${SANS}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(label, right, y0 - 5)
  ctx.restore()
}

/** The whole page, in CSS px, on a canvas context or an svgcanvas one. */
export function drawPage(ctx: CanvasRenderingContext2D, shot: MapShot, o: PrintOptions, plan: PagePlan): void {
  const r = plan.map
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, plan.width, plan.height)
  ctx.drawImage(shot.frame, r.x, r.y, r.w, r.h)
  if (plan.mm) {
    ctx.strokeStyle = '#8a8a8a'
    ctx.lineWidth = 1
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
  }
  const title = o.title.trim()
  let top = 0
  if (title) {
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    if (plan.titleRect) {
      ctx.fillStyle = INK
      ctx.font = `700 22px ${SANS}`
      ctx.fillText(clip(ctx, title, plan.titleRect.w), plan.titleRect.x, plan.titleRect.y + plan.titleRect.h / 2 - 4)
    } else {
      top = OVERLAY_TITLE_H
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.fillRect(r.x, r.y, r.w, top)
      ctx.fillStyle = INK
      ctx.font = `700 18px ${SANS}`
      ctx.fillText(clip(ctx, title, r.w - 24), r.x + 12, r.y + top / 2)
    }
    ctx.textBaseline = 'alphabetic'
  }
  if (legendHasContent(o.legend)) drawLegend(ctx, o.legend, r)
  if (o.northArrow) drawNorthArrow(ctx, r.x + r.w - 36, r.y + top + 36, shot.bearing)
  if (o.scaleBar) drawScaleBar(ctx, r.x + r.w - 12, r.y + r.h - 24, shot.metersPerPixel / plan.zoom, o.units)
  if (shot.attribution) drawAttribution(ctx, shot.attribution, r)
}

export interface PrintedPage {
  bytes: Uint8Array
  /** What the dialog says it saved: "1280 × 700 px", or "A4, landscape". */
  size: string
  notes: string[]
}

/** The raster page: the canvas size is the page at `k` device pixels per CSS pixel. */
function rasterPage(shot: MapShot, o: PrintOptions, plan: PagePlan, notes: string[]): HTMLCanvasElement {
  let k = plan.mm ? o.dpi / 96 : shot.ratio
  if (Math.max(plan.width, plan.height) * k > MAX_SIDE) {
    k = MAX_SIDE / Math.max(plan.width, plan.height)
    notes.push(`The page is larger than a picture can be (${MAX_SIDE} px): drawn at ${Math.round(k * 96)} dpi.`)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(plan.width * k)
  canvas.height = Math.round(plan.height * k)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas is available for the page.')
  ctx.scale(canvas.width / plan.width, canvas.height / plan.height)
  drawPage(ctx, shot, o, plan)
  return canvas
}

function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('The picture could not be encoded.'))
        void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
      }, 'image/png')
    } catch (err) {
      reject(err)
    }
  })
}

export async function printPage(shot: MapShot, o: PrintOptions): Promise<PrintedPage> {
  const plan = planPage(shot, o)
  const notes = [...shot.notes]
  if (o.format === 'svg') {
    // Loaded on first use: PNG and PDF never load svgcanvas.
    const { Context } = await import('svgcanvas')
    const ctx = new Context(plan.width, plan.height)
    drawPage(ctx as unknown as CanvasRenderingContext2D, shot, o, plan)
    const svg = ctx.getSvg()
    svg.setAttribute('viewBox', `0 0 ${plan.width} ${plan.height}`)
    // A paper page keeps its real size, so it prints at scale from an editor.
    svg.setAttribute('width', plan.mm ? `${plan.mm[0]}mm` : String(plan.width))
    svg.setAttribute('height', plan.mm ? `${plan.mm[1]}mm` : String(plan.height))
    svg.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    return { bytes: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${ctx.getSerializedSvg()}`), size: plan.label, notes }
  }
  const canvas = rasterPage(shot, o, plan, notes)
  if (o.format === 'png') return { bytes: await pngBytes(canvas), size: `${canvas.width} × ${canvas.height} px`, notes }
  // Loaded on first use (about 0.4 MB).
  const { jsPDF } = await import('jspdf')
  const [wMm, hMm] = plan.mm ?? [plan.width / PX_PER_MM, plan.height / PX_PER_MM]
  const pdf = new jsPDF({ orientation: wMm >= hMm ? 'landscape' : 'portrait', unit: 'mm', format: [wMm, hMm] })
  if (o.title.trim()) pdf.setProperties({ title: o.title.trim() })
  pdf.addImage(canvas, 'PNG', 0, 0, wMm, hMm, undefined, 'FAST')
  return { bytes: new Uint8Array(pdf.output('arraybuffer')), size: plan.label, notes }
}
