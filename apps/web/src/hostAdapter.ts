// Web implementation of HostAdapter (T031). Reads file bytes directly via
// the File/Blob API — no message-passing boundary to cross, unlike the VS
// Code implementation (apps/vscode-ext/src/webview/hostAdapter.ts).
import type { FileSource, HostAdapter, OpenedFileRef, SaveResult, StatusFields, ThemeKind } from '@spatial-explorer/core'

const fileMap = new Map<string, File[]>()

function detectTheme(): ThemeKind {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function isLikelySidecar(name: string): boolean {
  const lower = name.toLowerCase()
  // .qml/.sld: a style dropped alongside the data (QGIS sidecar convention),
  // never the primary data file.
  return ['.shx', '.dbf', '.prj', '.cpg', '.qml', '.sld'].some((ext) => lower.endsWith(ext))
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
    async saveFile(name: string, content: Uint8Array | string): Promise<SaveResult> {
      // The browser cannot write next to a picked file, so every save is a
      // download (HostAdapter.saveSidecar is intentionally not implemented).
      const blob = new Blob([content as BlobPart], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { saved: true, location: name }
    },
    pickTextFile(options: { title: string; extensions: readonly string[] }): Promise<{ name: string; text: string } | null> {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = options.extensions.join(',')
        input.addEventListener('change', async () => {
          const file = input.files?.[0]
          resolve(file ? { name: file.name, text: await file.text() } : null)
        })
        input.addEventListener('cancel', () => resolve(null))
        input.click()
      })
    },
    async loadState<T>(key: string): Promise<T | undefined> {
      // Storage can be unavailable (private mode, blocked site data): treat as empty.
      try {
        const raw = window.localStorage.getItem(`spatial-explorer:${key}`)
        return raw === null ? undefined : (JSON.parse(raw) as T)
      } catch {
        return undefined
      }
    },
    async saveState(key: string, value: unknown): Promise<void> {
      try {
        if (value === null || value === undefined) window.localStorage.removeItem(`spatial-explorer:${key}`)
        else window.localStorage.setItem(`spatial-explorer:${key}`, JSON.stringify(value))
      } catch {
        // Not persisted; the choice still applies for this session.
      }
    },
    setStatus(_fields: StatusFields): void {
      // No-op on the web shell (CLAUDE.md: "no-op on web" for setStatus).
    },
  }
}
