// Spec 016: the composed page as bytes: PNG and PDF are the page drawn at print
// resolution, SVG keeps the furniture editable. Saving is the caller's (through
// the host). Adapted from GeoLibre's print-layout-export.ts (opengeos/GeoLibre,
// MIT, © 2026 Qiusheng Wu).
import { zipSync } from 'fflate'
import { drawLayout, pageMm, pagePx, resolvePageSize, type LayoutOptions } from './layout.js'

/** The map as captured for the page. */
export interface CapturedMap {
  image: HTMLCanvasElement
  width: number
  height: number
  /** Ground meters per device pixel of the image, at the center. */
  metersPerPixel: number
  /** Device pixels per CSS pixel of the map on screen. */
  pixelRatio: number
  bearingDeg: number
  /** What the picture shows, in degrees: west, south, east, north. */
  extent: [number, number, number, number]
}

/** The most pixels along one side of a raster page. */
const MAX_SIDE = 8192

/**
 * The layout rasterized on an offscreen canvas. Millimeter pages render at `dpi`; pixel pages at their exact size.
 * A page past `MAX_SIDE` pixels is drawn at a lower resolution, and `notes` says so.
 */
export function renderToCanvas(opts: LayoutOptions, dpi: number, notes?: string[]): HTMLCanvasElement {
  const size = resolvePageSize(opts)
  let { width, height } = pagePx(size, dpi)
  const longest = Math.max(width, height)
  if (longest > MAX_SIDE) {
    const k = MAX_SIDE / longest
    width = Math.round(width * k)
    height = Math.round(height * k)
    notes?.push(`The page is larger than a picture can be (${MAX_SIDE} px): drawn at a lower resolution.`)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  drawLayout(canvas, opts)
  return canvas
}

export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
  if (!blob) throw new Error('The picture could not be encoded.')
  return new Uint8Array(await blob.arrayBuffer())
}

export interface PageFile {
  bytes: Uint8Array
  /** What the file is, for the confirmation: "1754 × 1240 px", "297 × 210 mm". */
  size: string
  notes: string[]
}

const sizeLabel = (opts: LayoutOptions): string => {
  const s = resolvePageSize(opts)
  return `${Math.round(s.width * 10) / 10} × ${Math.round(s.height * 10) / 10} ${s.unit}`
}

export async function layoutPng(opts: LayoutOptions, dpi = 150): Promise<PageFile> {
  const notes: string[] = []
  const canvas = renderToCanvas(opts, dpi, notes)
  return { bytes: await canvasToPngBytes(canvas), size: `${canvas.width} × ${canvas.height} px`, notes }
}

/** The page as an SVG: text, swatches, tables and charts stay editable; the map is an embedded picture. */
export async function layoutSvg(opts: LayoutOptions): Promise<PageFile> {
  // Loaded on first use: PNG and PDF never load svgcanvas.
  const { renderLayoutSvg } = await import('./svg.js')
  return { bytes: new TextEncoder().encode(renderLayoutSvg(opts)), size: sizeLabel(opts), notes: [] }
}

async function loadJsPdf(): Promise<typeof import('jspdf').jsPDF> {
  // Loaded on first use (about 0.4 MB).
  return (await import('jspdf')).jsPDF
}

/** One page as a PDF holding the page image at `dpi`. */
export async function layoutPdf(opts: LayoutOptions, dpi = 150): Promise<PageFile> {
  const JsPdf = await loadJsPdf()
  const notes: string[] = []
  const { widthMm, heightMm } = pageMm(resolvePageSize(opts))
  const canvas = renderToCanvas(opts, dpi, notes)
  // Orientation from the resolved shape, not the toggle: jsPDF turns a format that disagrees with it.
  const pdf = new JsPdf({ orientation: widthMm >= heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [widthMm, heightMm] })
  if (opts.title.trim()) pdf.setProperties({ title: opts.title.trim() })
  // The canvas itself, so jsPDF reads its pixels without a base64 copy.
  pdf.addImage(canvas, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST')
  return { bytes: new Uint8Array(pdf.output('arraybuffer')), size: sizeLabel(opts), notes }
}

/** The page as a PNG on the clipboard. The blob is handed over as a promise so the write starts inside the click (Safari). */
export async function copyLayoutToClipboard(opts: LayoutOptions, dpi = 150): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('This browser cannot copy pictures to the clipboard.')
  const blob = (async () => {
    const png = await new Promise<Blob | null>((resolve) => renderToCanvas(opts, dpi).toBlob((b) => resolve(b), 'image/png'))
    if (!png) throw new Error('The picture could not be encoded.')
    return png
  })()
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/** What an atlas export asks of the caller, one page at a time (it drives the map between calls). */
export interface AtlasExportSource {
  total: number
  optionsForPage: (pageIndex: number) => Promise<LayoutOptions>
  onProgress?: (current: number, total: number) => void
}

/** Every page as one multi-page PDF. */
export async function atlasPdf(source: AtlasExportSource, dpi = 150): Promise<PageFile> {
  const { total, optionsForPage, onProgress } = source
  if (total < 1) throw new Error('An atlas needs at least one page.')
  // Before driving the map through every page, so a failed import stops the export up front.
  const JsPdf = await loadJsPdf()
  const notes: string[] = []
  let pdf: InstanceType<typeof JsPdf> | null = null
  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total)
    const opts = await optionsForPage(i)
    const { widthMm, heightMm } = pageMm(resolvePageSize(opts))
    const orientation = widthMm >= heightMm ? 'landscape' : 'portrait'
    const canvas = renderToCanvas(opts, dpi, i === 0 ? notes : undefined)
    if (!pdf) pdf = new JsPdf({ orientation, unit: 'mm', format: [widthMm, heightMm] })
    else pdf.addPage([widthMm, heightMm], orientation)
    pdf.addImage(canvas, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST')
  }
  return { bytes: new Uint8Array((pdf as InstanceType<typeof JsPdf>).output('arraybuffer')), size: `${total} pages`, notes }
}

/** Every page as a PNG in a zip. `entryName` names a page; a name taken already gets -2, -3 ... so none overwrites another. */
export async function atlasPngZip(source: AtlasExportSource, entryName: (pageIndex: number) => string, dpi = 150): Promise<PageFile> {
  const { total, optionsForPage, onProgress } = source
  if (total < 1) throw new Error('An atlas needs at least one page.')
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  // As the file systems compare on extraction (case-insensitive, trailing dots and spaces dropped).
  const key = (name: string): string => name.normalize('NFC').replace(/[ .]+$/g, '').toLowerCase()
  const notes: string[] = []
  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total)
    const opts = await optionsForPage(i)
    const bytes = await canvasToPngBytes(renderToCanvas(opts, dpi, i === 0 ? notes : undefined))
    const base = entryName(i) || String(i + 1)
    let name = base
    for (let suffix = 2; used.has(key(name)); suffix++) name = `${base}-${suffix}`
    used.add(key(name))
    files[`${name}.png`] = bytes
  }
  // PNG is compressed already: store it.
  return { bytes: zipSync(files, { level: 0 }), size: `${total} pictures`, notes }
}
