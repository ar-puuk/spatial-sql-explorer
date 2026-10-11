// Reports the resolved layer style to the extension host whenever it
// changes, for the spatialExplorer._getStyleState test hook (spec 003 T013).
// @vscode/test-electron can't see inside the webview, so this is how tests
// compare classes and counts with the web build (FR-020).
import { rendererOf } from '@spatial-explorer/core'
import type { ViewerStore } from '@spatial-explorer/ui'

export interface StyleStateReport {
  renderer: string
  column?: string
  method?: string
  classCount?: number
  status: string
  reason?: string
  caption: string
  dirty: boolean
  source: string | null
  classes: Array<{ key: string; label: string; color: string; visible: boolean; count: number }>
}

export function watchStyleState(store: ViewerStore, report: (state: StyleStateReport) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const r = rendererOf(store.style)
      const resolved = store.resolvedStyle
      report({
        renderer: r.kind,
        column: r.kind === 'single' ? undefined : r.column,
        method: r.kind === 'graduated' ? r.method : undefined,
        classCount: r.kind === 'graduated' ? r.classCount : undefined,
        status: resolved.status,
        reason: resolved.reason,
        caption: resolved.caption,
        dirty: store.styleDirty,
        source: store.styleSource,
        classes: resolved.classes.map((c) => ({ key: c.key, label: c.label, color: c.color, visible: c.visible, count: c.count })),
      })
    })
  })
}
