// Spec 014: lengths and areas of drawn shapes, for the live labels while drawing (the engine's spheroid
// functions give the exact values in the `drawn` view). Spherical formulas on the WGS84 mean radius: within
// about half a percent of the spheroid, which is plenty for a label. Positions are [lon, lat] in degrees.

/** WGS84 mean radius, meters. */
const EARTH_RADIUS = 6_371_008.8
const RAD = Math.PI / 180

type Position = readonly number[]

/** Great-circle distance between two positions, meters (haversine). */
export function distanceMeters(a: Position, b: Position): number {
  const dLat = (b[1] - a[1]) * RAD
  const dLon = (b[0] - a[0]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Length of a line, meters. */
export function lineLengthMeters(line: readonly Position[]): number {
  let total = 0
  for (let i = 1; i < line.length; i++) total += distanceMeters(line[i - 1], line[i])
  return total
}

/** Area of a ring, square meters (always positive; spherical excess). */
export function ringAreaSquareMeters(ring: readonly Position[]): number {
  if (ring.length < 4) return 0
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i]
    const [lon2, lat2] = ring[i + 1]
    sum += (lon2 - lon1) * RAD * (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD))
  }
  return Math.abs((sum * EARTH_RADIUS * EARTH_RADIUS) / 2)
}

/** Area of a polygon (outer ring minus holes), square meters. */
export function polygonAreaSquareMeters(rings: readonly (readonly Position[])[]): number {
  if (rings.length === 0) return 0
  let area = ringAreaSquareMeters(rings[0])
  for (let i = 1; i < rings.length; i++) area -= ringAreaSquareMeters(rings[i])
  return Math.max(0, area)
}

/** Perimeter of a polygon's outer ring, meters. */
export function polygonPerimeterMeters(rings: readonly (readonly Position[])[]): number {
  return rings.length ? lineLengthMeters(rings[0]) : 0
}

export type UnitSystem = 'metric' | 'imperial'

const FOOT = 0.3048
const MILE = 1609.344
const ACRE = 4046.8564224

/** A length in the reader's units: m or km; ft or mi. */
export function formatLength(meters: number, units: UnitSystem): string {
  const n = (v: number, digits: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v)
  if (units === 'imperial') {
    const feet = meters / FOOT
    return feet < 1000 ? `${n(feet, 0)} ft` : `${n(meters / MILE, meters / MILE < 10 ? 2 : 1)} mi`
  }
  return meters < 1000 ? `${n(meters, meters < 10 ? 1 : 0)} m` : `${n(meters / 1000, meters < 10_000 ? 2 : 1)} km`
}

/** An area in the reader's units: m² or ha or km²; ft² or ac or mi². */
export function formatArea(squareMeters: number, units: UnitSystem): string {
  const n = (v: number, digits: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v)
  if (units === 'imperial') {
    const acres = squareMeters / ACRE
    if (acres < 1) return `${n(squareMeters / (FOOT * FOOT), 0)} ft²`
    const sqMiles = squareMeters / (MILE * MILE)
    return sqMiles < 0.5 ? `${n(acres, acres < 10 ? 2 : 1)} ac` : `${n(sqMiles, sqMiles < 10 ? 2 : 1)} mi²`
  }
  if (squareMeters < 10_000) return `${n(squareMeters, 0)} m²`
  if (squareMeters < 1_000_000) return `${n(squareMeters / 10_000, 2)} ha`
  return `${n(squareMeters / 1_000_000, squareMeters < 10_000_000 ? 2 : 1)} km²`
}

// --- Great-circle paths ------------------------------------------------------------------------------

/** Longitudes within 180 degrees of `reference` (the same place, continuous along a path across the date line). */
const unwrapLon = (lon: number, reference: number): number => {
  let l = lon
  while (l - reference > 180) l -= 360
  while (l - reference < -180) l += 360
  return l
}

/**
 * A line with every segment bent onto its great circle: extra positions at most `maxStepDegrees` of arc apart, so
 * on a flat map the line curves the way the shortest path on the globe does, and its drawn length is the length
 * measured (lineLengthMeters). Longitudes stay continuous across the date line (values beyond +-180), as a map
 * draws them; use `geodesicGeometry` for GeoJSON and SQL.
 */
export function greatCirclePath(line: readonly Position[], maxStepDegrees = 0.5): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < line.length; i++) {
    const [lonB, latB] = line[i]
    if (i === 0) {
      out.push([lonB, latB])
      continue
    }
    const [prevLon, prevLat] = out[out.length - 1]
    const endLon = unwrapLon(lonB, prevLon)
    const a = unit(prevLon, prevLat)
    const b = unit(endLon, latB)
    const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
    const delta = Math.acos(dot)
    const steps = Math.min(2000, Math.ceil(delta / (maxStepDegrees * RAD)))
    if (steps > 1 && Math.sin(delta) > 1e-9) {
      const s = Math.sin(delta)
      let ref = prevLon
      for (let k = 1; k < steps; k++) {
        const f = k / steps
        const wa = Math.sin((1 - f) * delta) / s
        const wb = Math.sin(f * delta) / s
        const x = wa * a[0] + wb * b[0]
        const y = wa * a[1] + wb * b[1]
        const z = wa * a[2] + wb * b[2]
        const lon = unwrapLon(Math.atan2(y, x) / RAD, ref)
        ref = lon
        out.push([lon, Math.asin(Math.max(-1, Math.min(1, z))) / RAD])
      }
    }
    out.push([endLon, latB])
  }
  return out
}

function unit(lon: number, lat: number): [number, number, number] {
  const cl = Math.cos(lat * RAD)
  return [cl * Math.cos(lon * RAD), cl * Math.sin(lon * RAD), Math.sin(lat * RAD)]
}

/**
 * A shape's geometry as GeoJSON for SQL and export: a line follows its great circle (split where it crosses the
 * date line, as GeoJSON wants); anything else is returned as it is.
 */
export function geodesicGeometry<G extends { type: string; coordinates: unknown }>(geometry: G): G | { type: 'LineString'; coordinates: Array<[number, number]> } | { type: 'MultiLineString'; coordinates: Array<Array<[number, number]>> } {
  if (geometry.type !== 'LineString') return geometry
  const path = greatCirclePath(geometry.coordinates as Position[])
  // Back into -180..180, cut where the line crosses the date line.
  const wrapped = path.map(([lon, lat]): [number, number] => [lon - 360 * Math.round(lon / 360), lat])
  // A jump of more than 180 degrees between neighbours is the date line: start a new part there.
  const cut: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []
  for (const p of wrapped) {
    const last = current[current.length - 1]
    if (last && Math.abs(p[0] - last[0]) > 180) {
      cut.push(current)
      current = []
    }
    current.push(p)
  }
  cut.push(current)
  return cut.length === 1 ? { type: 'LineString', coordinates: cut[0] } : { type: 'MultiLineString', coordinates: cut }
}
