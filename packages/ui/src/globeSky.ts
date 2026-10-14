// Spec 008 (user request, 2026-10-11): the globe in space, after GeoLibre's
// design (a deep-space backdrop, a starfield that drifts with the view, an
// atmosphere glow around the earth, occasional comets). The glow is mostly our
// halo; MapLibre's sky atmosphere adds a faint lit rim. The backdrop and stars
// are drawn here on a canvas behind the map, which the globe projection leaves
// transparent around the earth; comets on a second canvas, never in exports.
// Decorative only: no data.
// Comets adapted from GeoLibre packages/plugins/src/plugins/maplibre-effects.ts (MIT).
import type { SkySpecification } from 'maplibre-gl'

/** How strongly MapLibre's lit atmosphere shows on the globe's rim (user request 2026-10-14: half of MapLibre's full glow; GeoLibre has none). */
const ATMOSPHERE = 0.5

/** MapLibre's atmosphere around the globe, fading out as the globe turns into a flat map (zoom 5–7). */
export const GLOBE_SKY: SkySpecification = {
  'sky-color': '#0b1a36',
  'horizon-color': '#9fd3ff',
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, ATMOSPHERE, 5, ATMOSPHERE, 7, 0],
}

/** Flat map: no atmosphere (MapLibre has no "no sky" value). */
export const FLAT_SKY: SkySpecification = { 'atmosphere-blend': 0 }

/** The globe's outline on screen. */
export interface GlobeCircle {
  x: number
  y: number
  r: number
}

/**
 * The globe's outline on screen: points just inside the horizon (88° from
 * the view's center), projected; their centroid and mean distance. Works
 * tilted too (an ellipse, approximated by a circle).
 */
export function globeCircle(center: { lng: number; lat: number }, project: (lngLat: [number, number]) => { x: number; y: number }): GlobeCircle | null {
  const rad = Math.PI / 180
  const d = 88 * rad
  const lat1 = center.lat * rad
  const lng1 = center.lng * rad
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < 24; i++) {
    const b = (i / 24) * 2 * Math.PI
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
    const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
    const p = project([((lng2 / rad + 540) % 360) - 180, lat2 / rad])
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p)
  }
  if (pts.length < 8) return null
  const x = pts.reduce((a, p) => a + p.x, 0) / pts.length
  const y = pts.reduce((a, p) => a + p.y, 0) / pts.length
  const r = pts.reduce((a, p) => a + Math.hypot(p.x - x, p.y - y), 0) / pts.length
  return r > 4 ? { x, y, r } : null
}

/** Deep-space colors: the center of the backdrop and its edges. Fixed, like data colors (not theme tokens). */
const SPACE_CENTER = '#0d1f3c'
const SPACE_EDGE = '#020610'
/** The starfield's side grows in these steps (CSS pixels), so a resize rarely redraws it. */
const FIELD_STEP = 512
/** Roughly one star per this many CSS pixels. */
const PIXELS_PER_STAR = 2600

/** A small seeded PRNG (mulberry32): the same sky every time. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let field: { canvas: HTMLCanvasElement; side: number; dpr: number } | null = null

/**
 * One square field of stars at least as wide as the view's diagonal, drawn
 * once (at device resolution) and wrapped as the view moves. A 512 px tile
 * repeated across the view showed its pattern; at this size no repeat is on
 * screen, rotated or not (GeoLibre: one view-sized field).
 */
