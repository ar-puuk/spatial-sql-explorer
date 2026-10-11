// Classification rules (spec 003 research §2-§4). The same value rules are
// mirrored in ./expressions.ts, so the map and the legend agree per feature.

/**
 * A value's category: its `String()` form, which is also what MapLibre's
 * `to-string` produces (verified in research §4). Null, undefined and the
 * empty string have no category (the "No value" class).
 */
export function toCategory(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s === '' ? null : s
}

/**
 * A value as a number, or null ("No value"). Finite numbers pass;
 * non-empty numeric strings convert (DECIMAL arrives as text, e.g. "12.50");
 * everything else, booleans included, has no value. Never 0 for null or "",
 * which is MapLibre's `to-number` default and how nulls end up in the first
 * class elsewhere (research §4).
 */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Ties alphabetical, with numbers in numeric order ("2" < "10"). */
export const compareCategories = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })
