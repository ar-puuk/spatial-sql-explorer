// Spec 008 US6 (FR-025–FR-027): polygon extrusion, a style option. Height
// is a numeric column times a scale, or a constant, in meters; missing, zero
// or negative heights are drawn flat (and counted). Shared by the map
// (MapLibre `fill-extrusion`), QGIS QML (`<renderer-3d>`, research §5) and
// Mapbox GL style JSON. SLD has no 3D: it is left out with a notice.
import { quoteIdent } from '../query/util.js'
import type { GeometryType } from '../models.js'
import type { LayerStyle } from './model.js'

export interface Extrusion {
  enabled: boolean
  source: { kind: 'column'; column: string } | { kind: 'constant'; meters: number }
  /** Multiplies the height; > 0. Default 1. */
  scale: number
}

export const DEFAULT_EXTRUSION_SCALE = 1
/** Pitch the map eases to when extrusion turns on over a flat map (research §4). */
export const EXTRUSION_PITCH = 50

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** A stored or imported extrusion made valid, or undefined (none). */
export function sanitizeExtrusion(e: Partial<Extrusion> | undefined): Extrusion | undefined {
  if (!e || typeof e !== 'object') return undefined
  const src = e.source as Partial<Extrusion['source']> | undefined
  let source: Extrusion['source']
  if (src?.kind === 'column' && typeof (src as { column?: unknown }).column === 'string') source = { kind: 'column', column: (src as { column: string }).column }
  else if (src?.kind === 'constant' && finite((src as { meters?: unknown }).meters)) source = { kind: 'constant', meters: Math.max(0, (src as { meters: number }).meters) }
  else return undefined
  const scale = finite(e.scale) && e.scale > 0 ? e.scale : DEFAULT_EXTRUSION_SCALE
  return { enabled: e.enabled === true, source, scale }
}

/** The extrusion the map draws: on, polygons only, and a column chosen (or a constant). */
export function activeExtrusion(style: Pick<LayerStyle, 'extrusion'>, geometryType: GeometryType | null | undefined): Extrusion | null {
  const e = style.extrusion
  if (!e?.enabled) return null
  if (geometryType !== 'Polygon' && geometryType !== 'Mixed') return null
  if (e.source.kind === 'column' && !e.source.column) return null
  return e
}

/** Why the 3D section is unavailable for this layer, or null. */
export function extrusionUnavailableReason(geometryType: GeometryType | null | undefined): string | null {
  return geometryType === 'Polygon' || geometryType === 'Mixed' ? null : '3D extrusion applies to polygons.'
}

/** MapLibre `fill-extrusion-height`: `max(0, coalesce(col, 0) * scale)`, or the constant. */
export function extrusionHeightExpression(e: Extrusion): unknown {
  if (e.source.kind === 'constant') return Math.max(0, e.source.meters * e.scale)
  const value = ['to-number', ['coalesce', ['get', e.source.column], 0], 0]
  return ['max', 0, e.scale === 1 ? value : ['*', value, e.scale]]
}

/** The column the extrusion reads (map views must carry it), or null. */
export function extrusionColumn(style: Pick<LayerStyle, 'extrusion'>): string | null {
  const e = style.extrusion
  return e?.enabled && e.source.kind === 'column' && e.source.column ? e.source.column : null
}

/** SQL counting the rows drawn flat (missing, zero or negative height) in `relation`. */
export function flatCountSql(relation: string, e: Extrusion): string | null {
  if (e.source.kind === 'constant') return null
  const c = quoteIdent(e.source.column)
  return `SELECT count(*)::BIGINT AS n FROM ${relation} WHERE coalesce(TRY_CAST(${c} AS DOUBLE), 0) * ${e.scale} <= 0`
}

/** A QGIS height expression: `"col" * k`, `"col"`, or a constant (research §5). */
export function extrusionToQgis(e: Extrusion): { constant: number; expression: string | null } {
  if (e.source.kind === 'constant') return { constant: e.source.meters * e.scale, expression: null }
  const col = `"${e.source.column.replace(/"/g, '""')}"`
  return { constant: 0, expression: e.scale === 1 ? col : `${col} * ${e.scale}` }
}

/** Reads the forms extrusionToQgis writes; anything else is null (imported as off, with a notice). */
export function extrusionFromQgis(expression: string | null, constant: number): Pick<Extrusion, 'source' | 'scale'> | null {
  if (expression === null || !expression.trim()) return finite(constant) && constant > 0 ? { source: { kind: 'constant', meters: constant }, scale: 1 } : null
  const m = /^\s*"((?:[^"]|"")+)"\s*(?:\*\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?))?\s*$/i.exec(expression)
  if (!m) return null
  const scale = m[2] !== undefined ? Number(m[2]) : 1
  if (!(scale > 0)) return null
  return { source: { kind: 'column', column: m[1].replace(/""/g, '"') }, scale }
}

/** Reads a Mapbox `fill-extrusion-height` we write (or a plain `["get", col]`, a number). */
export function extrusionFromMapbox(height: unknown): Pick<Extrusion, 'source' | 'scale'> | null {
  if (finite(height)) return height > 0 ? { source: { kind: 'constant', meters: height }, scale: 1 } : null
  const unwrap = (x: unknown): unknown => {
    if (!Array.isArray(x)) return x
    if (x[0] === 'max' && x[1] === 0) return unwrap(x[2])
    if (x[0] === 'to-number' || x[0] === 'number') return unwrap(x[1])
    if (x[0] === 'coalesce') return unwrap(x[1])
    return x
  }
  const h = unwrap(height)
  if (Array.isArray(h) && h[0] === 'get' && typeof h[1] === 'string') return { source: { kind: 'column', column: h[1] }, scale: 1 }
  if (Array.isArray(h) && h[0] === '*') {
    const [a, b] = [unwrap(h[1]), unwrap(h[2])]
    const get = Array.isArray(a) && a[0] === 'get' ? a : Array.isArray(b) && b[0] === 'get' ? b : null
    const k = finite(b) ? b : finite(a) ? a : null
    if (get && typeof get[1] === 'string' && k !== null && k > 0) return { source: { kind: 'column', column: get[1] }, scale: k }
  }
  return null
}
