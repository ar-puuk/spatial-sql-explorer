// Spec 011 T002: every style shape saved before spec 011, as RAW LayerStyle
// JSON (not built through startStyle or other edits: those APIs change in
// 011). Their resolve / paint / layout / filter / icons were recorded by the
// pre-011 build into pre-011-snapshot.json (tests/core/record-pre-011.test.ts);
// the channel model must draw them the same (SC-002).
import type { LayerStyle, ResolveInput } from '@spatial-explorer/core'

const base = {
  fillColor: '#3b82f6',
  fillOpacity: 0.45,
  strokeColor: '#1d4ed8',
  strokeOpacity: 1,
  strokeWidth: 1.5,
  pointRadius: 5,
}
/** The fixed symbol that thematic styles start from (edit.ts THEMATIC_SYMBOL at 0.3.0). */
const thematic = { ...base, fillOpacity: 0.75, strokeColor: '#4b5563', strokeOpacity: 0.8, strokeWidth: 0.5 }

const N = 30
/** v: 0..58 step 2 with a null; kind: a/b/null; w: weights; h: heights (some missing or negative). */
const rows = Array.from({ length: N }, (_, i) => ({
  v: i === 4 ? null : i * 2,
  kind: i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : null,
  w: i % 5 === 0 ? null : (i * 7) % 23,
  h: i === 3 ? null : i === 8 ? -5 : i * 10,
  // What the engine computes: a graduated expression's value, and the matching rule's index.
  __se_val: i === 4 ? null : i * 2 * 1.5 + 1,
  __se_cls: i % 4 === 0 ? 0 : i % 4 === 1 ? 1 : -1,
}))

/** The displayed result every snapshot style is resolved against (points, so the heatmap's own peak works). */
export function snapshotLayer011(): ResolveInput {
  return {
    features: rows.map((attributes, i) => ({
      id: i,
      geometry: { type: 'Point', coordinates: [-111.9 + (i % 6) * 0.004, 40.7 + Math.floor(i / 6) * 0.004] },
      attributes,
    })) as ResolveInput['features'],
    columns: [
      { name: 'v', type: 'DOUBLE' },
      { name: 'kind', type: 'VARCHAR' },
      { name: 'w', type: 'DOUBLE' },
      { name: 'h', type: 'DOUBLE' },
      { name: '__se_val', type: 'DOUBLE' },
      { name: '__se_cls', type: 'INTEGER' },
    ],
    ruleCounts: new Map([
      [0, 8],
      [1, 7],
      [-1, 15],
    ]),
    ruleErrors: { r3: 'Referenced column "nope" not found' },
  }
}

const ramp = (id: string, reversed = false) => ({ id, reversed })

