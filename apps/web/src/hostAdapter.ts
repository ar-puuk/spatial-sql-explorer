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

const STYLE_EXTENSIONS = ['.qml', '.sld']

function primaryOf(files: File[]): File {
  return files.find((f) => !isLikelySidecar(f.name)) ?? files[0]
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
  // No path exists in the browser: name + size + mtime identifies "the same
  // file" across sessions well enough for query history (spec 002).
  pendingOpenFilesResolve?.([{ id, displayName: primary.name, stateKey: `${primary.name}|${primary.size}|${primary.lastModified}` }])
  pendingOpenFilesResolve = null
}

/** e2e (spec 007 T053): range reads served, to show PMTiles is never read whole. */
export const rangeReads = { count: 0, bytes: 0, largest: 0 }

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
    async getFileSource(ref: OpenedFileRef, options?: { whole?: boolean }): Promise<FileSource> {
      const files = fileMap.get(ref.id)
      if (!files) throw new Error(`Unknown file reference: ${ref.id}`)
      const primary = primaryOf(files)
      // The QGIS-convention style sidecar (<basename>.qml) is read as text;
      // other style files are never data.
      const wantedStyle = `${primary.name.replace(/\.[^.]+$/, '')}.qml`.toLowerCase()
      const style = files.find((f) => f !== primary && f.name.toLowerCase() === wantedStyle)
      const styleSidecar = style ? { fileName: style.name, text: await style.text() } : null
      const sidecars = files.filter((f) => f !== primary && !STYLE_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
      if (options?.whole) {
        // FlatGeobuf "load for queries" (spec 007): the whole file, in memory.
        return {
          kind: 'bytes',
          name: primary.name,
          size: primary.size,
          bytes: new Uint8Array(await primary.arrayBuffer()),
          sidecars: await Promise.all(sidecars.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
          styleSidecar,
        }
      }
      // Spec 007 research §2: the engine reads the File in slices; nothing is copied up front.
      return { kind: 'handle', name: primary.name, size: primary.size, handle: primary, sidecars: sidecars.map((f) => ({ name: f.name, handle: f })), styleSidecar }
    },
    async readRange(ref: OpenedFileRef, offset: number, length: number): Promise<Uint8Array> {
      const files = fileMap.get(ref.id)
      if (!files) throw new Error(`Unknown file reference: ${ref.id}`)
      const bytes = new Uint8Array(await primaryOf(files).slice(offset, offset + length).arrayBuffer())
      rangeReads.count++
      rangeReads.bytes += bytes.byteLength
      rangeReads.largest = Math.max(rangeReads.largest, bytes.byteLength)
      return bytes
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
