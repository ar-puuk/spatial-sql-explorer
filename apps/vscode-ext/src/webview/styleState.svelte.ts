// Reports the resolved layer style to the extension host whenever it
// changes, for the spatialExplorer._getStyleState test hook (spec 003 T013).
// @vscode/test-electron can't see inside the webview, so this is how tests
// compare classes and counts with the web build (FR-020).
import { rendererOf, rendererTitle } from '@spatial-explorer/core'
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
  /** Spec 009: the size channel, when one applies. */
  size?: {
    column: string
    mode: string
    status: string
    caption: string
    classes: Array<{ key: string; label: string; size?: number; visible: boolean; count: number }>
    samples?: Array<{ value: number; size: number }>
  }
  /** Spec 011 US6: the label settings, and why an expression label can't be used. */
  labels?: unknown
  labelError?: string
  /** Spec 011: the other properties that vary by a column, as resolved. */
  channels?: Record<string, { status: string; classes: Array<{ key: string; label: string; output?: string | number; visible: boolean; count: number }> }>
}

export function watchStyleState(store: ViewerStore, report: (state: StyleStateReport) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const r = rendererOf(store.style)
      const resolved = store.resolvedStyle
      report({
        renderer: r.kind,
        column: rendererTitle(r) || undefined,
        method: r.kind === 'graduated' ? r.method : undefined,
        classCount: r.kind === 'graduated' ? r.classCount : undefined,
        status: resolved.status,
        reason: resolved.reason,
        caption: resolved.caption,
        dirty: store.styleDirty,
        source: store.styleSource,
        classes: resolved.classes.map((c) => ({ key: c.key, label: c.label, color: c.color, visible: c.visible, count: c.count })),
        size: resolved.size
          ? {
              column: resolved.size.column,
              mode: resolved.size.mode,
              status: resolved.size.status,
              caption: resolved.size.caption,
              classes: resolved.size.classes.map((c) => ({ key: c.key, label: c.label, size: c.size, visible: c.visible, count: c.count })),
              samples: resolved.size.samples?.map((x) => ({ value: x.value, size: x.size })),
            }
          : undefined,
        labels: store.style.labels,
        labelError: resolved.labelError,
        channels: resolved.channels
          ? Object.fromEntries(
              Object.entries(resolved.channels).map(([id, rc]) => [
                id,
                { status: rc?.status ?? 'fallback', classes: (rc?.classes ?? []).map((c) => ({ key: c.key, label: c.label, output: c.output, visible: c.visible, count: c.count })) },
              ])
            )
          : undefined,
      })
    })
  })
}