function stars(minSide: number, dpr: number): { canvas: HTMLCanvasElement; side: number } {
  const side = Math.ceil(minSide / FIELD_STEP) * FIELD_STEP
  if (field && field.side >= side && field.dpr === dpr) return field
  const c = document.createElement('canvas')
  c.width = Math.round(side * dpr)
  c.height = Math.round(side * dpr)
  const ctx = c.getContext('2d')
  field = { canvas: c, side, dpr }
  if (!ctx) return field
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const rand = prng(20261011)
  const count = Math.round((side * side) / PIXELS_PER_STAR)
  for (let i = 0; i < count; i++) {
    const x = rand() * side
    const y = rand() * side
    const big = rand() < 0.06
    const r = big ? 0.9 + rand() * 0.7 : 0.35 + rand() * 0.5
    const alpha = big ? 0.75 + rand() * 0.25 : 0.25 + rand() * 0.55
    // Mostly white, a few warm and cool tints.
    const tint = rand()
    const color = tint < 0.08 ? '255,214,170' : tint < 0.18 ? '190,215,255' : '255,255,255'
    ctx.fillStyle = `rgba(${color},${alpha.toFixed(2)})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (big) {
      // A faint glow around the brightest stars.
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4)
      g.addColorStop(0, `rgba(${color},0.25)`)
      g.addColorStop(1, `rgba(${color},0)`)
      ctx.fillStyle = g
      ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8)
    }
  }
  return field
}

/**
 * Paints the backdrop and stars into `canvas` (sized to its box). The stars
 * drift slowly with the view's center, so panning the globe feels like
 * turning it against the sky.
 */
export function drawSky(canvas: HTMLCanvasElement, center: { lng: number; lat: number }, bearing: number, globe: GlobeCircle | null): void {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
  bg.addColorStop(0, SPACE_CENTER)
  bg.addColorStop(1, SPACE_EDGE)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  const half = Math.hypot(w, h) / 2
  const { canvas: sky, side } = stars(half * 2, dpr)
  // Parallax: a full turn of the globe moves the sky by one field (GeoLibre's rate).
  const wrap = (v: number): number => ((v % side) + side) % side
  // The first copy at or left of (above) the circle's edge, in step with the view's center.
  const x0 = -half - wrap(-half + (center.lng / 360) * side)
  const y0 = -half - wrap(-half - (center.lat / 180) * side)
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate((-bearing * Math.PI) / 180)
  // The field's copies that touch the circle around the view (it is at least that circle's width).
  for (let x = x0; x < half; x += side) {
    for (let y = y0; y < half; y += side) ctx.drawImage(sky, x, y, side, side)
  }
  ctx.restore()

  // The earth's glow: a soft blue halo just outside the globe's edge (the globe covers the inside).
  if (globe) {
    const { x, y, r } = globe
    const halo = ctx.createRadialGradient(x, y, r * 0.96, x, y, r * 1.22)
    halo.addColorStop(0, 'rgba(150, 205, 255, 0.55)')
    halo.addColorStop(0.18, 'rgba(110, 175, 255, 0.32)')
    halo.addColorStop(0.5, 'rgba(70, 130, 230, 0.12)')
    halo.addColorStop(1, 'rgba(40, 90, 200, 0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = halo
    ctx.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6)
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** One comet: where its head is, its heading and speed (CSS px per 60 Hz frame), its tail and its life (frames). */
interface Comet {
  x: number
  y: number
  angle: number
  speed: number
  len: number
  life: number
  maxLife: number
}

/** On average one comet every this many milliseconds (GeoLibre: about every 3 s; ours is subtler). */
const COMET_MEAN_GAP_MS = 7000
const FRAME_MS = 1000 / 60

/**
 * Occasional comets, drawn on their own canvas behind the map (so they pass
 * behind the globe). One at a time, faint and quick. Nothing runs between
 * comets: the next is a timer, and frames are drawn only while one is
 * crossing. None when the system asks for reduced motion.
 */
export class Comets {
  private comet: Comet | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private frame = 0
  private last = 0
  private running = false

  constructor(private readonly canvas: HTMLCanvasElement) {}

  start(): void {
    if (this.running || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    this.running = true
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.comet = null
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private schedule(): void {
    // Exponential gaps: comets come at random, not on a beat.
    const gap = -Math.log(1 - Math.random()) * COMET_MEAN_GAP_MS
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.running) return
      if (document.hidden) this.schedule()
      else this.spawn()
    }, gap)
  }

  private spawn(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h) {
      this.schedule()
      return
    }
    const dpr = window.devicePixelRatio || 1
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
    }
    this.comet = {
      x: Math.random() * w,
      y: Math.random() * h,
      angle: Math.random() * Math.PI * 2,
      speed: 5 + Math.random() * 5,
      len: 90 + Math.random() * 110,
      life: 0,
      maxLife: 60 + Math.random() * 40,
    }
    this.last = performance.now()
    this.frame = requestAnimationFrame((t) => this.draw(t))
  }

  private draw(now: number): void {
    this.frame = 0
    const c = this.comet
    const ctx = this.canvas.getContext('2d')
    if (!c || !ctx || !this.running) return
    const step = Math.min((now - this.last) / FRAME_MS, 2)
    this.last = now
    c.life += step
    c.x += Math.cos(c.angle) * c.speed * step
    c.y += Math.sin(c.angle) * c.speed * step
    const dpr = window.devicePixelRatio || 1
    const w = this.canvas.width / dpr
    const h = this.canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (c.life >= c.maxLife || c.x < -c.len || c.x > w + c.len || c.y < -c.len || c.y > h + c.len) {
      this.comet = null
      this.schedule()
      return
    }
    // Fades in quickly and out slowly; at most half-bright (subtle).
    const t = c.life / c.maxLife
    const alpha = 0.5 * Math.min(1, t * 6) * (1 - t)
    const tx = c.x - Math.cos(c.angle) * c.len
    const ty = c.y - Math.sin(c.angle) * c.len
    const tail = ctx.createLinearGradient(tx, ty, c.x, c.y)
    tail.addColorStop(0, 'rgba(255, 255, 255, 0)')
    tail.addColorStop(1, `rgba(255, 255, 255, ${alpha.toFixed(3)})`)
    ctx.strokeStyle = tail
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
    ctx.fillStyle = `rgba(200, 220, 255, ${(0.6 * alpha).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2)
    ctx.fill()
    this.frame = requestAnimationFrame((n) => this.draw(n))
  }
}
