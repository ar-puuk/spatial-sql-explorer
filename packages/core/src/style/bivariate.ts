// Spec 009 US4: bivariate maps (research §2, §3, §8). Two numeric columns,
// each classified like a graduated axis (up to 3 classes); a feature takes the
// color of its cell from a 3x3 palette (./bivariateData.ts, generated). Cells
// sit first in `ResolvedStyle.classes`, row-major from low/low (i + nx * j),
// so a feature's cell position IS its class index on the map.
import { BIVARIATE_PALETTES, type BivariatePalette } from './bivariateData.js'
import { DEFAULT_BIVARIATE_PALETTE, type LayerStyle, type ResolvedStyle } from './model.js'
import { rendererOf } from './legacy.js'
import { fromLab, toLab } from './ramps.js'

export { BIVARIATE_PALETTES, type BivariatePalette }

/** The palette with this id, or the default. */
export function bivariatePalette(id: string | undefined): BivariatePalette {
  return BIVARIATE_PALETTES.find((p) => p.id === id) ?? BIVARIATE_PALETTES.find((p) => p.id === DEFAULT_BIVARIATE_PALETTE) ?? BIVARIATE_PALETTES[0]
}

/** Where class k of n sits on the palette's 3-step axis (0 to 2): the ends for 2 classes, the middle for 1. */
const along = (k: number, n: number): number => (n > 1 ? (k * 2) / (n - 1) : 1)

/**
 * The color of cell (i, j) of an nx x ny grid. The palette is a 3 x 3 lattice of colors; a grid of another size reads
 * it at evenly spaced places, mixing the four colors around each in CIELAB. 3 classes land on the lattice itself,
 * 2 classes (or an axis with fewer distinct values, FR-015) on its low and high rows or columns, 1 class on its
 * middle one, and 4 classes between.
 */
export function bivariateColor(palette: BivariatePalette, i: number, j: number, nx: number, ny: number): string {
  const u = along(i, nx)
  const v = along(j, ny)
  const exact = (a: number) => Math.abs(a - Math.round(a)) < 1e-9
  if (exact(u) && exact(v)) return palette.cells[Math.round(u) + 3 * Math.round(v)]
  const u0 = Math.min(1, Math.floor(u + 1e-9))
  const v0 = Math.min(1, Math.floor(v + 1e-9))
  const fu = u - u0
  const fv = v - v0
  const lab = (a: number, b: number) => toLab(palette.cells[a + 3 * b])
  const corners = [lab(u0, v0), lab(u0 + 1, v0), lab(u0, v0 + 1), lab(u0 + 1, v0 + 1)]
  const weights = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv]
  return fromLab([0, 1, 2].map((c) => corners.reduce((sum, lab3, n) => sum + lab3[c] * weights[n], 0)))
}

/** `to-number` fallback for text: far outside any real value, caught with the non-finite guard. */
const NOT_A_NUMBER = -Number.MAX_VALUE

/** An axis class index per feature, graduated's rules (upper-inclusive; the first class includes its lower bound); -1 = no value or outside. */
function axisIndex(column: string, ranges: ReadonlyArray<{ lower: number; upper: number }>): unknown {
  const v = ['var', 'v']
  const n = ['var', 'n']
  const tests: unknown[] = []
  if (ranges.length) tests.push(['<', n, ranges[0].lower], -1)
  ranges.forEach((r, i) => tests.push(['<=', n, r.upper], i))
  const byRange = tests.length ? ['case', ...tests, -1] : -1
  return [
    'let',
    'v',
    ['get', column],
    [
      'case',
      ['==', v, null],
      -1,
      ['==', ['typeof', v], 'boolean'],
      -1,
      ['==', ['to-string', v], ''],
      -1,
      ['let', 'n', ['to-number', v, NOT_A_NUMBER], ['case', ['>=', ['abs', n], Number.MAX_VALUE], -1, byRange]],
    ],
  ]
}

/** The class position of each feature for a bivariate style: its cell (i + nx * j), or "No value". */
export function bivariateIndexExpression(style: LayerStyle, resolved: ResolvedStyle): unknown | null {
  const r = rendererOf(style)
  const g = resolved.grid
  if (r.kind !== 'bivariate' || !g || resolved.status !== 'ok') return null
  const nx = g.x.ranges.length
  const noValue = resolved.classes.findIndex((c) => c.kind === 'noValue')
  const bx = ['var', 'bx']
  const by = ['var', 'by']
  return ['let', 'bx', axisIndex(g.x.column, g.x.ranges), 'by', axisIndex(g.y.column, g.y.ranges), ['case', ['any', ['<', bx, 0], ['<', by, 0]], noValue, ['+', bx, ['*', nx, by]]]]
}
