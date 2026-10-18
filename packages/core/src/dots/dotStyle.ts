// Spec 022: how a dot density result opens. The dots are small and colored by `category` (the column each stands for), so the
// legend names the columns and is titled "One dot = N". Every point option stays available afterwards.
import { DEFAULT_LAYER_STYLE, type LayerStyle } from '../style/model.js'
import { setEncoding, startEncoding } from '../style/edit.js'

/** The whole style a fresh dot density result opens with. */
export function dotStyle(label: string): LayerStyle {
  const base: LayerStyle = { ...DEFAULT_LAYER_STYLE, pointRadius: 2.5, fillOpacity: 0.85, strokeColor: '#ffffff', strokeOpacity: 0.5, strokeWidth: 0.25 }
  const encoding = startEncoding('color', 'category', { columns: [{ name: 'category', type: 'VARCHAR' }] })
  return setEncoding(base, 'color', { ...encoding, legend: { title: label } })
}
