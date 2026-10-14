// Spec 011 US6: labels. The text comes from a column or a SQL expression the
// engine computes (LABEL_COLUMN), drawn with the system's sans-serif font (no
// glyph download: research §3), never overlapping.

export type LabelAnchor = 'above' | 'below' | 'left' | 'right' | 'center'

export type LabelPlacement =
  /** Points: where the text sits around the point, `offset` px away. */
  | { kind: 'point'; anchor: LabelAnchor; offset: number }
  /** Lines: along the line. */
  | { kind: 'line' }
  /** Polygons: inside, at the label point. */
  | { kind: 'polygon' }

export interface LabelSettings {
  enabled: boolean
  source: { kind: 'column'; column: string } | { kind: 'expression'; expression: string }
  /** px */
  size: number
  /** `#rrggbb` */
  color: string
  halo: { enabled: boolean; color: string; width: number }
  placement: LabelPlacement
}

export const LABEL_SIZE = Object.freeze({ min: 6, max: 48, default: 12 })
export const LABEL_HALO_WIDTH = Object.freeze({ min: 0.5, max: 5, default: 1.5 })
export const LABEL_OFFSET = Object.freeze({ min: 0, max: 20, default: 4 })
export const DEFAULT_LABEL_COLOR = '#1f2937'
export const DEFAULT_HALO_COLOR = '#ffffff'

const ANCHORS: readonly LabelAnchor[] = ['above', 'below', 'left', 'right', 'center']
const HEX6 = /^#[0-9a-f]{6}$/i

/** Stored label settings made valid, or undefined (none, or turned on with no text source). */
export function sanitizeLabels(raw: unknown): LabelSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const src = r.source as Record<string, unknown> | undefined
  let source: LabelSettings['source'] | null = null
  if (src?.kind === 'column' && typeof src.column === 'string' && src.column) source = { kind: 'column', column: src.column }
  else if (src?.kind === 'expression' && typeof src.expression === 'string' && src.expression.trim()) source = { kind: 'expression', expression: src.expression.trim() }
  if (!source) return undefined
  const num = (v: unknown, b: { min: number; max: number; default: number }) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : b.default)
  const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX6.test(v) ? v.toLowerCase() : fallback)
  const halo = (r.halo ?? {}) as Record<string, unknown>
  const p = (r.placement ?? {}) as Record<string, unknown>
  const placement: LabelPlacement =
    p.kind === 'line'
      ? { kind: 'line' }
      : p.kind === 'polygon'
        ? { kind: 'polygon' }
        : { kind: 'point', anchor: ANCHORS.includes(p.anchor as LabelAnchor) ? (p.anchor as LabelAnchor) : 'above', offset: num(p.offset, LABEL_OFFSET) }
  return {
    enabled: r.enabled === true,
    source,
    size: num(r.size, LABEL_SIZE),
    color: color(r.color, DEFAULT_LABEL_COLOR),
    halo: { enabled: halo.enabled !== false, color: color(halo.color, DEFAULT_HALO_COLOR), width: num(halo.width, LABEL_HALO_WIDTH) },
    placement,
  }
}

/** The column a label reads in formats without SQL (SLD, Mapbox GL): its column, or the first column its expression names. */
export function labelColumnOf(labels: LabelSettings): string | null {
  if (labels.source.kind === 'column') return labels.source.column
  const words = labels.source.expression.replace(/'(?:[^']|'')*'/g, ' ').match(/"(?:[^"]|"")+"|\b[A-Za-z_][A-Za-z0-9_]*\b(?!\s*\()/g) ?? []
  const keyword = /^(and|or|not|is|null|true|false|case|when|then|else|end|as|in|like|ilike|between|cast|try_cast|varchar|integer|double)$/i
  const found = words.find((w) => !keyword.test(w))
  return found ? found.replace(/^"|"$/g, '').replace(/""/g, '"') : null
}
