// Spec 026 US2: asks the open raster for the band values under the cursor while it moves. One question at a time and
// the latest place wins, at most every 50 ms: a `point()` costs 4 to 10 ms (measured), but a slow remote file must
// never queue questions behind the mouse. Answers that arrive after the cursor left, or after another raster opened,
// are dropped.
import { insideExtent, readingFromPoint, type PixelReading } from '@spatial-explorer/core'
import type { RasterHandle } from './handle.js'

export interface PixelProbe {
  /** The cursor is at this place. */
  move(lon: number, lat: number): void
  /** The cursor left the map (or the raster went): the reading is cleared and any answer still coming is dropped. */
  leave(): void
}

export function createPixelProbe(getHandle: () => RasterHandle | null, publish: (reading: PixelReading | null) => void, intervalMs = 50): PixelProbe {
  let pending: { lon: number; lat: number } | null = null
  let inFlight = false
  let lastStart = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Bumped by `leave`: an answer to an older question is not published. */
  let epoch = 0

  function pump(): void {
    if (inFlight || !pending || timer) return
    const wait = lastStart + intervalMs - performance.now()
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null
        pump()
      }, wait)
      return
    }
    const handle = getHandle()
    const place = pending
    pending = null
    if (!handle) return
    inFlight = true
    lastStart = performance.now()
    const mine = epoch
    handle.reader
      .point(place.lon, place.lat)
      .then((answer) => {
        if (mine === epoch && handle === getHandle()) publish(readingFromPoint(handle.facts, place.lon, place.lat, answer))
      })
      .catch(() => {
        // A read that failed (the file moved, a network blip): show nothing rather than a stale value.
        if (mine === epoch) publish(null)
      })
      .finally(() => {
        inFlight = false
        pump()
      })
  }

  return {
    move(lon, lat) {
      const handle = getHandle()
      if (!handle) return
      if (!insideExtent(handle.facts.extentWgs84, lon, lat)) {
        // Off the raster: nothing to ask, and nothing to show.
        pending = null
        publish(null)
        return
      }
      pending = { lon, lat }
      pump()
    },
    leave() {
      epoch++
      pending = null
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      publish(null)
    },
  }
}
