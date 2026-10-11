// T014/T022 (spec 003, research §3-§4): classification over the displayed
// result. Categorized: frequency order, cap + "Other", "No value".
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_LAYER_STYLE,
  OTHER_COLOR,
  NO_VALUE_COLOR,
  classOf,
  equalIntervalBreaks,
  jenksBreaks,
  quantileBreaks,
  rampColors,
  resolveStyle,
  toCategory,
  toNumber,
  type Feature,
  type GraduatedMethod,
  type LayerStyle,
} from '@spatial-explorer/core'

const fixtureJson = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/style/${name}`, import.meta.url), 'utf8')) as T

const feature = (id: number, attributes: Feature['attributes']): Feature => ({ id, geometry: null, attributes })
const layerOf = (values: unknown[], column = 'zone', type = 'VARCHAR') => ({
  features: values.map((v, i) => feature(i, { [column]: v as Feature['attributes'][string] })),
  columns: [{ name: column, type }],
})
const categorized = (patch: object = {}): LayerStyle => ({
  ...DEFAULT_LAYER_STYLE,
  renderer: { kind: 'categorized', column: 'zone', ramp: { id: 'brewer-set2', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {}, ...patch },
})

describe('toCategory', () => {
  it('maps null and empty to no value, everything else through String()', () => {
    expect(toCategory(null)).toBeNull()
    expect(toCategory(undefined)).toBeNull()
    expect(toCategory('')).toBeNull()
    expect(toCategory('R1')).toBe('R1')
    expect(toCategory(1.5)).toBe('1.5')
    expect(toCategory(0)).toBe('0')
    expect(toCategory(true)).toBe('true')
  })
})

describe('categorized', () => {
  it('orders classes most frequent first, ties alphabetical, with counts and ramp colors', () => {
    const r = resolveStyle(categorized(), layerOf(['b', 'a', 'c', 'a', 'b', 'a', 'd']))
    expect(r.status).toBe('ok')
    expect(r.classes.map((c) => [c.label, c.count])).toEqual([
      ['a', 3],
      ['b', 2],
      ['c', 1],
      ['d', 1],
    ])
    expect(r.classes.map((c) => c.color)).toEqual(rampColors({ id: 'brewer-set2', reversed: false }, 4))
    expect(r.caption).toBe('zone · 4 categories')
  })

  it('numbers sort numerically among ties', () => {
    const r = resolveStyle(categorized(), layerOf([10, 9, 100, 2]))
    expect(r.classes.map((c) => c.value)).toEqual(['2', '9', '10', '100'])
  })

  it('above the cap, the most frequent values get classes and the rest go to Other', () => {
    const values = [...'aaaabbbcc'.split(''), 'd', 'e', 'f']
    const r = resolveStyle(categorized({ cap: 3 }), layerOf(values))
    expect(r.classes.map((c) => c.key)).toEqual(['v:a', 'v:b', 'v:c', '__other'])
    const other = r.classes[3]
    expect(other).toMatchObject({ kind: 'other', label: 'Other (3 values)', count: 3, groups: 3, color: OTHER_COLOR })
  })

  it('nulls and empty strings go to No value, last', () => {
    const r = resolveStyle(categorized(), layerOf(['a', null, '', 'a']))
    expect(r.classes.map((c) => [c.key, c.count])).toEqual([
      ['v:a', 2],
      ['__null', 2],
    ])
    expect(r.classes[1]).toMatchObject({ kind: 'noValue', label: 'No value', color: NO_VALUE_COLOR })
  })

  it('counts add up to every row of the result', () => {
    const values = Array.from({ length: 997 }, (_, i) => (i % 7 === 0 ? null : `owner ${i % 40}`))
    const r = resolveStyle(categorized(), layerOf(values))
    expect(r.classes.reduce((n, c) => n + c.count, 0)).toBe(997)
    expect(r.classes.filter((c) => c.kind === 'value')).toHaveLength(12)
  })

  it('overrides apply by value: color, label, visibility', () => {
    const r = resolveStyle(categorized({ classes: [{ value: 'b', color: '#ff0000', label: 'Bee', visible: false }] }), layerOf(['a', 'b']))
    expect(r.classes.find((c) => c.value === 'b')).toMatchObject({ color: '#ff0000', label: 'Bee', visible: false })
    expect(r.classes.find((c) => c.value === 'a')).toMatchObject({ visible: true, label: 'a' })
  })

  it('palettes shorter than the class count repeat, with a note', () => {
    const r = resolveStyle(categorized({ ramp: { id: 'brewer-set2', reversed: false } }), layerOf('abcdefghij'.split('')))
    expect(r.classes[8].color).toBe(r.classes[0].color)
    expect(r.notes.join()).toMatch(/repeat/)
  })

  it('a missing column falls back to the single symbol with a reason', () => {
    const r = resolveStyle(categorized({ column: 'gone' }), layerOf(['a']))
    expect(r.status).toBe('fallback')
    expect(r.reason).toBe('Column "gone" is not in this result.')
    expect(r.classes).toHaveLength(1)
  })
})

// --- Graduated (T022) --------------------------------------------------------

const { values: FIXTURE } = fixtureJson<{ values: number[] }>('values.json')
const QGIS = fixtureJson<Record<'equal' | 'quantile' | 'jenks', Array<[number, number]>>>('qgis-breaks.json')
const sorted = [...FIXTURE].sort((a, b) => a - b)
const inner = (ranges: Array<[number, number]>) => ranges.slice(1).map(([lo]) => lo)
const close = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length)
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6))
}
/** Within-class sum of squares for upper-inclusive inner breaks. */
function ssq(values: number[], breaks: number[]): number {
  const groups: number[][] = breaks.map(() => [])
  groups.push([])
  for (const v of values) {
    let i = breaks.findIndex((b) => v <= b)
    if (i === -1) i = breaks.length
    groups[i].push(v)
  }
  return groups.reduce((sum, g) => {
    if (!g.length) return sum
    const m = g.reduce((a, b) => a + b, 0) / g.length
    return sum + g.reduce((a, b) => a + (b - m) ** 2, 0)
  }, 0)
}

describe('toNumber', () => {
  it('numbers and numeric strings pass; null, empty, text, booleans and non-finite values have no value', () => {
    expect(toNumber(3)).toBe(3)
    expect(toNumber('12.50')).toBe(12.5)
    expect(toNumber(' 7 ')).toBe(7)
    for (const v of [null, undefined, '', 'abc', true, false, Infinity, NaN, 'Infinity']) expect(toNumber(v), String(v)).toBeNull()
  })
})

describe('breaks against QGIS 4.2.3 (SC-002)', () => {
  it('equal interval equals QGIS', () => close(equalIntervalBreaks(sorted, 5), inner(QGIS.equal)))
  it('quantile equals QGIS', () => close(quantileBreaks(sorted, 5), inner(QGIS.quantile)))
  it('natural breaks: QGIS on breaks 1, 3, 4; a better fit than QGIS on break 2 (research §3)', () => {
    const ours = jenksBreaks(sorted, 5)
    const theirs = inner(QGIS.jenks)
    expect(ours[0]).toBeCloseTo(theirs[0], 6)
    expect(ours[2]).toBeCloseTo(theirs[2], 6)
    expect(ours[3]).toBeCloseTo(theirs[3], 6)
    expect(ssq(sorted, ours)).toBeLessThan(ssq(sorted, theirs))
  })
})

describe('natural breaks are optimal (brute force)', () => {
  let seed = 11
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  /** Every way to cut n sorted values into k non-empty groups. */
  function best(values: number[], k: number): number {
    let min = Infinity
    const cut = (start: number, left: number, breaks: number[]) => {
      if (left === 1) {
        min = Math.min(min, ssq(values, breaks))
        return
      }
      for (let i = start; i <= values.length - left; i++) cut(i + 1, left - 1, [...breaks, values[i]])
    }
    cut(0, k, [])
    return min
  }
  for (let trial = 0; trial < 30; trial++) {
    const n = 5 + Math.floor(rand() * 8)
    const k = 2 + (trial % 3)
    const values = Array.from({ length: n }, () => Math.round(rand() * 1000) / 10).sort((a, b) => a - b)
    if (new Set(values).size < n) continue
    it(`trial ${trial}: n=${n}, k=${k}`, () => {
      expect(ssq(values, jenksBreaks(values, k))).toBeCloseTo(best(values, k), 6)
    })
  }
})

describe('class boundaries (research §2)', () => {
  const ranges = [
    { lower: 0, upper: 10 },
    { lower: 10, upper: 20 },
  ]
  it('are upper-inclusive, and the first class includes its lower bound', () => {
    expect(classOf(0, ranges)).toBe(0)
    expect(classOf(10, ranges)).toBe(0)
    expect(classOf(10.0001, ranges)).toBe(1)
    expect(classOf(20, ranges)).toBe(1)
    expect(classOf(-1, ranges)).toBe(-1)
    expect(classOf(21, ranges)).toBe(-1)
  })
})

const graduated = (method: GraduatedMethod, classCount = 5, patch: object = {}): LayerStyle => ({
  ...DEFAULT_LAYER_STYLE,
  renderer: { kind: 'graduated', column: 'v', method, classCount, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {}, ...patch },
})
const numeric = (values: unknown[]) => layerOf(values, 'v', 'DOUBLE')

describe('graduated', () => {
  it('quantile on the fixture: 5 ranges with QGIS bounds, counts adding up, viridis colors, caption', () => {
    const r = resolveStyle(graduated('quantile'), numeric(FIXTURE))
    expect(r.caption).toBe('v · Quantile, 5 classes')
    expect(r.classes.map((c) => c.kind)).toEqual(['range', 'range', 'range', 'range', 'range'])
    expect(r.classes[0].lower).toBe(sorted[0])
    expect(r.classes[4].upper).toBe(sorted[sorted.length - 1])
    expect(r.classes.reduce((n, c) => n + c.count, 0)).toBe(500)
    for (const c of r.classes) expect(c.count).toBeGreaterThanOrEqual(99)
    expect(r.classes.map((c) => c.color)).toEqual(rampColors({ id: 'viridis', reversed: false }, 5))
  })

  it('nulls, empty strings, text and booleans go to No value', () => {
    const r = resolveStyle(graduated('equal', 2), numeric([1, 2, 3, 4, null, '', 'abc', true, '5']))
    expect(r.classes.find((c) => c.kind === 'noValue')?.count).toBe(4)
    expect(r.classes.filter((c) => c.kind === 'range').reduce((n, c) => n + c.count, 0)).toBe(5)
  })

  it('fewer distinct values than classes: one class per value, with a note', () => {
    const r = resolveStyle(graduated('quantile', 5), numeric([1, 1, 2, 2, 3]))
    expect(r.classes.filter((c) => c.kind === 'range')).toHaveLength(3)
    expect(r.notes.join()).toMatch(/3 classes/)
  })

  it('all-equal values: one class and a note, never empty classes', () => {
    for (const method of ['equal', 'quantile', 'jenks'] as const) {
      const r = resolveStyle(graduated(method, 5), numeric([7, 7, 7]))
      expect(r.classes).toHaveLength(1)
      expect(r.classes[0]).toMatchObject({ lower: 7, upper: 7, count: 3, label: '7' })
      expect(r.notes.join()).toMatch(/can't be divided/)
    }
  })

  it('quantile ties never split identical values; duplicate breaks collapse', () => {
    const values = [...Array(80).fill(1), 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
    const r = resolveStyle(graduated('quantile', 5), numeric(values))
    const ranges = r.classes.filter((c) => c.kind === 'range')
    expect(ranges.length).toBeLessThan(5)
    expect(ranges[0].count).toBe(80)
    expect(new Set(ranges.map((c) => c.upper)).size).toBe(ranges.length)
  })

  it('labels format to the class width', () => {
    const r = resolveStyle(graduated('equal', 2), numeric([0, 1000000]))
    expect(r.classes.map((c) => c.label)).toEqual(['0 – 500,000', '500,000 – 1,000,000'])
    const small = resolveStyle(graduated('equal', 2), numeric([0, 1]))
    expect(small.classes.map((c) => c.label)).toEqual(['0 – 0.5', '0.5 – 1'])
  })

  it('manual ranges keep their bounds; values outside them go to Other', () => {
    const r = resolveStyle(
      graduated('manual', 2, {
        classes: [
          { index: 0, lower: 0, upper: 10 },
          { index: 1, lower: 10, upper: 20 },
        ],
      }),
      numeric([5, 10, 15, 25])
    )
    expect(r.caption).toBe('v · Manual, 2 classes')
    expect(r.classes.map((c) => [c.key, c.count])).toEqual([
      ['range:0', 2],
      ['range:1', 1],
      ['__other', 1],
    ])
  })

  it('a text column falls back with a reason', () => {
    const r = resolveStyle(graduated('quantile'), layerOf(['a'], 'v', 'VARCHAR'))
    expect(r.status).toBe('fallback')
    expect(r.reason).toBe('Column "v" is not numeric in this result.')
  })

  it('natural breaks above 200,000 values are estimated, with a caption note', () => {
    const big = Array.from({ length: 200_100 }, (_, i) => (i * 7919) % 100_003)
    const r = resolveStyle(graduated('jenks', 4), numeric(big))
    expect(r.caption).toBe('v · Natural breaks, 4 classes (estimated from 200,000 values)')
    expect(r.classes.reduce((n, c) => n + c.count, 0)).toBe(200_100)
  })
})
