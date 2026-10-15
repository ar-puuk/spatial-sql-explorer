// The sky behind the globe (spec 015): where Earth stands against the stars at a moment, and what the globe's camera sees.
// Pure math, tested; the drawing is packages/ui/src/globeSky.ts. Directions are unit vectors in the inertial frame
// (x toward right ascension 0 on the equator, z toward the celestial north pole).

const RAD = Math.PI / 180

export type Vec3 = readonly [number, number, number]

/** A direction from right ascension and declination, in degrees. */
export function directionOf(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * RAD
  const d = decDeg * RAD
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
}

/** Greenwich mean sidereal time in radians for a time in milliseconds since 1970 (UTC): how far Earth has turned against the stars (Meeus, Astronomical Algorithms). */
export function siderealTime(nowMs: number): number {
  const days = nowMs / 86_400_000 + 2_440_587.5 - 2_451_545.0
  return ((((280.46061837 + 360.98564736629 * days) % 360) + 360) % 360) * RAD
}

export interface SkyFrame {
  /** Where the camera hangs, as a direction from Earth's center. */
  at: Vec3
  /** Screen right and screen up, as directions. */
  right: Vec3
  up: Vec3
}

/**
 * The camera over (longitude, latitude), in the inertial frame at `nowMs`: Earth's east is to the right and north up, turned
 * by the map's bearing (at bearing b, the direction b east of north is up). Earth-fixed directions are turned about the pole by
 * the sidereal time, so the celestial pole stays over the geographic north pole, and the stars move as Earth turns.
 */
export function skyFrame(center: { lng: number; lat: number }, bearingDeg: number, nowMs: number): SkyFrame {
  const theta = siderealTime(nowMs)
  const ct = Math.cos(theta)
  const st = Math.sin(theta)
  const toSky = (x: number, y: number, z: number): Vec3 => [x * ct - y * st, x * st + y * ct, z]
  const lng = center.lng * RAD
  const lat = center.lat * RAD
  const at = toSky(Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat))
  const east = toSky(-Math.sin(lng), Math.cos(lng), 0)
  const north = toSky(-Math.sin(lat) * Math.cos(lng), -Math.sin(lat) * Math.sin(lng), Math.cos(lat))
  const b = bearingDeg * RAD
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const mix = (e: number, n: number, i: number): number => east[i] * e + north[i] * n
  return {
    at,
    right: [mix(cb, -sb, 0), mix(cb, -sb, 1), mix(cb, -sb, 2)],
    up: [mix(sb, cb, 0), mix(sb, cb, 1), mix(sb, cb, 2)],
  }
}

/** Dot product. */
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
