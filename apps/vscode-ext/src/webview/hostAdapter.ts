// VS Code implementation of HostAdapter (T021), for the webview context.
// Implements contracts/host-adapter.md over the message protocol in
// contracts/host-webview-protocol.md. packages/core and packages/ui never
// see any of this — they only see the HostAdapter interface.
import { setTestOverrides, type FileSource, type HostAdapter, type OpenedFileRef, type SaveResult, type StatusFields, type ThemeKind, type SaveOptions, type TestOverrides } from '@spatial-explorer/core'

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
  sqlWasmUrl?: string
}

/** Spec 008: the `spatialExplorer.placeSearch.enabled` setting, as the host last sent it. */
let placeSearchEnabled: boolean | undefined

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

/** What the host announces for the opened file (spec 007, contracts/host-and-shells.md). */
interface FileSourceInfo {
  name: string
  size: number
  /** The loopback range server's URL (`http://localhost.:<port>/<token>/<name>`), or null when it couldn't start. */
  url: string | null
  sidecars: Array<{ name: string; url: string }>
  styleSidecar: { fileName: string; text: string } | null
  /** asWebviewUri(file): main-thread Range reads (PMTiles, research §3). */
  resourceUri: string
  /** Test hook: behave as if partial reads failed. */
  forceFallback: boolean
  serverError: string | null
  /** Test-only thresholds (spec 007 TestOverrides), applied before the file opens. */
  testOverrides?: Record<string, unknown>
}

let infoResolve: ((info: FileSourceInfo) => void) | null = null
let infoReject: ((err: Error) => void) | null = null
const infoPromise = new Promise<FileSourceInfo>((resolve, reject) => {
  infoResolve = resolve
  infoReject = reject
})

// The whole-file transfer (spec 001's chunk protocol), requested on demand:
// the fallback when partial reads fail, or FlatGeobuf "load for queries".
// Every request is a fresh transfer: the engine takes (detaches) the buffers.
let pendingFiles: Map<string, PendingFile> | null = null
let wholeResolve: ((source: FileSource) => void) | null = null
let wholeReject: ((err: Error) => void) | null = null

function requestWholeTransfer(reason: string): Promise<FileSource> {
  pendingFiles = new Map()
  const promise = new Promise<FileSource>((resolve, reject) => {
    wholeResolve = resolve
    wholeReject = reject
  })
  post({ type: 'requestBytes', reason })
  return promise
}

let probeResult: Promise<string | null> | null = null

/**
 * One HEAD + `Range: bytes=0-` against the loopback URL: 206 within 3 s
 * means the engine can read in parts. Resolves null on success, otherwise
 * why not (shown in the FR-015 notice).
 */
function probe(info: FileSourceInfo): Promise<string | null> {
  probeResult ??= (async () => {
    if (info.forceFallback) return 'forced by a test'
    if (!info.url) return info.serverError ?? 'no local file server'
    try {
      const res = await fetch(info.url, { method: 'HEAD', headers: { Range: 'bytes=0-' }, signal: AbortSignal.timeout(3000) })
      return res.status === 206 ? null : `the local file server answered ${res.status}`
    } catch {
      return 'the local file server is unreachable'
    }
  })()
  return probeResult
}

