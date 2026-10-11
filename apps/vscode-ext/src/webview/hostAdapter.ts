// VS Code implementation of HostAdapter (T021), for the webview context.
// Implements contracts/host-adapter.md over the message protocol in
// contracts/host-webview-protocol.md. packages/core and packages/ui never
// see any of this — they only see the HostAdapter interface.
import type { FileSource, HostAdapter, OpenedFileRef, SaveResult, StatusFields, ThemeKind, SaveOptions } from '@spatial-explorer/core'

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void
}

const vscode = acquireVsCodeApi()

// postMessage structured-clones its payload, and Svelte 5 `$state` values
// (e.g. `session.layer.extent`) are Proxies that structuredClone rejects with
// a DataCloneError — thrown synchronously, so the message is silently never
// sent (this hung every non-empty load in the T014/T034 suites). Every
// webview->host message is small, so normalize through JSON here, once, rather
// than trusting each call site to snapshot its fields (same root cause as
// research.md §5's MapLibre DataCloneError).
function post(msg: unknown): void {
  vscode.postMessage(JSON.parse(JSON.stringify(msg)))
}

export interface DuckDbAssets {
  workerUrl: string
  wasmUrl: string
}

let maplibreWorkerUrlResolve: ((url: string) => void) | null = null
const maplibreWorkerUrlPromise = new Promise<string>((resolve) => {
  maplibreWorkerUrlResolve = resolve
})

/** asWebviewUri() of the bundled maplibre-gl worker, announced with the other assets. */
export function getMaplibreWorkerUrl(): Promise<string> {
  return maplibreWorkerUrlPromise
}

interface PendingFile {
  name: string
  isPrimary: boolean
  chunks: string[]
}

let assetsResolve: ((assets: DuckDbAssets) => void) | null = null
const assetsPromise = new Promise<DuckDbAssets>((resolve) => {
  assetsResolve = resolve
})

let primaryFileNameFromAssets: string | null = null
let primaryFileUri: string | null = null
let primaryFileNameResolve: ((name: string) => void) | null = null
const primaryFileNamePromise = new Promise<string>((resolve) => {
  primaryFileNameResolve = resolve
})

let pendingFiles: Map<string, PendingFile> | null = null
let fileSourceResolve: ((source: FileSource) => void) | null = null
let fileSourceReject: ((err: Error) => void) | null = null
let fileSourcePromise: Promise<FileSource> | null = null

function ensureFileSourcePromise(): Promise<FileSource> {
  if (!fileSourcePromise) {
    pendingFiles = new Map()
    fileSourcePromise = new Promise((resolve, reject) => {
      fileSourceResolve = resolve
      fileSourceReject = reject
    })
  }
  return fileSourcePromise
}

/**
 * The whole-transfer FileSource: the primary file plus its same-basename
 * data sidecars, with the QGIS style sidecar (<basename>.qml) split off as
 * text (spec 007 FileSource).
 */
