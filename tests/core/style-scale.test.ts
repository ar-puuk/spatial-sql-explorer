// @vitest-environment happy-dom
// Spec 009 SC-003 at its stated size: on a 10,000-feature layer, every
// feature's color and size from the map's expressions (MapLibre's own
// evaluator) match the legend classes it is counted in. Zero mismatches, for
// both channels (classed and proportional) and for every bivariate cell.
import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  classOf,
  paintFor,
  proportionalSize,
  resolveStyle,
  setBivariateAxis,
  setSizeChannel,
  setSizeMode,
  startStyle,
  toNumber,
  type LayerStyle,
  type ResolvedStyle,
} from '@spatial-explorer/core'

const N = 10_000
/** Deterministic pseudo-random values (a small LCG), with nulls sprinkled in. */
function rows() {
  let seed = 12345
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  return Array.from({ length: N }, (_, i) => ({
    cls: ['A', 'B', 'C', 'D', 'E'][Math.floor(rand() * 5)],
    aadt: i % 97 === 3 ? null : Math.round(Math.exp(rand() * 10)),
    a: i % 89 === 5 ? null : Math.round(rand() * 1000) / 10,
    b: i % 83 === 7 ? null : Math.round((rand() * 50 + 20) * 10) / 10,
  }))
}
const data = rows()
const layer = {
  features: data.map((attributes, id) => ({ id, geometry: null, attributes })),
  columns: [
    { name: 'cls', type: 'VARCHAR' },
    { name: 'aadt', type: 'BIGINT' },
    { name: 'a', type: 'DOUBLE' },
    { name: 'b', type: 'DOUBLE' },
  ],
}

function compile(expr: unknown, key: string) {
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value
}
const at = (e: ReturnType<typeof compile>, properties: Record<string, unknown>, type: string) => e.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)

/** The legend class a value is counted in (classOf's rules); -1 = No value. */
const classIn = (r: ResolvedStyle['classes'], v: unknown): number => {
  const n = toNumber(v as never)
  if (n === null) return -1
  return classOf(n, r.filter((c) => c.kind === 'range' || c.kind === 'cell') as Array<{ lower: number; upper: number }>)
}

describe('SC-003 on 10,000 features', () => {
  const base = DEFAULT_LAYER_STYLE as LayerStyle
  const categorized = startStyle(base, 'categorized', layer, 'cls')

  for (const mode of ['classed', 'proportional'] as const) {
    it(`color by class and ${mode} width: zero mismatches`, () => {
      const style = setSizeMode(setSizeChannel(categorized, 'aadt', 'line'), mode)
      const r = resolveStyle(style, layer)
      const p = paintFor(style, r, '#000')
      const color = compile(p.line['line-color'], 'layers[0].paint.line-color')
      const width = compile(p.line['line-width'], 'layers[0].paint.line-width')
      const sizeClasses = r.size?.classes ?? []
      let mismatches = 0
      for (const f of data) {
        const wantColor = r.classes.find((c) => c.value === f.cls)?.color
        const k = mode === 'classed' ? classIn(sizeClasses, f.aadt) : -2
        const wantWidth =
          f.aadt === null
            ? style.strokeWidth
            : mode === 'classed'
              ? sizeClasses[k]?.size
              : proportionalSize(f.aadt, r.size?.domain as { min: number; max: number }, 1, 6, 'linear')
        const got = at(width, f, 'LineString') as number
        if (at(color, f, 'LineString') !== wantColor || Math.abs(got - (wantWidth as number)) > 1e-9) mismatches++
      }
      expect(mismatches).toBe(0)
      // Counts add up (SC-004's rule, here for the size channel).
      expect(sizeClasses.reduce((n, c) => n + c.count, 0)).toBe(mode === 'classed' ? N : data.filter((f) => f.aadt === null).length)
    })
  }

  it('bivariate: every feature takes its cell color; cells and No value add up to 10,000', () => {
    const style = setBivariateAxis(setBivariateAxis(startStyle(base, 'bivariate', layer), 'x', { column: 'a' }), 'y', { column: 'b' })
    const r = resolveStyle(style, layer)
    const fill = compile(paintFor(style, r, '#000').fill['fill-color'], 'layers[0].paint.fill-color')
    const g = r.grid as NonNullable<ResolvedStyle['grid']>
    const noValue = r.classes.find((c) => c.kind === 'noValue')
    let mismatches = 0
    for (const f of data) {
      const i = f.a === null ? -1 : classOf(f.a, g.x.ranges)
      const j = f.b === null ? -1 : classOf(f.b, g.y.ranges)
      const want = i < 0 || j < 0 ? noValue?.color : r.classes.find((c) => c.key === `cell:${i}-${j}`)?.color
      if (at(fill, f, 'Polygon') !== want) mismatches++
    }
    expect(mismatches).toBe(0)
    expect(r.classes.reduce((n, c) => n + c.count, 0)).toBe(N)
  })
})
