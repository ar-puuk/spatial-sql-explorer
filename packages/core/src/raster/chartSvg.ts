// Spec 027: the profile chart and the histograms of an area as standalone SVG text, for saving (SVG as it is, PNG drawn from it).
// Pure and independent of the page: fixed light colors on white and a generic sans-serif, so a saved chart reads in a document
// whatever theme the app was in. The text stays text (editable in a vector editor).
import { distanceAxis, niceTicks, summarizeProfile, type ProfileBand, type ProfileSamples } from './profile.js'
import type { BandAreaStats } from './areaStats.js'

const FONT = 'font-family="Segoe UI, Helvetica, Arial, sans-serif"'
const INK = '#1f2328'
const MUTED = '#57606a'
const GRID = '#d8dee4'
const ACCENT = '#2563eb'
const BAND_COLORS = ['#d9382f', '#2f9e44', '#2563eb']

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f1 = (n: number): string => n.toFixed(1)
/** A number for an axis or a figure: grouped, at most two decimals. */
const fmt = (v: number): string => Number(v.toFixed(2)).toLocaleString('en-US')

export interface ChartSvg {
  svg: string
  width: number
  height: number
}

export interface ProfileSvgOptions {
  /** Shown above the chart, e.g. the file's name. */
  title?: string
  imperial?: boolean
  width?: number
  height?: number
}

