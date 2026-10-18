// Heatmap: the automatic radius and intensity. MapLibre adds each point's kernel,
// weight × intensity × GAUSS_COEF × exp(−4.5·(d/r)²), and clamps the sum at 1
// (its heatmap shaders); nothing scales to the data. With the radius in meters
// the sum at a place doesn't change with zoom, so the engine finds the
// density once and the intensity is 1 / that density at the 98th percentile
// (weighted by the points, not the places): the densest 2% take the ramp's last
// color and one outlier can't flatten the rest, at every zoom.
//
// The density is estimated on a grid in Web Mercator meters (where MapLibre
// draws): points are summed into cells a third of the radius wide, and the
// kernel is evaluated at each cell's weighted center from every cell within
// the radius. The radius itself comes from the data: about eight neighbors
// under the kernel in a typical place (`heatmapRadiusSql`).
import { toWebMercatorSql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import { validGeometry, type ViewTarget } from './viewport.js'

/** MapLibre's heatmap kernel constant (1 / √(2π)). */
export const HEAT_GAUSS = 0.3989422804014327
/** The kernel's falloff: exp(−4.5·(d/r)²). */
const FALLOFF = 4.5
/** Cells per radius, and the share of the points below the density that takes the last color. */
const CELLS_PER_RADIUS = 3
export const HEAT_PERCENTILE = 0.98
/** Cells the percentile is read over when there are more (a hash sample: the join costs cells × 49). */
const MAX_CELLS = 200_000
/** Points the spacing is measured on, and the factor from the nearest neighbor to about eight (see heatmapRadiusSql). */
const SPACING_SAMPLE = 2000
const NEIGHBOR_FACTOR = 3.3

const WEB_MERCATOR_R = 6378137

/** The radius in Web Mercator meters: ground meters at `latitude` (Mercator stretches by 1 / cos φ). */
export function mercatorRadius(meters: number, latitude: number): number {
  return meters / Math.cos((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180)
}

/**
 * SQL for the density at intensity 1 that the last color stands for (column
 * `peak`, the 98th percentile over the points of `t`), each weighted by
 * `weight` (value / the column's largest value, as the map draws it; none, or
 * no positive values: 1 each). Lines and polygons don't make the heatmap; a
 * multipoint counts at its center.
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
), pick AS (SELECT * FROM c ORDER BY hash(i, j) LIMIT ${MAX_CELLS}),
near AS (SELECT pick.i, pick.j, pick.w AS w0, pick.x AS x0, pick.y AS y0, pick.i + di AS ni, pick.j + dj AS nj FROM pick, range(${-k}, ${k + 1}) a(di), range(${-k}, ${k + 1}) b(dj)),
d AS (
  SELECT max(w0) AS w, sum(c.w * exp(-${FALLOFF} * ((c.x - x0) ^ 2 + (c.y - y0) ^ 2) / ${radius ** 2})) AS d
  FROM near JOIN c ON c.i = near.ni AND c.j = near.nj GROUP BY near.i, near.j
), r AS (SELECT d, sum(w) OVER (ORDER BY d) AS cum, sum(w) OVER () AS tot FROM d)
SELECT coalesce(min(d), 0) * ${HEAT_GAUSS} AS peak FROM r WHERE cum >= tot * ${HEAT_PERCENTILE}`
}

/**
 * SQL for a radius that suits the points of `t` (columns `radius`, in Web
 * Mercator meters, and `cy`, the middle of their extent in Mercator y). It is
 * the typical distance to the 8th neighbor: the nearest-neighbor distance
 * (median) over a hash sample of up to 2,000 places, scaled for the sample
 * being thinner than the data (× √(sample / places)) and from 1 to 8 neighbors
 * (× 3.3, from a Poisson field: the median 1st-neighbor distance is
 * 0.47 / √density and the 8th 1.56 / √density). Kept between 1/300 and 1/8 of
 * the extent's diagonal, so a handful of points or a heavy cluster still
 * give a surface you can see. No row values when fewer than two places.
 */
export function heatmapRadiusSql(t: ViewTarget): string {
  const merc = toWebMercatorSql(`ST_Centroid(${t.geom})`, t.srid)
  return `WITH q AS (
  SELECT ST_X(__se_p) AS x, ST_Y(__se_p) AS y
  FROM (SELECT ${merc} AS __se_p FROM ${t.relation} WHERE ${validGeometry(t.geom, t.allValid)} AND ST_Dimension(${t.geom}) = 0)
), g AS (SELECT x, y FROM q WHERE isfinite(x) AND isfinite(y) GROUP BY x, y),
st AS (SELECT count(*) AS nd, min(x) AS x0, max(x) AS x1, min(y) AS y0, max(y) AS y1 FROM g),
s AS (SELECT row_number() OVER () AS id, x, y FROM (SELECT x, y FROM g ORDER BY hash(x, y) LIMIT ${SPACING_SAMPLE})),
nn AS (SELECT min(sqrt((a.x - b.x) ^ 2 + (a.y - b.y) ^ 2)) AS d FROM s a JOIN s b ON a.id <> b.id GROUP BY a.id)
SELECT
  least(greatest(${NEIGHBOR_FACTOR} * sqrt(least(${SPACING_SAMPLE}, nd) / nd::DOUBLE) * (SELECT median(d) FROM nn), sqrt((x1 - x0) ^ 2 + (y1 - y0) ^ 2) / 300), sqrt((x1 - x0) ^ 2 + (y1 - y0) ^ 2) / 8) AS radius,
  (y0 + y1) / 2 AS cy
FROM st WHERE nd >= 2`
}

/** The ground latitude of a Web Mercator y. */
export function mercatorLatitude(y: number): number {
  return (Math.atan(Math.sinh(y / WEB_MERCATOR_R)) * 180) / Math.PI
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
  const dens: Array<[number, number]> = []
  let total = 0
  for (const t of all) {
    let d = 0
    for (let di = -CELLS_PER_RADIUS; di <= CELLS_PER_RADIUS; di++) {
      for (let dj = -CELLS_PER_RADIUS; dj <= CELLS_PER_RADIUS; dj++) {
        const c = byKey.get(`${t.i + di},${t.j + dj}`)
        if (c) d += c.w * Math.exp((-FALLOFF * ((c.x - t.x) ** 2 + (c.y - t.y) ** 2)) / radius ** 2)
      }
    }
    dens.push([d, t.w])
    total += t.w
  }
  dens.sort((a, b) => a[0] - b[0])
  let cum = 0
  for (const [d, w] of dens) {
    cum += w
    if (cum >= total * HEAT_PERCENTILE) return d * HEAT_GAUSS
  }
  return 0
}
