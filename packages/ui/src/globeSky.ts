// Spec 008 (user request, 2026-10-11): the globe in space, after GeoLibre's
// design (a deep-space backdrop, a starfield that drifts with the view, an
// atmosphere glow around the earth). The glow is MapLibre's own sky
// atmosphere; the backdrop and stars are drawn here on a canvas behind the
// map, which the globe projection leaves transparent around the earth.
// Decorative only: no data, never in exports.
import type { SkySpecification } from 'maplibre-gl'

/** MapLibre's atmosphere around the globe, fading out as the globe turns into a flat map (zoom 5–7). */
export const GLOBE_SKY: SkySpecification = {
  'sky-color': '#0b1a36',
  'horizon-color': '#9fd3ff',
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
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
const TILE = 512
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

let starTile: HTMLCanvasElement | null = null

/** One seamless tile of stars, drawn once and repeated. */
function stars(): HTMLCanvasElement {
  if (starTile) return starTile
  const c = document.createElement('canvas')
  c.width = TILE
  c.height = TILE
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const rand = prng(20261011)
  const count = Math.round((TILE * TILE) / PIXELS_PER_STAR)
  for (let i = 0; i < count; i++) {
    const x = rand() * TILE
    const y = rand() * TILE
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
  starTile = c
  return c
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

  const tile = stars()
  // Parallax: a full turn of the globe moves the sky by two tiles.
  const ox = ((-center.lng / 360) * TILE * 2) % TILE
  const oy = ((center.lat / 180) * TILE) % TILE
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate((-bearing * Math.PI) / 180)
  const reach = Math.hypot(w, h) / 2 + TILE
  for (let x = -reach + (ox % TILE); x < reach; x += TILE) {
    for (let y = -reach + (oy % TILE); y < reach; y += TILE) ctx.drawImage(tile, x, y)
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