/** The profile as a chart: axes, gridlines, one line per band (with gaps), a summary line under the title. */
export function profileSvg(samples: ProfileSamples, bands: readonly ProfileBand[], o: ProfileSvgOptions = {}): ChartSvg {
  const W = o.width ?? 960
  const H = o.height ?? 420
  const M = { l: 70, r: 24, t: 66, b: 46 }
  const plotW = W - M.l - M.r
  const plotH = H - M.t - M.b
  const total = samples.totalMeters
  const axis = distanceAxis(total, o.imperial === true)
  const all = bands.flatMap((b) => b.values).filter((v): v is number => v !== null)
  const lo = all.length ? Math.min(...all) : 0
  const hi = all.length ? Math.max(...all) : 1
  const pad = (hi > lo ? hi - lo : 1) * 0.06
  const yMin = lo - pad
  const yMax = hi + pad
  const x = (meters: number): number => M.l + (total > 0 ? (meters / total) * plotW : 0)
  const y = (v: number): number => M.t + (1 - (v - yMin) / (yMax - yMin)) * plotH
  const parts: string[] = []
  const three = bands.length === 3
  const color = (k: number): string => (three ? BAND_COLORS[k] : ACCENT)

  for (const t of niceTicks(yMin, yMax, Math.max(2, Math.floor(plotH / 44)))) {
    parts.push(`<line x1="${M.l}" x2="${M.l + plotW}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="${GRID}"/>`)
    parts.push(`<text x="${M.l - 8}" y="${f1(y(t) + 4)}" text-anchor="end" font-size="12" fill="${MUTED}" ${FONT}>${esc(fmt(t))}</text>`)
  }
  for (const t of niceTicks(0, total / axis.perUnit, Math.max(2, Math.floor(plotW / 100)))) {
    const px = x(t * axis.perUnit)
    parts.push(`<line x1="${f1(px)}" x2="${f1(px)}" y1="${M.t}" y2="${M.t + plotH}" stroke="${GRID}" stroke-opacity="0.6"/>`)
    parts.push(`<text x="${f1(px)}" y="${M.t + plotH + 18}" text-anchor="middle" font-size="12" fill="${MUTED}" ${FONT}>${esc(fmt(t))}</text>`)
  }
  parts.push(`<rect x="${M.l}" y="${M.t}" width="${plotW}" height="${plotH}" fill="none" stroke="${GRID}"/>`)
  parts.push(`<text x="${M.l + plotW}" y="${H - 10}" text-anchor="end" font-size="12" fill="${MUTED}" ${FONT}>Distance (${axis.unit})</text>`)

  bands.forEach((b, k) => {
    let run: string[] = []
    const flush = (): void => {
      if (run.length > 1) parts.push(`<path d="${run.join('')}" fill="none" stroke="${color(k)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
      else if (run.length === 1) {
        const m = /M([\d.-]+),([\d.-]+)/.exec(run[0])
        if (m) parts.push(`<circle cx="${m[1]}" cy="${m[2]}" r="2.5" fill="${color(k)}"/>`)
      }
      run = []
    }
    b.values.forEach((v, i) => {
      if (v === null) return flush()
      run.push(`${run.length ? 'L' : 'M'}${f1(x(samples.distances[i]))},${f1(y(v))}`)
    })
    flush()
  })

  // Title, the figures, and the band colors when there are three.
  const unit = axis.unit
  const s = bands.length ? summarizeProfile(bands[0].values) : null
  const sub =
    bands.length === 1 && s && s.valid
      ? `Length ${fmt(total / axis.perUnit)} ${unit}   Min ${fmt(s.min ?? 0)}   Max ${fmt(s.max ?? 0)}   Mean ${fmt(s.mean ?? 0)}   Rise ${fmt(s.rise)}   Fall ${fmt(s.fall)}`
      : `Length ${fmt(total / axis.perUnit)} ${unit}`
  parts.push(`<text x="${M.l}" y="26" font-size="16" font-weight="600" fill="${INK}" ${FONT}>${esc(o.title ?? 'Profile')}</text>`)
  parts.push(`<text x="${M.l}" y="46" font-size="12" fill="${MUTED}" ${FONT}>${esc(sub)}</text>`)
  if (three) {
    bands.forEach((b, k) => {
      const lx = W - M.r - (bands.length - k) * 90
      parts.push(`<rect x="${lx}" y="18" width="12" height="12" fill="${BAND_COLORS[k]}"/><text x="${lx + 17}" y="28" font-size="12" fill="${INK}" ${FONT}>${esc(b.name)}</text>`)
    })
  }
  return { svg: wrap(W, H, parts), width: W, height: H }
}

export interface HistogramSvgOptions {
  title?: string
  width?: number
  /** Height of each band's histogram. */
  rowHeight?: number
}

/** The histograms of the values inside an area, one per band, with the mean marked. */
export function histogramSvg(bands: readonly BandAreaStats[], o: HistogramSvgOptions = {}): ChartSvg {
  const W = o.width ?? 960
  const ROW = o.rowHeight ?? 220
  const M = { l: 70, r: 24, t: 56, b: 12 }
  const shown = bands.filter((b) => b.histogram.length > 0)
  const rows = Math.max(1, shown.length)
  const H = M.t + rows * ROW + M.b
  const plotW = W - M.l - M.r
  const parts: string[] = []
  parts.push(`<text x="${M.l}" y="26" font-size="16" font-weight="600" fill="${INK}" ${FONT}>${esc(o.title ?? 'Values inside the area')}</text>`)
  const three = bands.length === 3
  shown.forEach((b, r) => {
    const top = M.t + r * ROW + 22
    const plotH = ROW - 22 - 36
    const bandIndex = bands.indexOf(b)
    const fill = three ? BAND_COLORS[bandIndex] : ACCENT
    const peak = Math.max(1, ...b.histogram)
    parts.push(`<text x="${M.l}" y="${top - 8}" font-size="13" font-weight="600" fill="${INK}" ${FONT}>${esc(bands.length > 1 ? b.name : 'Values')}  <tspan font-weight="400" fill="${MUTED}">${esc(`${fmt(b.min ?? 0)} to ${fmt(b.max ?? 0)}, ${fmt(b.count)} cells`)}</tspan></text>`)
    for (const g of [0, 0.5, 1]) parts.push(`<line x1="${M.l}" x2="${M.l + plotW}" y1="${f1(top + plotH * g)}" y2="${f1(top + plotH * g)}" stroke="${GRID}"/>`)
    const bw = plotW / b.histogram.length
    b.histogram.forEach((c, i) => {
      const h = (c / peak) * plotH
      parts.push(`<rect x="${f1(M.l + i * bw)}" y="${f1(top + plotH - h)}" width="${f1(Math.max(0.5, bw - 0.4))}" height="${f1(h)}" fill="${fill}" fill-opacity="0.85"/>`)
    })
    parts.push(`<text x="${M.l}" y="${top + plotH + 16}" font-size="12" fill="${MUTED}" ${FONT}>${esc(fmt(b.min ?? 0))}</text>`)
    parts.push(`<text x="${M.l + plotW}" y="${top + plotH + 16}" text-anchor="end" font-size="12" fill="${MUTED}" ${FONT}>${esc(fmt(b.max ?? 0))}</text>`)
    parts.push(`<text x="${M.l - 8}" y="${f1(top + 10)}" text-anchor="end" font-size="11" fill="${MUTED}" ${FONT}>${esc(fmt(peak))}</text>`)
    if (b.min !== null && b.max !== null && b.mean !== null && b.max > b.min) {
      const mx = M.l + ((b.mean - b.min) / (b.max - b.min)) * plotW
      const right = mx > M.l + plotW * 0.7
      parts.push(`<line x1="${f1(mx)}" x2="${f1(mx)}" y1="${top}" y2="${f1(top + plotH)}" stroke="${INK}" stroke-dasharray="5 4"/>`)
      parts.push(`<text x="${f1(right ? mx - 6 : mx + 6)}" y="${top + 12}" text-anchor="${right ? 'end' : 'start'}" font-size="12" fill="${INK}" ${FONT}>mean ${esc(fmt(b.mean))}</text>`)
    }
  })
  if (!shown.length) parts.push(`<text x="${M.l}" y="${M.t + 24}" font-size="13" fill="${MUTED}" ${FONT}>No values inside the area.</text>`)
  return { svg: wrap(W, H, parts), width: W, height: H }
}

function wrap(w: number, h: number, parts: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${parts.join('')}</svg>\n`
}
