// Web implementation of HostAdapter (T031). Reads file bytes directly via
// the File/Blob API — no message-passing boundary to cross, unlike the VS
// Code implementation (apps/vscode-ext/src/webview/hostAdapter.ts).
import type { FileSource, HostAdapter, OpenedFileRef, StatusFields, ThemeKind } from '@spatial-explorer/core'

const fileMap = new Map<string, File[]>()

function detectTheme(): ThemeKind {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function isLikelySidecar(name: string): boolean {
  const lower = name.toLowerCase()
  return ['.shx', '.dbf', '.prj', '.cpg'].some((ext) => lower.endsWith(ext))
}

let pendingOpenFilesResolve: ((refs: OpenedFileRef[]) => void) | null = null

/**
 * Called by App.svelte's picker/drop-zone UI once the user has chosen file(s)
 * — resolves the HostAdapter.openFiles() call the viewer store is awaiting.
 * Sidecar discovery (Shapefile's .shx/.dbf/.prj) depends on the user having
 * selected/dropped all of them together — the browser has no API to look up
 * sibling files from a single File handle (unlike VS Code's workspace.fs). A
 * bare .shp dropped alone surfaces as a clear ST_Read error (FR-011), per
 * contracts/host-adapter.md.
 */
export function provideFiles(files: File[]): void {
  const primary = files.find((f) => !isLikelySidecar(f.name)) ?? files[0]
  const id = crypto.randomUUID()
  fileMap.set(id, files)
  pendingOpenFilesResolve?.([{ id, displayName: primary.name }])
  pendingOpenFilesResolve = null
}

export function createWebHostAdapter(): HostAdapter {
  const themeListeners = new Set<(theme: ThemeKind) => void>()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const theme = detectTheme()
    themeListeners.forEach((cb) => cb(theme))
  })

  return {
    getTheme(): ThemeKind {
      return detectTheme()
    },
    onThemeChange(cb: (theme: ThemeKind) => void): () => void {
      themeListeners.add(cb)
      return () => themeListeners.delete(cb)
    },
    openFiles(): Promise<OpenedFileRef[]> {
      // Resolves once the user picks/drops a file via App.svelte's UI
      // (provideFiles) — this is the web shell's equivalent of the VS Code
      // webview waiting for the extension host's file-transfer messages.
      return new Promise((resolve) => {
        pendingOpenFilesResolve = resolve
      })
    },
    async getFileSource(ref: OpenedFileRef): Promise<FileSource> {
      const files = fileMap.get(ref.id)
      if (!files) throw new Error(`Unknown file reference: ${ref.id}`)
      const entries = await Promise.all(files.map(async (f) => [f.name, await f.arrayBuffer()] as const))
      const primaryName = files.find((f) => !isLikelySidecar(f.name))?.name ?? files[0].name
      const result: Record<string, ArrayBuffer> = {}
      let totalBytes = 0
      for (const [name, buf] of entries) {
        result[name] = buf
        totalBytes += buf.byteLength
      }
      return { files: result, primaryFileName: primaryName, totalBytes }
    },
    async saveFile(): Promise<void> {
      // No-op for spec 001 — persistence lands in later specs.
    },
    setStatus(_fields: StatusFields): void {
      // No-op on the web shell (CLAUDE.md: "no-op on web" for setStatus).
    },
  }
}
