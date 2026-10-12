// Spec 008 US8 (FR-033, constitution v1.1.0): place search with
// OpenStreetMap's Nominatim. Opt-out, disclosed before first use, and it
// sends ONLY the typed text: no view, no file, nothing about the data.
// A request goes out only on Enter or the button, at most one per second
// (Nominatim's usage policy).

export interface Place {
  name: string
  /** WGS84 [west, south, east, north]. */
  bbox: [number, number, number, number]
}

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
export const PLACE_ATTRIBUTION = 'Search © OpenStreetMap contributors (Nominatim)'
const MIN_INTERVAL_MS = 1000

/** The service could not be reached (offline, blocked). */
export class PlaceSearchUnavailable extends Error {}

let lastRequestAt = 0

/** The request URL for `text`: the text, the response format and a result limit, nothing else. */
export function placeSearchUrl(text: string): string {
  const u = new URL(NOMINATIM_URL)
  u.searchParams.set('q', text)
  u.searchParams.set('format', 'jsonv2')
  u.searchParams.set('limit', '5')
  return u.toString()
}

/** Up to 5 places for `text`. Waits out the 1-per-second limit. */
export async function searchPlaces(text: string, signal?: AbortSignal): Promise<Place[]> {
  const q = text.trim()
  if (!q) return []
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
  let res: Response
  try {
    // No credentials, no referrer beyond the origin: only the text leaves.
    res = await fetch(placeSearchUrl(q), { signal, credentials: 'omit', referrerPolicy: 'origin', headers: { Accept: 'application/json' } })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new PlaceSearchUnavailable("Can't reach the place search service. Check the connection.")
  }
  if (!res.ok) throw new PlaceSearchUnavailable(`The place search service answered ${res.status}. Try again later.`)
  const rows = (await res.json()) as Array<{ display_name?: string; boundingbox?: string[]; lat?: string; lon?: string }>
  return rows.flatMap((r) => {
    const b = (r.boundingbox ?? []).map(Number) // [south, north, west, east]
    if (!r.display_name || b.length !== 4 || b.some((n) => !Number.isFinite(n))) return []
    return [{ name: r.display_name, bbox: [b[2], b[0], b[3], b[1]] as Place['bbox'] }]
  })
}
