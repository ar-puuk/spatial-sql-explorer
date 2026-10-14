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
// One collator, made once: `localeCompare` with options builds a new one on every call (3.6 s to order the
// 77,000 distinct values of an id column), for the same order.
const CATEGORY_ORDER = new Intl.Collator('en', { numeric: true })
export const compareCategories = (a: string, b: string): number => CATEGORY_ORDER.compare(a, b)

// --- Graduated breaks (research §3). All take values sorted ascending, with
// no nulls, and return the k-1 inner breaks: the upper bound of every class
// but the last (classes are upper-inclusive, research §2). ----------------

export function equalIntervalBreaks(sorted: readonly number[], k: number): number[] {
  if (!sorted.length || k < 2) return []
  const min = sorted[0]
  const width = (sorted[sorted.length - 1] - min) / k
  return Array.from({ length: k - 1 }, (_, i) => min + width * (i + 1))
}

/** QGIS's quantile: linear interpolation between order statistics (a = q·(n-1)). */
export function quantileBreaks(sorted: readonly number[], k: number): number[] {
  const n = sorted.length
  if (!n || k < 2) return []
  return Array.from({ length: k - 1 }, (_, i) => {
    const a = ((i + 1) / k) * (n - 1)
    const lo = Math.floor(a)
    const r = a - lo
    return (1 - r) * sorted[lo] + r * sorted[Math.min(lo + 1, n - 1)]
  })
}

/** Natural breaks run exactly up to this many values; above it, on evenly spaced order statistics. */
export const JENKS_EXACT_LIMIT = 200_000

/**
 * Natural breaks (Jenks): the exact optimum, the grouping into k classes
 * with the smallest within-class sum of squares. A 1-D dynamic program with
 * divide-and-conquer optimization, O(k·n·log n), written from the published
 * algorithm (Fisher 1958 objective; Wang & Song 2011 optimization).
 * Above JENKS_EXACT_LIMIT values it runs on that many evenly spaced order
 * statistics, which preserve the distribution (`estimated` in the result).
 */
export function jenksBreaks(sorted: readonly number[], k: number): number[] {
  const values = sorted.length > JENKS_EXACT_LIMIT ? sampleSorted(sorted, JENKS_EXACT_LIMIT) : sorted
  const n = values.length
  if (!n || k < 2) return []
  if (n <= k) return values.slice(0, -1)
  const sum = new Float64Array(n + 1)
  const sumSq = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    sum[i + 1] = sum[i] + values[i]
    sumSq[i + 1] = sumSq[i] + values[i] * values[i]
  }
  /** Sum of squared deviations of values[i..j]. */
  const ssq = (i: number, j: number): number => {
    const s = sum[j + 1] - sum[i]
    return sumSq[j + 1] - sumSq[i] - (s * s) / (j - i + 1)
  }
  let prev = new Float64Array(n)
  for (let j = 0; j < n; j++) prev[j] = ssq(0, j)
  const starts: Int32Array[] = []
  for (let c = 1; c < k; c++) {
    const cur = new Float64Array(n).fill(Infinity)
    const start = new Int32Array(n)
    const solve = (lo: number, hi: number, optLo: number, optHi: number): void => {
      if (lo > hi) return
      const mid = (lo + hi) >> 1
      let best = Infinity
      let arg = Math.max(optLo, c)
      for (let s = Math.max(optLo, c); s <= Math.min(mid, optHi); s++) {
        const v = prev[s - 1] + ssq(s, mid)
        if (v < best) {
          best = v
          arg = s
        }
      }
      cur[mid] = best
      start[mid] = arg
      solve(lo, mid - 1, optLo, arg)
      solve(mid + 1, hi, arg, optHi)
    }
    solve(c, n - 1, c, n - 1)
    starts.push(start)
    prev = cur
  }
  const firsts: number[] = []
  let j = n - 1
  for (let c = k - 1; c >= 1; c--) {
    const s = starts[c - 1][j]
    firsts.unshift(s)
    j = s - 1
  }
  return firsts.map((s) => values[s - 1])
}

function sampleSorted(sorted: readonly number[], m: number): number[] {
  const n = sorted.length
  return Array.from({ length: m }, (_, i) => sorted[Math.round((i * (n - 1)) / (m - 1))])
}

/** The class of `value`: upper-inclusive, the first class also includes its lower bound; -1 if outside. */
export function classOf(value: number, ranges: ReadonlyArray<{ lower: number; upper: number }>): number {
  if (!ranges.length || value < ranges[0].lower) return -1
  for (let i = 0; i < ranges.length; i++) if (value <= ranges[i].upper) return i
  return -1
}
