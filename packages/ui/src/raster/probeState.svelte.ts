// Spec 027: what a shape drawn over the open raster says (US3 a profile along a line, US4 the statistics inside an area).
// One at a time: a new shape replaces the last, and the answer is dropped if the shape, or the raster, changed while it was
// being read. The reading itself is the raster worker's; this only asks, keeps the answer and lets go of it.
import { cellMeters, flattenPoints, profileBands, profileSamples, type DrawnShape, type ProfileBand, type ProfileSamples } from '@spatial-explorer/core'
import type { RasterHandle } from './handle.js'

export interface ProfileResult {
  samples: ProfileSamples
  bands: ProfileBand[]
}

export interface Probe {
  kind: 'profile' | 'area'
  shapeId: string
  status: 'running' | 'done' | 'error'
  message?: string
  profile?: ProfileResult
}

export function createProbeState(getHandle: () => RasterHandle | null, getBands: () => number[], removeShapes: (ids: string[]) => void) {
  let probe = $state.raw<Probe | null>(null)
  let run = 0
  /** The place of the chart the pointer is over, marked on the map. */
  let marker = $state.raw<[number, number] | null>(null)

  async function profile(shape: DrawnShape, mine: number): Promise<void> {
    const handle = getHandle()
    if (!handle || shape.geometry.type !== 'LineString') return
    const samples = profileSamples(shape.geometry.coordinates, cellMeters(handle.facts))
    const bands = getBands()
    if (samples.points.length < 2) {
      probe = { kind: 'profile', shapeId: shape.id, status: 'error', message: 'A profile needs a line of at least two points.' }
      return
    }
    try {
      const raw = await handle.reader.profile(flattenPoints(samples.points), bands)
      if (mine !== run || handle !== getHandle()) return
      const named = bands.map((b) => ({ index: b, name: handle.facts.bands[b - 1]?.name ?? `Band ${b}` }))
      probe = { kind: 'profile', shapeId: shape.id, status: 'done', profile: { samples, bands: profileBands(raw, samples.points.length, named, handle.facts.nodata) } }
    } catch (error) {
      if (mine === run) probe = { kind: 'profile', shapeId: shape.id, status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    get probe() {
      return probe
    },
    get marker() {
      return marker
    },
    setMarker(next: readonly number[] | null): void {
      marker = next ? [next[0], next[1]] : null
    },
    /** A finished shape of the `profile` or `area` purpose replaces the last answer (and the last shape, which is taken off the map). */
    start(shape: DrawnShape): void {
      const previous = probe?.shapeId
      const mine = ++run
      probe = { kind: shape.purpose === 'area' ? 'area' : 'profile', shapeId: shape.id, status: 'running' }
      if (previous && previous !== shape.id) removeShapes([previous])
      if (shape.purpose === 'profile') void profile(shape, mine)
    },
    /** Lets go of the answer and the shape. */
    clear(): void {
      run++
      const id = probe?.shapeId
      probe = null
      marker = null
      if (id) removeShapes([id])
    },
  }
}

export type ProbeState = ReturnType<typeof createProbeState>