/** The whole file over the loopback server: one main-thread request each, no base64. */
async function fetchWhole(info: FileSourceInfo, url: string): Promise<FileSource> {
  const get = async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  const bytes = await get(url)
  const sidecars = await Promise.all(info.sidecars.map(async (s) => ({ name: s.name, bytes: await get(s.url) })))
  return { kind: 'bytes', name: info.name, size: bytes.byteLength, bytes, sidecars, styleSidecar: info.styleSidecar }
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
    sqlWasmUrl?: string
    placeSearchEnabled?: boolean
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
    assetsResolve?.({ workerUrl: msg.duckdbWorkerUrl, wasmUrl: msg.duckdbWasmUrl, sqlWasmUrl: msg.sqlWasmUrl })
    if (msg.placeSearchEnabled !== undefined) placeSearchEnabled = msg.placeSearchEnabled
    if (msg.maplibreWorkerUrl) maplibreWorkerUrlResolve?.(msg.maplibreWorkerUrl)
    if (msg.primaryFileUri) primaryFileUri = msg.primaryFileUri
    if (msg.primaryFileName && !primaryFileNameFromAssets) {
      primaryFileNameFromAssets = msg.primaryFileName
      primaryFileNameResolve?.(msg.primaryFileName)
    }
  } else if (msg.type === 'fileSource') {
    const info = event.data as FileSourceInfo
    if (info.testOverrides && Object.keys(info.testOverrides).length) setTestOverrides(info.testOverrides as TestOverrides)
    infoResolve?.(info)
  } else if (msg.type === 'initFileStart' && msg.fileName) {
    pendingFiles ??= new Map()
    pendingFiles.set(msg.fileName, { name: msg.fileName, isPrimary: !!msg.isPrimary, chunks: new Array(msg.chunkCount ?? 1) })
  } else if (msg.type === 'initFileChunk' && msg.fileName && msg.bytesBase64 !== undefined && msg.index !== undefined) {
    const pending = pendingFiles?.get(msg.fileName)
    if (pending) pending.chunks[msg.index] = msg.bytesBase64
  } else if (msg.type === 'initFilesDone') {
    if (pendingFiles && wholeResolve) {
      wholeResolve(bytesSource([...pendingFiles.values()].map((f) => ({ name: f.name, isPrimary: f.isPrimary, bytes: new Uint8Array(base64ToArrayBuffer(f.chunks.join(''))) }))))
    }
  } else if (msg.type === 'preferences') {
    placeSearchEnabled = msg.placeSearchEnabled
  } else if (msg.type === 'sourceChanged') {
    sourceChangedListeners.forEach((cb) => cb())
  } else if (msg.type === 'triggerError' && msg.message) {
    const err = new Error(msg.message)
    infoReject?.(err)
    wholeReject?.(err)
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
    getPreference(key: 'placeSearch.enabled'): boolean | undefined {
      return key === 'placeSearch.enabled' ? placeSearchEnabled : undefined
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
    async getFileSource(_ref: OpenedFileRef, options?: { whole?: boolean }): Promise<FileSource> {
      const info = await infoPromise
      if (options?.whole) {
        if ((await probe(info)) === null && info.url) {
          try {
            return await fetchWhole(info, info.url)
          } catch {
            // Fall through to the chunked transfer.
          }
        }
        return requestWholeTransfer('loading the whole file')
      }
      // Spec 007 research §3: the engine reads the loopback URL in parts.
      const failure = await probe(info)
      if (failure === null && info.url) return { kind: 'url', name: info.name, size: info.size, url: info.url, sidecars: info.sidecars, styleSidecar: info.styleSidecar }
      // FR-015: no partial reads in this window; read the whole file instead, and say why.
      const reason = failure ?? 'no local file server'
      const whole = await requestWholeTransfer(reason)
      return whole.kind === 'bytes' ? { ...whole, styleSidecar: info.styleSidecar, fallbackReason: `Partial reads aren't available in this window (${reason}).` } : whole
    },
    async readRange(_ref: OpenedFileRef, offset: number, length: number): Promise<Uint8Array> {
      // Main-thread Range reads of the resource URI work (research §3); workers' don't.
      const info = await infoPromise
      const res = await fetch(info.resourceUri, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } })
      if (res.status !== 206 && res.status !== 200) throw new Error(`Could not read the file (HTTP ${res.status}).`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      return res.status === 200 ? bytes.subarray(offset, offset + length) : bytes
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
/** Spec 007 T031: the drawn map view, for spatialExplorer._getMapView. */
export function reportMapViewState(state: unknown): void {
  post({ type: 'mapViewState', state })
}

/** Spec 007 T019: the open's phase and whole-file facts, for spatialExplorer._getOpenState. */
export function reportOpenState(state: unknown): void {
  post({ type: 'openState', state })
}

export function reportExportState(state: unknown): void {
  post({ type: 'exportState', state })
}

/** Resolved style for the extension's test hook (spec 003). */
export function reportStyleState(state: unknown): void {
  post({ type: 'styleState', state })
}

/** Spec 008 T026: the table's columns, filters and selection, for tests. */
export function reportTableState(state: unknown): void {
  post({ type: 'tableState', state })
}

/** One line in the "Spatial Explorer" output channel. */
export function logToHost(detail: string): void {
  post({ type: 'log', detail })
}

/** Test-only hook (T015) — see main.ts's `testSelectFeature` listener. */
export function reportSelectionChanged(id: string | number | null): void {
  post({ type: 'selectionChanged', id })
}
