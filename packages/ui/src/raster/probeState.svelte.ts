// Spec 027: what shapes drawn over the open raster say (US3 a profile along a line, US4 the statistics inside an area). The
// latest answer of each kind is kept (they show side by side as tabs of the bottom panel); a new shape of a kind replaces that
// kind's last answer and takes its old shape off the map. An answer is dropped if the shape, or the raster, changed while it was
// being read. The reading itself is the raster worker's; this only asks, keeps the answer and lets go of it.
import { cellMeters, flattenPoints, measureShape, profileBands, profileSamples, type AreaResult, type DrawnShape, type ProfileBand, type ProfileSamples } from '@spatial-explorer/core'
import type { RasterHandle } from './handle.js'

export interface ProfileResult {
  samples: ProfileSamples
  bands: ProfileBand[]
}

export type ProbeKind = 'profile' | 'area'

export interface Probe {
  kind: ProbeKind
  shapeId: string
  status: 'running' | 'done' | 'error'
  message?: string
  profile?: ProfileResult
  area?: AreaResult
}

export function createProbeState(getHandle: () => RasterHandle | null, getBands: () => number[], removeShapes: (ids: string[]) => void) {
  let profileProbe = $state.raw<Probe | null>(null)
  let areaProbe = $state.raw<Probe | null>(null)
  /** The kind started last: what the test hooks and the open tab follow. */
  let last = $state<ProbeKind>('profile')
  const runs: Record<ProbeKind, number> = { profile: 0, area: 0 }
  /** The place of the chart the pointer is over, marked on the map. */
  let marker = $state.raw<[number, number] | null>(null)

  const set = (kind: ProbeKind, p: Probe | null): void => {
    if (kind === 'profile') profileProbe = p
    else areaProbe = p
  }
  const get = (kind: ProbeKind): Probe | null => (kind === 'profile' ? profileProbe : areaProbe)

  async function profile(shape: DrawnShape, mine: number): Promise<void> {
    const handle = getHandle()
    if (!handle || shape.geometry.type !== 'LineString') return
    const samples = profileSamples(shape.geometry.coordinates, cellMeters(handle.facts))
    const bands = getBands()
    if (samples.points.length < 2) {
      set('profile', { kind: 'profile', shapeId: shape.id, status: 'error', message: 'A profile needs a line of at least two points.' })
      return
    }
    try {
      const raw = await handle.reader.profile(flattenPoints(samples.points), bands)
      if (mine !== runs.profile || handle !== getHandle()) return
      const named = bands.map((b) => ({ index: b, name: handle.facts.bands[b - 1]?.name ?? `Band ${b}` }))
      set('profile', { kind: 'profile', shapeId: shape.id, status: 'done', profile: { samples, bands: profileBands(raw, samples.points.length, named, handle.facts.nodata) } })
    } catch (error) {
      if (mine === runs.profile) set('profile', { kind: 'profile', shapeId: shape.id, status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function area(shape: DrawnShape, mine: number): Promise<void> {
    const handle = getHandle()
    if (!handle || shape.geometry.type !== 'Polygon') return
    const outer = shape.geometry.coordinates[0] ?? []
    if (outer.length < 4) {
      set('area', { kind: 'area', shapeId: shape.id, status: 'error', message: 'An area needs at least three corners.' })
      return
    }
    const ring = new Float64Array(outer.length * 2)
    outer.forEach((p, i) => {
      ring[i * 2] = p[0]
      ring[i * 2 + 1] = p[1]
    })
    const bands = getBands().map((b) => ({ index: b, name: handle.facts.bands[b - 1]?.name ?? `Band ${b}` }))
    try {
      const answer = await handle.reader.areaStats(ring, bands)
      if (mine !== runs.area || handle !== getHandle()) return
      const cell = cellMeters(handle.facts)
      set('area', {
        kind: 'area',
        shapeId: shape.id,
        status: 'done',
        area: { areaM2: measureShape(shape).areaM2 ?? 0, approximate: answer.approximate, cellMeters: cell === null ? null : cell * answer.scale, bands: answer.bands },
      })
    } catch (error) {
      if (mine === runs.area) set('area', { kind: 'area', shapeId: shape.id, status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    /** The answer started last (what the tests read). */
    get probe() {
      return get(last)
    },
    get profileProbe() {
      return profileProbe
    },
    get areaProbe() {
      return areaProbe
    },
    /** The tab to show: the kind started last, or the one chosen. */
    get tab() {
      return last
    },
    setTab(kind: ProbeKind): void {
      last = kind
    },
    get marker() {
      return marker
    },
    setMarker(next: readonly number[] | null): void {
      marker = next ? [next[0], next[1]] : null
    },
    /** A finished shape of the `profile` or `area` purpose replaces that kind's last answer (and its last shape, which is taken off the map). */
    start(shape: DrawnShape): void {
      const kind: ProbeKind = shape.purpose === 'area' ? 'area' : 'profile'
      const previous = get(kind)?.shapeId
      const mine = ++runs[kind]
      last = kind
      set(kind, { kind, shapeId: shape.id, status: 'running' })
      if (previous && previous !== shape.id) removeShapes([previous])
      if (kind === 'profile') void profile(shape, mine)
      else void area(shape, mine)
    },
    /** Lets go of one kind's answer and its shape (or of both). */
    clear(kind?: ProbeKind): void {
      const kinds: ProbeKind[] = kind ? [kind] : ['profile', 'area']
      const ids: string[] = []
      for (const k of kinds) {
        runs[k]++
        const id = get(k)?.shapeId
        if (id) ids.push(id)
        set(k, null)
      }
      if (!kind || kind === 'profile') marker = null
      if (ids.length) removeShapes(ids)
      if (kind && last === kind) last = kind === 'profile' ? 'area' : 'profile'
    },
  }
}

export type ProbeState = ReturnType<typeof createProbeState>
