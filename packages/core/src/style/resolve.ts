// From a style + the displayed result to what the map, legend and panel
// draw (spec 003 data-model.md ResolvedStyle). Pure; recomputed whenever the
// style or the result changes. Classes cover every row of the displayed
// result and nothing else (FR-005).
import type { Layer } from '../models.js'
import { rendererOf, type LayerStyle, type ResolvedStyle } from './model.js'

export type ResolveInput = Pick<Layer, 'features' | 'columns'>

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL(\(.*\))?|NUMERIC(\(.*\))?|INT[1248]?|FLOAT[48])$/i

/** True for DuckDB numeric types (research §5). */
export function isNumericType(type: string): boolean {
  return NUMERIC.test(type.trim())
}

/** Columns a renderer can use: every attribute for categorized, numeric ones for graduated. */
export function eligibleColumns(columns: ResolveInput['columns'] | undefined, kind: 'categorized' | 'graduated'): Array<{ name: string; type: string }> {
  return (columns ?? []).filter((c) => kind === 'categorized' || isNumericType(c.type))
}

/** The single symbol as one legend class. */
function single(style: LayerStyle, layer: ResolveInput | null, extra: Partial<ResolvedStyle> = {}): ResolvedStyle {
  return {
    status: 'ok',
    caption: '',
    notes: [],
    ...extra,
    classes: [{ key: 'single', kind: 'single', label: 'All features', color: style.fillColor, visible: true, count: layer?.features.length ?? 0 }],
  }
}

/** Shared by the renderer branches: the fallback when the styled column can't be used (FR-012). */
export function fallback(style: LayerStyle, layer: ResolveInput | null, reason: string): ResolvedStyle {
  return single(style, layer, { status: 'fallback', reason })
}

export function resolveStyle(style: LayerStyle, layer: ResolveInput | null): ResolvedStyle {
  const r = rendererOf(style)
  switch (r.kind) {
    case 'single':
      return single(style, layer)
    default:
      return single(style, layer) // categorized (US1) and graduated (US2) branches
  }
}
