// Reports the query state to the extension host whenever it changes, for
// the spatialExplorer._getQueryState test hook (spec 002,
// contracts/host-webview-protocol-delta.md). @vscode/test-electron can't see
// inside the webview, so this is how tests observe a query's outcome.
import type { ViewerStore } from '@spatial-explorer/ui'

export interface QueryStateReport {
  phase: string
  runCount: number
  rowCount?: number
  mappedCount?: number
  geometryColumn?: string | null
  resultCrs?: string
  resultCrsSource?: string
  errorMessage?: string
  errorPosition?: { line: number; column: number }
  refusedReason?: string
  status?: string
  historyLength?: number
}

export function watchQueryState(store: ViewerStore, report: (state: QueryStateReport) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const layer = store.session.layer
      const err = store.queryError
      report({
        phase: store.queryPhase,
        runCount: store.runCount,
        rowCount: layer?.rowCount,
        mappedCount: layer?.featureCount,
        geometryColumn: store.resultGeometryColumn,
        resultCrs: store.resultCrs?.label,
        resultCrsSource: store.resultCrs?.source,
        errorMessage: err ? `${err.kind} Error: ${err.message}` : undefined,
        errorPosition: err?.position ? { line: err.position.line, column: err.position.column } : undefined,
        refusedReason: store.queryPhase === 'refused' ? store.queryStatus.replace(/^⛔\s*/, '') : undefined,
        status: store.queryStatus,
        historyLength: store.history.length,
      })
    })
  })
}
