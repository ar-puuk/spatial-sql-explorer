// Spec 009 T007: styles WITHOUT a size channel or bivariate renderer, whose
// resolve / paint / layout / filter were recorded by the build before spec 009
// (pre-009-snapshot.json). The new channel code must reproduce them exactly.
import { DEFAULT_LAYER_STYLE, setClassColor, setClassVisible, startStyle, type LayerStyle } from '@spatial-explorer/core'

const values = Array.from({ length: 30 }, (_, i) => (i === 4 ? null : i * 2))
export const SNAPSHOT_LAYER = {
  features: values.map((v, i) => ({ id: i, geometry: null, attributes: { v, kind: i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : null } })),
  columns: [
    { name: 'v', type: 'DOUBLE' },
    { name: 'kind', type: 'VARCHAR' },
  ],
}

export function snapshotStyles(): Record<string, LayerStyle> {
  const base = DEFAULT_LAYER_STYLE as LayerStyle
  const categorized = startStyle(base, 'categorized', SNAPSHOT_LAYER, 'kind')
  const graduated = startStyle(base, 'graduated', SNAPSHOT_LAYER, 'v')
  return {
    single: base,
    singleShaped: { ...base, markerShape: 'star', lineDash: 'dash', pointRadius: 7, layerOpacity: 0.5 },
    categorized,
    categorizedHidden: setClassColor(setClassVisible(categorized, 'v:a', false), 'v:b', '#123456'),
    graduated,
    graduatedJenksShaped: { ...startStyle(base, 'graduated', SNAPSHOT_LAYER, 'v'), markerShape: 'triangle', lineDash: 'dot' },
    graduatedHidden: setClassVisible(graduated, 'range:2', false),
  }
}
