// Spec 017: how a binned result opens. The cells are colored by `value` in quantile classes (the style panel's
// "Vary by attribute"), with a thin light outline so neighbours read as a mosaic, and the legend is titled with
// what the value is ("Number of features"). Every option of a polygon layer stays available afterwards.
import { DEFAULT_LAYER_STYLE, type LayerStyle } from '../style/model.js'
import { setEncoding, startEncoding } from '../style/edit.js'

/** The columns a bin query returns (data-model.md). */
export const BIN_COLUMNS = ['cell_id', 'resolution', 'value', 'n', 'geom'] as const

/** Whether a result has the shape of a bin query's (so a rerun of an edited bin keeps the user's style). */
export function isBinResult(columns: ReadonlyArray<{ name: string }>): boolean {
  const names = new Set(columns.map((c) => c.name))
  return BIN_COLUMNS.every((c) => names.has(c))
}

/** The whole style a fresh bin result opens with. */
export function gridStyle(valueLabel: string): LayerStyle {
  const base: LayerStyle = { ...DEFAULT_LAYER_STYLE, fillOpacity: 0.75, strokeColor: '#ffffff', strokeOpacity: 0.6, strokeWidth: 0.5 }
  const encoding = startEncoding('color', 'value', { columns: [{ name: 'value', type: 'DOUBLE' }] })
  return setEncoding(base, 'color', { ...encoding, legend: { title: valueLabel } })
}
