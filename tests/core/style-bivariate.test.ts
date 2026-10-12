// @vitest-environment happy-dom
// Spec 009 US4 (contracts/style-core.md): bivariate maps. Cells are the two
// axes' graduated classes; map = legend for every cell through MapLibre's own
// evaluator (SC-003); cell counts add up to the rows (SC-004); palettes meet
// research §8's thresholds.
import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  BIVARIATE_PALETTES,
  DEFAULT_BIVARIATE_PALETTE,
  DEFAULT_LAYER_STYLE,
  bivariateColor,
  classOf,
  paintFor,
  resolveStyle,
  rendererOf,
  setBivariateAxis,
  setBivariatePalette,
  setCellVisible,
  setSizeChannel,
  startStyle,
  swapBivariateAxes,
  validateStyle,
  visibilityFilter,
  type LayerStyle,
  type ResolvedStyle,
} from '@spatial-explorer/core'

function evaluate(expr: unknown, properties: Record<string, unknown>, key: string, type = 'Polygon'): unknown {
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)
}

/** 90 counties: two correlated rates (a few nulls in each) and a name. */
const counties = {
  features: Array.from({ length: 90 }, (_, i) => ({
    id: i,
    geometry: null,
    attributes: { name: `C${i}`, poverty: i % 31 === 7 ? null : ((i * 37) % 89) / 3, obesity: i % 29 === 5 ? null : 20 + ((i * 53) % 97) / 5, flag: i % 2 },
  })),
  columns: [
    { name: 'name', type: 'VARCHAR' },
    { name: 'poverty', type: 'DOUBLE' },
    { name: 'obesity', type: 'DOUBLE' },
    { name: 'flag', type: 'INTEGER' },
  ],
}

const base = DEFAULT_LAYER_STYLE as LayerStyle
const bivariate = (): LayerStyle => setBivariateAxis(setBivariateAxis(startStyle(base, 'bivariate', counties), 'x', { column: 'poverty' }), 'y', { column: 'obesity' })

/** The cell a feature falls in, from the resolved axes (classOf's rules); null = No value. */
function cellOf(r: ResolvedStyle, p: { poverty: number | null; obesity: number | null }): { i: number; j: number } | null {
  if (p.poverty === null || p.obesity === null || !r.grid) return null
  const i = classOf(p.poverty, r.grid.x.ranges)
  const j = classOf(p.obesity, r.grid.y.ranges)
  return i < 0 || j < 0 ? null : { i, j }
}

