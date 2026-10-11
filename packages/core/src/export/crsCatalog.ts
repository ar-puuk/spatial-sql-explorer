// Spec 008 (user request): the CRS list for the export picker. The engine
// can't list its CRSs, so the list is data (epsgCatalog.json): every current
// EPSG geographic 2D and projected CRS, filtered to the codes the engine's
// PROJ accepts (scripts/crs-catalog.py, tests/web/specs/crs-catalog.tool.spec.ts).
// Grouped as QGIS (by projection method) and ArcGIS (UTM, State Plane,
// World) group them. The chosen code is still checked by the engine before
// export (QuerySession.describeCrs).
import type { Bbox } from '../models.js'

export interface CrsEntry {
  code: number
  name: string
  kind: 'geographic' | 'projected'
  /** Area of use, as EPSG names it. */
  area: string
  /** Area of use, WGS84 [west, south, east, north]; west > east crosses the antimeridian. */
  bbox: Bbox
  /** The picker's group: "Geographic", "Universal Transverse Mercator (UTM)", "US State Plane", "Lambert Conformal Conic"… */
  group: string
}

export interface CrsCatalog {
  /** Group names in display order (Geographic first, "Other projections" last). */
  groups: string[]
  entries: CrsEntry[]
}

type Row = [number, string, 'g' | 'p', string, number, number, number, number, number]

/** Pinned on top of the list, in this order (after the result's own CRS). */
export const PINNED_CRS = [4326, 3857] as const

/** Common names EPSG doesn't use, for search. */
const ALIASES: Record<number, string> = {
  3857: 'web mercator google osm',
  4326: 'lat lon latitude longitude gps',
  4269: 'lat lon latitude longitude',
}

let loaded: Promise<CrsCatalog> | null = null

/** The catalog, loaded on first use (about 560 KB, a separate chunk). */
export function loadCrsCatalog(): Promise<CrsCatalog> {
  loaded ??= import('./epsgCatalog.json').then((m) => fromData((m as unknown as { default: { groups: string[]; crs: Row[] } }).default))
  return loaded
}

export function fromData(data: { groups: string[]; crs: Row[] }): CrsCatalog {
  return {
    groups: data.groups,
    entries: data.crs.map(([code, name, k, area, w, s, e, n, g]) => ({
      code,
      name,
      kind: k === 'g' ? 'geographic' : 'projected',
      area,
      bbox: [w, s, e, n],
      group: data.groups[g] ?? 'Other projections',
    })),
  }
}

const fold = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Entries matching `query`, best first: the exact code, codes starting with
 * it, then names (and areas) containing every word. "EPSG:269" is a code
 * prefix; "utm 12n nad83" matches "NAD83 / UTM zone 12N"; "utah" matches
 * the Utah zones by name or area.
 */
export function searchCrs(entries: readonly CrsEntry[], query: string, limit = 200): CrsEntry[] {
  const q = fold(query.trim()).replace(/^epsg\s*:?\s*/, '')
  if (!q) return entries.slice(0, limit)
  if (/^\d+$/.test(q)) {
    const exact = entries.filter((e) => String(e.code) === q)
    const prefix = entries.filter((e) => String(e.code).startsWith(q) && String(e.code) !== q)
    return [...exact, ...prefix].slice(0, limit)
  }
  const words = q.split(/[\s/,()]+/).filter(Boolean)
  const scored: Array<{ e: CrsEntry; score: number }> = []
  for (const e of entries) {
    const plain = fold(e.name)
    const name = `${plain} ${ALIASES[e.code] ?? ''}`
    const hay = `${name} ${fold(e.area)} ${fold(e.group)} ${e.code}`
    if (!words.every((w) => hay.includes(w))) continue
    // Name matches beat area-only matches; names starting with the query first; then the usual choices; shorter names first.
    const inName = words.filter((w) => name.includes(w)).length
    const score = (words.length - inName) * 10000 + (name.startsWith(words[0]) ? 0 : 1000) + penalty(e) * 100 + Math.min(plain.length, 99)
    scored.push({ e, score })
  }
  scored.sort((a, b) => a.score - b.score || a.e.code - b.e.code)
  return scored.slice(0, limit).map((s) => s.e)
}

/**
 * How unusual a choice is (0: the usual one): feet units, historic datums
 * and datum realizations come after the plain metre CRS of today's datum.
 */
export function penalty(e: CrsEntry): number {
  let p = 0
  if (/\(ft|\bfeet\b|\(ftUS\)|\(ftIn\)|\(link\)|\(chain\)/i.test(e.name)) p += 2
  if (/\b(NAD27|WGS 72\w*|Pulkovo 1942|NTF|ED50|ED79|ED87|Tokyo|Old Hawaiian)\b|\((Paris|Ferro|Rome|Greenwich|Bern|Oslo)\)/.test(e.name)) p += 3
  if (/\((HARN|NSRS2007|CORS96|CSRS|MA11|PA11|FBN|HPGN|\d{4}[^)]*)\)/.test(e.name)) p += 1
  return p
}

const contains = (outer: Bbox, inner: Bbox): boolean => {
  const [w, s, e, n] = outer
  if (inner[1] < s || inner[3] > n) return false
  if (w <= e) return inner[0] >= w && inner[2] <= e
  // Crosses the antimeridian.
  return (inner[0] >= w || inner[0] <= e) && (inner[2] >= w || inner[2] <= e)
}
const areaOf = ([w, s, e, n]: Bbox): number => (w <= e ? e - w : 360 - w + e) * (n - s) || Infinity

/**
 * Projected CRSs whose area of use holds the whole data extent (WGS84): the
 * likely choices for this data (its state plane zone, UTM zone, national
 * grid). The usual ones first (metres, today's datum), then the most local.
 */
export function suggestCrs(entries: readonly CrsEntry[], extent: Bbox | null, limit = 5): CrsEntry[] {
  if (!extent || extent.some((v) => !Number.isFinite(v))) return []
  return entries
    .filter((e) => e.kind === 'projected' && e.group !== 'World' && contains(e.bbox, extent))
    .map((e) => ({ e, p: penalty(e), a: areaOf(e.bbox) }))
    .sort((x, y) => x.p - y.p || x.a - y.a || x.e.code - y.e.code)
    .slice(0, limit)
    .map((x) => x.e)
}
