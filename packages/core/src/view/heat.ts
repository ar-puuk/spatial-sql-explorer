// Heatmap: the automatic intensity. MapLibre adds each point's kernel,
// weight × intensity × GAUSS_COEF × exp(−4.5·(d/r)²), and clamps the sum at 1
// (its heatmap shaders); nothing scales to the densest spot. With the radius
// in meters the sum at a place doesn't change with zoom, so the engine finds
// its peak once and the intensity is 1 / peak: the densest spot takes the
// ramp's last color, at every zoom.
//
// The peak is estimated on a grid in Web Mercator meters (where MapLibre
// draws): points are summed into cells a quarter of the radius wide, and the
// kernel is evaluated at the weighted centers of the heaviest cells, from
// every cell within the radius.
import { toWebMercatorSql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import { validGeometry, type ViewTarget } from './viewport.js'

/** MapLibre's heatmap kernel constant (1 / √(2π)). */
export const HEAT_GAUSS = 0.3989422804014327
/** The kernel's falloff: exp(−4.5·(d/r)²). */
const FALLOFF = 4.5
/** Cells per radius, and the heaviest cells the peak is looked for around. */
const CELLS_PER_RADIUS = 4
const CANDIDATES = 400

const WEB_MERCATOR_R = 6378137

/** The radius in Web Mercator meters: ground meters at `latitude` (Mercator stretches by 1 / cos φ). */
export function mercatorRadius(meters: number, latitude: number): number {
  return meters / Math.cos((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180)
}

/**
 * SQL for the peak density at intensity 1 (column `peak`) of the points of
 * `t`, each weighted by `weight` (value / the column's largest value, as the
 * map draws it; none, or no positive values: 1 each). Lines and polygons
 * don't make the heatmap; a multipoint counts at its center.
 */
export function heatmapPeakSql(t: ViewTarget, radius: number, weight: string | null): string {
  const s = radius / CELLS_PER_RADIUS
  const v = weight ? `TRY_CAST(${quoteIdent(weight)} AS DOUBLE)` : '1.0'
  const w = weight ? `CASE WHEN __se_m > 0 THEN greatest(coalesce(${v}, 0), 0) / __se_m ELSE 1.0 END` : '1.0'
  const max = weight ? `, (SELECT max(${v}) FROM ${t.relation}) AS __se_m` : ''
  const merc = toWebMercatorSql(`ST_Centroid(${t.geom})`, t.srid)
  const k = CELLS_PER_RADIUS
  return `WITH p AS (
  SELECT ST_X(__se_p) AS x, ST_Y(__se_p) AS y, ${w} AS w
  FROM (SELECT ${merc} AS __se_p, *${max} FROM ${t.relation} WHERE ${validGeometry(t.geom, t.allValid)} AND ST_Dimension(${t.geom}) = 0)
), c AS (
  SELECT floor(x / ${s})::BIGINT AS i, floor(y / ${s})::BIGINT AS j, sum(w) AS w, sum(w * x) / sum(w) AS x, sum(w * y) / sum(w) AS y
  FROM p WHERE w > 0 AND isfinite(x) AND isfinite(y) GROUP BY 1, 2
), top AS (SELECT i, j, x, y FROM c ORDER BY w DESC LIMIT ${CANDIDATES}),
near AS (SELECT top.*, top.i + di AS ni, top.j + dj AS nj FROM top, range(${-k}, ${k + 1}) a(di), range(${-k}, ${k + 1}) b(dj))
SELECT coalesce(max(d), 0) * ${HEAT_GAUSS} AS peak FROM (
  SELECT near.i, near.j, sum(c.w * exp(-${FALLOFF} * ((c.x - near.x) ^ 2 + (c.y - near.y) ^ 2) / ${radius ** 2})) AS d
  FROM near JOIN c ON c.i = near.ni AND c.j = near.nj GROUP BY 1, 2
)`
}

/** Web Mercator meters of a WGS84 point. */
function toMercator(lon: number, lat: number): [number, number] {
  const phi = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
  return [(WEB_MERCATOR_R * lon * Math.PI) / 180, WEB_MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + phi / 2))]
}

/** The same estimate in memory, for results held as features: points as [lon, lat, weight]. */
export function heatmapPeak(points: ReadonlyArray<readonly [number, number, number]>, radius: number): number {
  const s = radius / CELLS_PER_RADIUS
  const cells = new Map<string, { i: number; j: number; w: number; x: number; y: number }>()
  for (const [lon, lat, w] of points) {
    if (!(w > 0)) continue
    const [x, y] = toMercator(lon, lat)
    const i = Math.floor(x / s)
    const j = Math.floor(y / s)
    const key = `${i},${j}`
    const c = cells.get(key) ?? { i, j, w: 0, x: 0, y: 0 }
    c.w += w
    c.x += w * x
    c.y += w * y
    cells.set(key, c)
  }
  const all = [...cells.values()].map((c) => ({ ...c, x: c.x / c.w, y: c.y / c.w }))
  const byKey = new Map(all.map((c) => [`${c.i},${c.j}`, c]))
  let peak = 0
  for (const t of [...all].sort((a, b) => b.w - a.w).slice(0, CANDIDATES)) {
    let d = 0
    for (let di = -CELLS_PER_RADIUS; di <= CELLS_PER_RADIUS; di++) {
      for (let dj = -CELLS_PER_RADIUS; dj <= CELLS_PER_RADIUS; dj++) {
        const c = byKey.get(`${t.i + di},${t.j + dj}`)
        if (c) d += c.w * Math.exp((-FALLOFF * ((c.x - t.x) ** 2 + (c.y - t.y) ** 2)) / radius ** 2)
      }
    }
    peak = Math.max(peak, d)
  }
  return peak * HEAT_GAUSS
}
