// A page made and saved without the dialog, for the tests of the shells (a command or a message drives it).
import type { ViewerStore } from '../viewerStore.svelte.js'
import { PrintComposer, type ExportKind } from './composer.svelte.js'

export async function quickPrint(store: ViewerStore, o: { format: ExportKind; paper: 'map' | 'a4'; scale: 1 | 2; title: string; furniture: boolean }): Promise<void> {
  const c = new PrintComposer(store, () => null)
  await c.recapture()
  c.set({ title: o.title, showTitle: o.title !== '', showScaleBar: o.furniture, showNorthArrow: o.furniture, showDate: false, showAttribution: false, mapBorderWidth: 0 })
  if (o.paper === 'map') c.useMapSize(o.scale)
  else c.set({ paperSize: 'a4', orientation: 'landscape', pageMargin: 'normal' })
  await c.export(o.format)
}
