// Reports the table's column view, filters and selection to the extension
// host whenever they change, for the spatialExplorer._getTableState test hook
// (spec 008 T026). @vscode/test-electron can't see inside the webview.
import type { ViewerStore } from '@spatial-explorer/ui'

export interface TableStateReport {
  hidden: string[]
  filters: Array<{ column: string; kind: string; valid?: boolean }>
  matching: number | null
  total: number
  selected: number
  /** Spec 008 T040: a multi-layer file's layers and the one shown. */
  layers: Array<{ name: string; geometryType: string | null; featureCount: number | null }>
  activeLayer: string | null
  rowCount: number | null
}

export function watchTableState(store: ViewerStore, report: (state: TableStateReport) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      report({
        hidden: [...store.hiddenColumns],
        filters: store.filters.map((f) => ({ column: f.column, kind: f.kind, valid: f.valid })),
        matching: store.filterCounts?.matching ?? null,
        total: store.tableTotal,
        selected: store.selectedCount,
        layers: store.fileLayers.map((l) => ({ ...l })),
        activeLayer: store.activeLayer,
        rowCount: store.session.layer?.rowCount ?? null,
      })
    })
  })
}
