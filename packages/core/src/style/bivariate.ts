// Spec 009 US4: bivariate maps (research §2, §3, §8). Two numeric columns,
// each classified like a graduated axis (up to 3 classes); a feature takes the
// color of its cell from a 3x3 palette (./bivariateData.ts, generated). Cells
// sit first in `ResolvedStyle.classes`, row-major from low/low (i + nx * j),
// so a feature's cell position IS its class index on the map.
import { BIVARIATE_PALETTES, type BivariatePalette } from './bivariateData.js'
import { DEFAULT_BIVARIATE_PALETTE, rendererOf, type LayerStyle, type ResolvedStyle } from './model.js'

export { BIVARIATE_PALETTES, type BivariatePalette }

/** The palette with this id, or the default. */
export function bivariatePalette(id: string | undefined): BivariatePalette {
  return BIVARIATE_PALETTES.find((p) => p.id === id) ?? BIVARIATE_PALETTES.find((p) => p.id === DEFAULT_BIVARIATE_PALETTE) ?? BIVARIATE_PALETTES[0]
}

/**
 * The color of cell (i, j) of an nx x ny grid. Smaller grids (an axis with
 * fewer distinct values, FR-015) use the palette's low and high columns or
 * rows (2 classes), or its middle one (1 class).
 */
export function bivariateColor(palette: BivariatePalette, i: number, j: number, nx: number, ny: number): string {
  const at = (k: number, n: number) => (n >= 3 ? k : n === 2 ? (k === 0 ? 0 : 2) : 1)
  return palette.cells[at(i, nx) + 3 * at(j, ny)]
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