function bytesSource(files: Array<{ name: string; isPrimary: boolean; bytes: Uint8Array }>): FileSource {
  const primary = files.find((f) => f.isPrimary) ?? files[0]
  const wantedStyle = `${primary.name.replace(/\.[^.]+$/, '')}.qml`.toLowerCase()
  const style = files.find((f) => f !== primary && f.name.toLowerCase() === wantedStyle)
  const isStyle = (name: string): boolean => ['.qml', '.sld'].some((ext) => name.toLowerCase().endsWith(ext))
  return {
    kind: 'bytes',
    name: primary.name,
    size: primary.bytes.byteLength,
    bytes: primary.bytes,
    sidecars: files.filter((f) => f !== primary && !isStyle(f.name)).map((f) => ({ name: f.name, bytes: f.bytes })),
    styleSidecar: style ? { fileName: style.name, text: new TextDecoder().decode(style.bytes) } : null,
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// Request/response over postMessage for host-side file dialogs and writes
// (style save/export/import). The host answers each request with a
// `<type>Result` message carrying the same requestId.
let nextRequestId = 1
let nextTransferId = 1

/**
 * Data exports (spec 005) can be large and binary. post() JSON-normalizes
 * every message (no Svelte proxies across the bridge), so bytes travel as
 * base64 chunks, as host->webview file transfers already do: 24 MB of raw
 * bytes per chunk, about 32 MB of base64.
 */
const SAVE_CHUNK_BYTES = 24 * 1024 * 1024

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
const pendingRequests = new Map<number, (result: unknown) => void>()

function request<T>(msg: Record<string, unknown>): Promise<T> {
  const requestId = nextRequestId++
  return new Promise<T>((resolve) => {
    pendingRequests.set(requestId, resolve as (result: unknown) => void)
    post({ ...msg, requestId })
  })
}

const themeListeners = new Set<(theme: ThemeKind) => void>()
const sourceChangedListeners = new Set<() => void>()

function detectTheme(): ThemeKind {
  const classes = document.body.classList
  // Check high-contrast-light first: VS Code may set both HC classes on it.
  if (classes.contains('vscode-high-contrast-light')) return 'high-contrast-light'
  if (classes.contains('vscode-high-contrast')) return 'high-contrast'
  if (classes.contains('vscode-dark')) return 'dark'
  return 'light'
}

// VS Code updates theme-related CSS variables via a style attribute on
// <html> and toggles theme-kind classes on <body> — observe both per
// CLAUDE.md's theming rules.
const notifyThemeChange = (): void => {
  const theme = detectTheme()
  themeListeners.forEach((cb) => cb(theme))
}
new MutationObserver(notifyThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
new MutationObserver(notifyThemeChange).observe(document.body, { attributes: true, attributeFilter: ['class'] })

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as {
    type: string
    duckdbWorkerUrl?: string
    duckdbWasmUrl?: string
    maplibreWorkerUrl?: string
    primaryFileName?: string
    primaryFileUri?: string
    fileName?: string
    totalBytes?: number
    chunkCount?: number
    isPrimary?: boolean
    index?: number
    bytesBase64?: string
    message?: string
    requestId?: number
    result?: unknown
  }

  if (msg.type === 'requestResult' && msg.requestId !== undefined) {
    pendingRequests.get(msg.requestId)?.(msg.result)
    pendingRequests.delete(msg.requestId)
    return
  }

  if (msg.type === 'assets' && msg.duckdbWorkerUrl && msg.duckdbWasmUrl) {
    assetsResolve?.({ workerUrl: msg.duckdbWorkerUrl, wasmUrl: msg.duckdbWasmUrl })
    if (msg.maplibreWorkerUrl) maplibreWorkerUrlResolve?.(msg.maplibreWorkerUrl)
    if (msg.primaryFileUri) primaryFileUri = msg.primaryFileUri
    if (msg.primaryFileName && !primaryFileNameFromAssets) {
      primaryFileNameFromAssets = msg.primaryFileName
      primaryFileNameResolve?.(msg.primaryFileName)
    }
  } else if (msg.type === 'initFileStart' && msg.fileName) {
    ensureFileSourcePromise()
    pendingFiles?.set(msg.fileName, { name: msg.fileName, isPrimary: !!msg.isPrimary, chunks: new Array(msg.chunkCount ?? 1) })
  } else if (msg.type === 'initFileChunk' && msg.fileName && msg.bytesBase64 !== undefined && msg.index !== undefined) {
    const pending = pendingFiles?.get(msg.fileName)
    if (pending) pending.chunks[msg.index] = msg.bytesBase64
  } else if (msg.type === 'initFilesDone') {
    if (pendingFiles && fileSourceResolve) {
      fileSourceResolve(bytesSource([...pendingFiles.values()].map((f) => ({ name: f.name, isPrimary: f.isPrimary, bytes: new Uint8Array(base64ToArrayBuffer(f.chunks.join(''))) }))))
    }
  } else if (msg.type === 'sourceChanged') {
    sourceChangedListeners.forEach((cb) => cb())
  } else if (msg.type === 'triggerError' && msg.message) {
    fileSourceReject?.(new Error(msg.message))
  }
})

/** Posts 'ready' once, at module load — the host is listening before `.html` is set (contracts/host-webview-protocol.md). */
export function signalReady(): void {
  post({ type: 'ready' })
}

export function createVsCodeHostAdapter(): HostAdapter {
  return {
    getTheme(): ThemeKind {
      return detectTheme()
    },
    onThemeChange(cb: (theme: ThemeKind) => void): () => void {
      themeListeners.add(cb)
      return () => themeListeners.delete(cb)
    },
    async openFiles(): Promise<OpenedFileRef[]> {
      await assetsPromise
      const displayName = await primaryFileNamePromise
      return [{ id: 'document', displayName, stateKey: primaryFileUri ?? displayName }]
    },
    async getFileSource(_ref: OpenedFileRef): Promise<FileSource> {
      return ensureFileSourcePromise()
    },
    async readRange(): Promise<Uint8Array> {
      // Implemented with the loopback source (spec 007 T013).
      throw new Error('Range reads are not available yet.')
    },
    async saveFile(name: string, content: Uint8Array | string, options?: SaveOptions): Promise<SaveResult> {
      if (options?.kind !== 'data' && typeof content === 'string') {
        const result = await request<SaveResult & { error?: string }>({ type: 'saveFile', name, text: content })
        if (result.error) throw new Error(result.error)
        return result
      }
      // Binary / data: chunks first, then the request that saves them.
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
      const transferId = nextTransferId++
      const count = Math.max(1, Math.ceil(bytes.length / SAVE_CHUNK_BYTES))
      for (let index = 0; index < count; index++) {
        post({ type: 'saveFileChunk', transferId, index, count, bytesBase64: bytesToBase64(bytes.subarray(index * SAVE_CHUNK_BYTES, (index + 1) * SAVE_CHUNK_BYTES)) })
      }
      const result = await request<SaveResult & { error?: string }>({ type: 'saveFileEnd', transferId, name, kind: options?.kind ?? 'data', totalBytes: bytes.length })
      if (result.error) throw new Error(result.error)
      return result
    },
    async saveSidecar(name: string, content: string): Promise<SaveResult> {
      const result = await request<SaveResult & { error?: string }>({ type: 'saveSidecar', name, text: content })
      if (result.error) throw new Error(result.error)
      return result
    },
    async pickTextFile(options: { title: string; extensions: readonly string[] }): Promise<{ name: string; text: string } | null> {
      const result = await request<{ name: string; text: string } | { error: string } | null>({
        type: 'pickTextFile',
        title: options.title,
        extensions: [...options.extensions],
      })
      if (result && 'error' in result) throw new Error(result.error)
      return result
    },
    setStatus(fields: StatusFields): void {
      post({ type: 'statusUpdate', ...fields })
    },
    async loadState<T>(key: string): Promise<T | undefined> {
      const result = await request<{ value?: T }>({ type: 'loadState', key })
      return result?.value
    },
    async saveState(key: string, value: unknown): Promise<void> {
      await request({ type: 'saveState', key, value })
    },
    log(line: string): void {
      post({ type: 'log', detail: line })
    },
    onSourceChanged(cb: () => void): () => void {
      sourceChangedListeners.add(cb)
      return () => sourceChangedListeners.delete(cb)
    },
    reloadSource(): void {
      post({ type: 'reloadSource' })
    },
  }
}

/** The opened document's file name, as announced by the host with the assets. */
export function getPrimaryFileName(): Promise<string> {
  return primaryFileNamePromise
}

export function getDuckDbAssets(): Promise<DuckDbAssets> {
  return assetsPromise
}

/**
 * Reports the final load outcome to the extension host. Used by
 * @vscode/test-electron integration tests (which cannot otherwise observe
 * this webview's rendered DOM) via `spatialExplorer._getLoadState`, and
 * doubles as the hook a future host-side loading/error indicator would use.
 */
export function reportLoadState(
  loadState: string,
  details: {
    featureCount?: number
    invalidGeometryCount?: number
    rowCount?: number
    errorMessage?: string
    sourceCrsLabel?: string
    crsAssumed?: boolean
    extent?: [number, number, number, number] | null
    mapCanvasRect?: { width: number; height: number } | null
    renderedFeatureCount?: number | null
    styleSource?: string | null
    loadMs?: number
    loadTimings?: Record<string, number>
  }
): void {
  post({ type: 'loadStateChanged', loadState, ...details })
}

/** Basemap/theme state for the extension's test hook and output channel. */
export function reportViewState(state: { basemapId: string; appearance: string; basemapNotice: string | null; sourceChanged: boolean }): void {
  post({ type: 'viewState', ...state })
}

/** Query state for the extension's test hook (spec 002). */
export function reportQueryState(state: unknown): void {
  post({ type: 'queryState', state })
}

/** Export state for the extension's test hook (spec 005). */
export function reportExportState(state: unknown): void {
  post({ type: 'exportState', state })
}

/** Resolved style for the extension's test hook (spec 003). */
export function reportStyleState(state: unknown): void {
  post({ type: 'styleState', state })
}

/** One line in the "Spatial Explorer" output channel. */
export function logToHost(detail: string): void {
  post({ type: 'log', detail })
}

/** Test-only hook (T015) — see main.ts's `testSelectFeature` listener. */
export function reportSelectionChanged(id: string | number | null): void {
  post({ type: 'selectionChanged', id })
}