/** Name → raw style, every renderer kind × size × shape × dash × extrusion shape used before 011. */
export const PRE_011_STYLES: Record<string, LayerStyle> = {
  single: { ...base, renderer: { kind: 'single' } },
  singleNoRenderer: { ...base },
  singleShaped: { ...base, renderer: { kind: 'single' }, markerShape: 'star', lineDash: 'dash', pointRadius: 7, layerOpacity: 0.5 },

  categorizedAuto: {
    ...thematic,
    renderer: { kind: 'categorized', column: 'kind', ramp: ramp('brewer-set2'), cap: 12, manual: false, classes: [], other: {}, noValue: {} },
  },
  categorizedEdited: {
    ...thematic,
    markerShape: 'triangle',
    renderer: {
      kind: 'categorized',
      column: 'kind',
      ramp: ramp('brewer-set2', true),
      cap: 12,
      manual: false,
      classes: [
        { value: 'a', visible: false },
        { value: 'b', color: '#123456', label: 'Bee' },
      ],
      other: {},
      noValue: { color: '#000000', label: 'Unknown' },
    },
  },
  categorizedManualCapped: {
    ...thematic,
    renderer: {
      kind: 'categorized',
      column: 'kind',
      ramp: ramp('brewer-set1'),
      cap: 1,
      manual: true,
      classes: [{ value: 'b', color: '#ff0000' }],
      other: { color: '#00ff00', label: 'The rest' },
      noValue: { visible: false },
    },
  },

  graduatedEqual: { ...thematic, renderer: { kind: 'graduated', column: 'v', method: 'equal', classCount: 4, ramp: ramp('viridis'), classes: [], noValue: {} } },
  graduatedQuantileHidden: {
    ...thematic,
    renderer: { kind: 'graduated', column: 'v', method: 'quantile', classCount: 5, ramp: ramp('viridis', true), classes: [{ index: 2, visible: false }, { index: 0, color: '#abcdef', label: 'Lowest' }], noValue: { label: 'n/a' } },
  },
  graduatedJenksShaped: { ...thematic, markerShape: 'square', lineDash: 'dot', renderer: { kind: 'graduated', column: 'v', method: 'jenks', classCount: 3, ramp: ramp('brewer-ylorrd'), classes: [], noValue: {} } },
  graduatedManual: {
    ...thematic,
    renderer: {
      kind: 'graduated',
      column: 'v',
      method: 'manual',
      classCount: 3,
      ramp: ramp('viridis'),
      classes: [
        { index: 0, lower: 0, upper: 10 },
        { index: 1, lower: 10, upper: 30, color: '#ff8800' },
        { index: 2, lower: 30, upper: 50 },
      ],
      noValue: {},
    },
  },
  graduatedExpression: {
    ...thematic,
    renderer: { kind: 'graduated', column: 'v times 1.5', expression: 'v * 1.5 + 1', method: 'quantile', classCount: 4, ramp: ramp('viridis'), classes: [], noValue: {} },
  },

  rules: {
    ...thematic,
    renderer: {
      kind: 'rules',
      rules: [
        { id: 'r1', label: 'Big', where: 'v > 40', color: '#e41a1c', visible: true },
        { id: 'r2', label: '', where: "kind = 'b'", color: '#377eb8', visible: false },
        { id: 'r3', label: 'Broken', where: 'nope > 1', color: '#4daf4a', visible: true },
      ],
      elseColor: '#bdbdbd',
      elseVisible: true,
      elseLabel: 'Everything else',
    },
  },

  bivariate: {
    ...thematic,
    renderer: { kind: 'bivariate', x: { column: 'v', method: 'quantile' }, y: { column: 'w', method: 'equal' }, palette: 'orange-blue', hidden: ['1-1'], noValue: { label: 'Missing' } },
  },

  heatmapPx: { ...base, renderer: { kind: 'heatmap', weight: '', radius: 25, intensity: 0.8, ramp: ramp('brewer-ylorrd') } },
  heatmapMetersAuto: {
    ...base,
    renderer: { kind: 'heatmap', weight: 'w', radius: 20, radiusUnit: 'm', radiusMeters: 500, latitude: 40.7, intensity: 1, ramp: ramp('magma', true), autoIntensity: true },
  },
  heatmapWeighted: { ...base, layerOpacity: 0.7, renderer: { kind: 'heatmap', weight: 'w', radius: 15, intensity: 2, ramp: ramp('viridis') } },

  sizeClassed: {
    ...base,
    renderer: { kind: 'single' },
    size: { column: 'v', mode: 'classed', method: 'quantile', classCount: 4, classes: [{ index: 1, visible: false }, { index: 3, label: 'Top' }], noValue: { label: 'No size' }, sizeMin: 2, sizeMax: 12 },
  },
  sizeProportionalArea: {
    ...base,
    markerShape: 'diamond',
    renderer: { kind: 'single' },
    size: { column: 'w', mode: 'proportional', method: 'quantile', classCount: 5, classes: [], noValue: { visible: false }, sizeMin: 3, sizeMax: 18, scale: 'area' },
  },
  sizeProportionalLinear: {
    ...base,
    renderer: { kind: 'single' },
    size: { column: 'v', mode: 'proportional', method: 'quantile', classCount: 5, classes: [], noValue: {}, sizeMin: 1, sizeMax: 6, scale: 'linear' },
  },
  categorizedWithSize: {
    ...thematic,
    lineDash: 'dash-dot',
    renderer: { kind: 'categorized', column: 'kind', ramp: ramp('brewer-set2'), cap: 12, manual: false, classes: [], other: {}, noValue: {} },
    size: { column: 'v', mode: 'classed', method: 'equal', classCount: 3, classes: [], noValue: {}, sizeMin: 1, sizeMax: 5 },
  },

  extrusionColumn: { ...thematic, renderer: { kind: 'single' }, extrusion: { enabled: true, source: { kind: 'column', column: 'h' }, scale: 2.5 } },
  extrusionConstant: { ...base, renderer: { kind: 'single' }, extrusion: { enabled: true, source: { kind: 'constant', meters: 120 }, scale: 1 } },
  extrusionOffGraduated: {
    ...thematic,
    renderer: { kind: 'graduated', column: 'v', method: 'equal', classCount: 3, ramp: ramp('viridis'), classes: [], noValue: {} },
    extrusion: { enabled: false, source: { kind: 'column', column: 'h' }, scale: 1 },
  },
} as Record<string, LayerStyle>

/** Styles the recorder also exports to QML (the 0.3.0 sidecars, T004), with the geometry each is saved for. */
export const PRE_011_SIDECAR_GEOMETRY: Record<string, 'Point' | 'LineString' | 'Polygon' | 'Mixed'> = {
  single: 'Polygon',
  singleShaped: 'Point',
  categorizedAuto: 'Polygon',
  categorizedEdited: 'Point',
  categorizedManualCapped: 'LineString',
  graduatedEqual: 'Polygon',
  graduatedQuantileHidden: 'Polygon',
  graduatedJenksShaped: 'Point',
  graduatedManual: 'LineString',
  graduatedExpression: 'Polygon',
  rules: 'Polygon',
  bivariate: 'Polygon',
  heatmapPx: 'Point',
  heatmapMetersAuto: 'Point',
  heatmapWeighted: 'Point',
  sizeClassed: 'Point',
  sizeProportionalArea: 'Point',
  sizeProportionalLinear: 'LineString',
  categorizedWithSize: 'Mixed',
  extrusionColumn: 'Polygon',
  extrusionConstant: 'Polygon',
  extrusionOffGraduated: 'Polygon',
}