describe('bivariate classes (US4)', () => {
  it('starts on two numeric columns, the default palette, quantile on both axes', () => {
    const r = rendererOf(startStyle(base, 'bivariate', counties))
    expect(r.kind === 'bivariate' && [r.x.column, r.y.column, r.x.method, r.y.method, r.palette]).toEqual(['poverty', 'obesity', 'quantile', 'quantile', DEFAULT_BIVARIATE_PALETTE])
  })

  it('9 cells in row-major order from low/low, with both ranges, then No value; counts add up (SC-004)', () => {
    const style = bivariate()
    const r = resolveStyle(style, counties)
    expect(r.status).toBe('ok')
    expect(r.caption).toBe('poverty × obesity · Quantile')
    const cells = r.classes.filter((c) => c.kind === 'cell')
    expect(cells).toHaveLength(9)
    cells.forEach((c, k) => {
      expect([c.col, c.row]).toEqual([k % 3, Math.floor(k / 3)])
      expect(c.key).toBe(`cell:${k % 3}-${Math.floor(k / 3)}`)
      expect(c.x).toEqual({ lower: r.grid?.x.ranges[k % 3].lower, upper: r.grid?.x.ranges[k % 3].upper })
    })
    const nulls = counties.features.filter((f) => f.attributes.poverty === null || f.attributes.obesity === null).length
    expect(r.classes.at(-1)).toMatchObject({ kind: 'noValue', count: nulls })
    expect(r.classes.reduce((n, c) => n + c.count, 0)).toBe(counties.features.length)
  })

  it('the map colors every feature with its cell (SC-003); No value is neutral', () => {
    const style = bivariate()
    const r = resolveStyle(style, counties)
    const p = paintFor(style, r, '#f59e0b')
    const palette = BIVARIATE_PALETTES.find((x) => x.id === DEFAULT_BIVARIATE_PALETTE)
    for (const f of counties.features) {
      const cell = cellOf(r, f.attributes)
      const want = cell ? bivariateColor(palette!, cell.i, cell.j, 3, 3) : r.classes.at(-1)?.color
      expect(evaluate(p.fill['fill-color'], f.attributes, 'layers[0].paint.fill-color'), JSON.stringify(f.attributes)).toBe(want)
    }
  })

  it('hidden cells and No value are filtered off the map', () => {
    let style = setCellVisible(bivariate(), 'cell:2-2', false)
    style = setCellVisible(style, '__null', false)
    const r = resolveStyle(style, counties)
    const filter = visibilityFilter(style, r)
    for (const f of counties.features) {
      const cell = cellOf(r, f.attributes)
      const want = cell !== null && !(cell.i === 2 && cell.j === 2)
      expect(evaluate(filter, f.attributes, 'layers[0].filter'), JSON.stringify(f.attributes)).toBe(want)
    }
    expect(r.classes.find((c) => c.key === 'cell:2-2')?.visible).toBe(false)
  })

  it('swapping the axes transposes the cells and the hidden ones', () => {
    const style = setCellVisible(bivariate(), 'cell:2-0', false)
    const swapped = swapBivariateAxes(style)
    const s = rendererOf(swapped)
    expect(s.kind === 'bivariate' && [s.x.column, s.y.column, s.hidden]).toEqual(['obesity', 'poverty', ['0-2']])
    const a = resolveStyle(style, counties)
    const b = resolveStyle(swapped, counties)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(b.classes.find((c) => c.key === `cell:${j}-${i}`)?.count).toBe(a.classes.find((c) => c.key === `cell:${i}-${j}`)?.count)
  })

  it("changing one axis's method leaves the other axis alone", () => {
    const style = bivariate()
    const before = resolveStyle(style, counties).grid
    const after = resolveStyle(setBivariateAxis(style, 'x', { method: 'equal' }), counties).grid
    expect(after?.y).toEqual(before?.y)
    expect(after?.x.ranges).not.toEqual(before?.x.ranges)
  })

  it('an axis with 2 distinct values gives a 2 x 3 grid, with a note (FR-015)', () => {
    const style = setBivariateAxis(bivariate(), 'x', { column: 'flag' })
    const r = resolveStyle(style, counties)
    expect(r.grid?.x.ranges).toHaveLength(2)
    expect(r.classes.filter((c) => c.kind === 'cell')).toHaveLength(6)
    expect(r.notes.join()).toMatch(/2 distinct values/)
    // Smaller grids use the palette's corner and middle columns.
    const palette = BIVARIATE_PALETTES[0]
    expect(bivariateColor(palette, 1, 0, 2, 3)).toBe(palette.cells[2])
  })

  it('the same column twice, or a text column, is refused', () => {
    expect(validateStyle(setBivariateAxis(bivariate(), 'y', { column: 'poverty' }))).toContain('Choose two different numeric columns.')
    expect(resolveStyle(setBivariateAxis(bivariate(), 'x', { column: 'name' }), counties).status).toBe('fallback')
  })

  it('a palette change recolors the cells; bivariate maps have no size channel (FR-007)', () => {
    const style = setBivariatePalette(setSizeChannel(bivariate(), 'flag', 'point'), 'green-purple')
    const r = resolveStyle(style, counties)
    const green = BIVARIATE_PALETTES.find((x) => x.id === 'green-purple')!
    expect(r.classes.find((c) => c.key === 'cell:2-2')?.color).toBe(green.cells[8])
    expect(r.size).toBeUndefined()
    // The size channel is kept, inactive: back to graduated, it applies again.
    expect(style.size?.column).toBe('flag')
  })

  it('points and lines color the same way', () => {
    const style = bivariate()
    const r = resolveStyle(style, counties)
    const p = paintFor(style, r, '#f59e0b')
    const f = counties.features[12].attributes
    const fill = evaluate(p.fill['fill-color'], f, 'layers[0].paint.fill-color')
    expect(evaluate(p.circle['circle-color'], f, 'layers[0].paint.circle-color', 'Point')).toBe(fill)
    expect(evaluate(p.line['line-color'], f, 'layers[0].paint.line-color', 'LineString')).toBe(fill)
  })
})

// --- T033: the generated palettes (research §8) ---------------------------------
const W = [0.95047, 1, 1.08883]
const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055)
const fl = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
function lab(c: number[]): number[] {
  const [r, g, b] = c.map(lin)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / W[0]
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / W[2]
  return [116 * fl(y) - 16, 500 * (fl(x) - fl(y)), 200 * (fl(y) - fl(z))]
}
const DEU = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
]
const deu = (c: number[]) => {
  const l = c.map(lin)
  return DEU.map((row) => unlin(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))))
}
const minDE = (cells: string[], view = (c: number[]) => c) => {
  let m = Infinity
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = lab(view(rgb(cells[i])))
      const b = lab(view(rgb(cells[j])))
      m = Math.min(m, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
    }
  return m
}

describe('bivariate palettes (research §8)', () => {
  it('at least 4, the default first, each 9 distinct, readable cells', () => {
    expect(BIVARIATE_PALETTES.length).toBeGreaterThanOrEqual(4)
    expect(BIVARIATE_PALETTES[0].id).toBe(DEFAULT_BIVARIATE_PALETTE)
    for (const p of BIVARIATE_PALETTES) {
      expect(p.cells, p.id).toHaveLength(9)
      expect(minDE([...p.cells]), p.id).toBeGreaterThanOrEqual(15)
      if (!p.note) expect(minDE([...p.cells], deu), p.id).toBeGreaterThanOrEqual(12)
      // Darker from low/low to high/high.
      expect(lab(rgb(p.cells[0]))[0], p.id).toBeGreaterThan(lab(rgb(p.cells[4]))[0])
      expect(lab(rgb(p.cells[4]))[0], p.id).toBeGreaterThan(lab(rgb(p.cells[8]))[0])
    }
  })
})
