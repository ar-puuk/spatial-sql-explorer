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
