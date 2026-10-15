// Spec 015: the sky behind the globe is oriented as the real one is: Polaris over the north pole, the sky turning with
// the sidereal time of the clock.
import { describe, expect, it } from 'vitest'
import { directionOf, dot, siderealTime, skyFrame } from '@spatial-explorer/core'

const POLARIS = directionOf(37.95, 89.26)
const DUBHE = directionOf(165.93, 61.75)
const DEG = 180 / Math.PI

describe('sidereal time', () => {
  it('matches the reference value at J2000 (2000-01-01 12:00 UT: 280.46 degrees)', () => {
    expect(siderealTime(Date.UTC(2000, 0, 1, 12)) * DEG).toBeCloseTo(280.46, 1)
  })
  it('advances 360.9856 degrees a day, 15.04 an hour', () => {
    const a = siderealTime(Date.UTC(2026, 9, 15, 0))
    const b = siderealTime(Date.UTC(2026, 9, 15, 1))
    expect((((b - a) * DEG + 360) % 360)).toBeCloseTo(15.0411, 3)
  })
})

describe('the globe camera', () => {
  const times = [Date.UTC(2026, 0, 3, 2), Date.UTC(2026, 6, 20, 15), Date.UTC(2026, 9, 15, 21, 30)]
  const centers = [
    { lng: 0, lat: 40 },
    { lng: -112, lat: 40.7 },
    { lng: 100, lat: 10 },
  ]

  it('puts Polaris straight above the north pole, along the globe\'s axis, whatever the time or the longitude', () => {
    for (const t of times)
      for (const c of centers) {
        const f = skyFrame(c, 0, t)
        // Up on screen is north: the pole's direction has the up component cos(latitude) and none to the side.
        expect(dot(POLARIS, f.up)).toBeCloseTo(Math.cos((c.lat * Math.PI) / 180), 1)
        expect(Math.abs(dot(POLARIS, f.right))).toBeLessThan(0.025)
      }
  })

  it('turns the pole with the map: at bearing 90 the pole is to the left of up', () => {
    const f = skyFrame({ lng: 10, lat: 30 }, 90, times[0])
    expect(dot(POLARIS, f.right)).toBeLessThan(-0.8)
    expect(Math.abs(dot(POLARIS, f.up))).toBeLessThan(0.05)
  })

  it('is a right-handed view from outside: right x up points at the camera', () => {
    const f = skyFrame({ lng: 33, lat: -20 }, 25, times[1])
    const cross: [number, number, number] = [
      f.right[1] * f.up[2] - f.right[2] * f.up[1],
      f.right[2] * f.up[0] - f.right[0] * f.up[2],
      f.right[0] * f.up[1] - f.right[1] * f.up[0],
    ]
    for (let i = 0; i < 3; i++) expect(cross[i]).toBeCloseTo(f.at[i], 5)
  })

  it('turns the Big Dipper around Polaris by about a quarter turn in six sidereal hours (foreshortened by the view)', () => {
    const angle = (t: number): number => {
      const f = skyFrame({ lng: 0, lat: 40 }, 0, t)
      const px = dot(POLARIS, f.right)
      const py = dot(POLARIS, f.up)
      return Math.atan2(dot(DUBHE, f.up) - py, dot(DUBHE, f.right) - px) * DEG
    }
    const sidereal6h = (6 * 3_600_000 * 360) / 360.98564736629
    const turned = (((angle(times[2] + sidereal6h) - angle(times[2])) % 360) + 360) % 360
    expect(Math.min(turned, 360 - turned)).toBeGreaterThan(75)
    expect(Math.min(turned, 360 - turned)).toBeLessThan(110)
  })
})

describe('what lies behind the Earth', () => {
  const t = Date.UTC(2026, 9, 15, 21, 30)
  // Beyond the Earth from the camera is the direction away from its position: the Arctic and Polaris are never in one view.
  const beyond = (lat: number): number => -dot(POLARIS, skyFrame({ lng: -100, lat }, 0, t).at)
  it('has Polaris behind the camera when the Arctic is in view, and behind the Earth from the south', () => {
    expect(beyond(40)).toBeLessThan(0)
    expect(beyond(75)).toBeLessThan(0)
    expect(beyond(-40)).toBeGreaterThan(0.5)
  })
})
