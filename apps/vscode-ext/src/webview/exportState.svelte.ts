// Reports the export state to the extension host whenever it changes, for the
// spatialExplorer._getExportState test hook (spec 005 T013). @vscode/test-electron
// can't see inside the webview, so this is how tests observe an export.
import type { ViewerStore } from '@spatial-explorer/ui'

export interface ExportStateReport {
  open: boolean
  phase: string
  disabled: string | null
  plan: { format: string; rowCount: number; formats: string[]; crs: string; notices: string[] } | null
  outcome: unknown
}

export function watchExportState(store: ViewerStore, report: (state: ExportStateReport) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const plan = store.exportPlan
      report({
        open: store.exportOpen,
        phase: store.exportPhase,
        disabled: store.exportDisabled,
        plan: plan
          ? {
              format: plan.format,
              rowCount: plan.rowCount,
              formats: plan.formats.filter((f) => f.available).map((f) => f.id),
              crs: plan.crs.label,
              notices: plan.notices,
            }
          : null,
        outcome: store.exportOutcome,
      })
    })
  })
}
