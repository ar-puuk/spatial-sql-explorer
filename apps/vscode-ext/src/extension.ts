import { createHash } from 'node:crypto'
import * as vscode from 'vscode'
import * as sourceServer from './sourceServer'
import * as path from 'path'
import * as fs from 'fs'
import { BASEMAP_HOSTS } from './basemapHosts.generated'
import { DEFAULT_CACHE_LIMIT_MB, GdbNodeReader, type GdbSource } from './gdbReader'
import type { GdbCatalog, GdbLayerInfo, GdbProgress } from '../../../packages/core/src/gdb/types'

// SpatialExplorerDocument — minimal CustomDocument wrapper. No in-memory
// model beyond the URI: DuckDB-WASM (inside the webview) owns the actual
// parsed file state. Read-only for spec 001 — no save/revert/backup needed.
class SpatialExplorerDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}
  dispose(): void {}
}

type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'log'; detail: string }
  | { type: 'showInfo'; message: string }
  | { type: 'statusUpdate'; crs?: string; featureCount?: number; countLabel?: 'features' | 'rows'; cursor?: { lon: number; lat: number; elevation?: number | null } | null; drawMode?: 'geojson' | 'tiles'; drawLoadAllAvailable?: boolean }
  | {
      type: 'loadStateChanged'
      loadState: string
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
  | { type: 'selectionChanged'; id: string | number | null }
  | { type: 'viewState'; basemapId: string; appearance: string; basemapNotice: string | null; sourceChanged: boolean }
  | { type: 'reloadSource' }
  | { type: 'requestBytes'; reason: string }
  | { type: 'openState'; state: unknown }
  | { type: 'mapViewState'; state: unknown }
  | { type: 'queryState'; state: unknown }
  | { type: 'styleState'; state: unknown }
  | { type: 'tableState'; state: unknown }
  | { type: 'exportState'; state: unknown }
  | { type: 'loadState'; requestId: number; key: string }
  | { type: 'engineFile'; requestId: number; name: string; url: string; sha256: string; refresh: boolean }
  | { type: 'gdbList'; requestId: number }
  | { type: 'gdbConvert'; requestId: number; layer: GdbLayerInfo }
  | { type: 'gdbCancel'; requestId: number }
  | { type: 'pruneEngineFiles'; keep: string[] }
  | { type: 'saveState'; requestId: number; key: string; value: unknown }
  | { type: 'getSecret'; requestId: number; name: string }
  | { type: 'listWorkspaceFiles'; requestId: number }
  | { type: 'resolveWorkspaceFiles'; requestId: number; paths: string[] }
  | { type: 'setSecret'; requestId: number; name: string; value: string | null }
  | { type: 'saveFile'; requestId: number; name: string; text: string }
  | { type: 'saveSidecar'; requestId: number; name: string; text: string }
  | { type: 'pickTextFile'; requestId: number; title: string; extensions: string[] }
  | { type: 'saveFileChunk'; transferId: number; index: number; count: number; bytesBase64: string }
  | { type: 'saveFileEnd'; requestId: number; transferId: number; name: string; kind: 'style' | 'data' | 'image'; totalBytes: number }

const CHUNK_BYTES = 32 * 1024 * 1024

/** Test hook (spec 005): the next data export is written here, without a dialog. */
let nextExportPath: string | null = null

/** Chunks of data exports in flight, per transfer (spec 005, contracts/host-and-ui.md). */
const pendingSaves = new Map<number, string[]>()

const DATA_FILTERS: Record<string, Record<string, string[]>> = {
  '.geojson': { GeoJSON: ['geojson', 'json'] },
  '.parquet': { Parquet: ['parquet'] },
  '.csv': { CSV: ['csv'] },
  // Spec 008 (US4, US7).
  '.geojsonl': { 'GeoJSON (newline-delimited)': ['geojsonl', 'geojsons', 'ndjson'] },
  '.fgb': { FlatGeobuf: ['fgb'] },
  '.gpkg': { GeoPackage: ['gpkg'] },
  '.zip': { 'Zipped Shapefile': ['zip'] },
  '.kml': { KML: ['kml'] },
  '.xlsx': { 'Excel workbook': ['xlsx'] },
  '.json': { JSON: ['json'] },
  '.png': { 'PNG image': ['png'] },
  '.pdf': { 'PDF document': ['pdf'] },
  '.svg': { 'SVG image': ['svg'] },
}

/**
 * Spec 008 (research §7–§8): hosts of the featured raster basemaps in
 * packages/core/src/basemapCatalog.ts (MapLibre fetches tiles, then decodes
 * them as images, so both connect-src and img-src). Keep in sync with the
 * catalog. Spec 010: the gallery's hosts are generated (BASEMAP_HOSTS).
 */
/** Spec 010: the only secrets a webview may read or write. */
const SECRET_NAME = /^basemapKey\.[a-z0-9-]+$/

const FEATURED_TILE_HOSTS = 'https://server.arcgisonline.com https://*.tile.opentopomap.org https://tile.openstreetmap.org'

/** Spec 014: the terrain DEM tiles (packages/core/src/terrain.ts TERRAIN_HOSTS). */
const TERRAIN_HOSTS = 'https://s3.amazonaws.com'

/** Spec 013: the File Geodatabase a document stands for (a .gdb folder is opened through a file inside it). */
function gdbSourceOf(uri: vscode.Uri): GdbSource | null {
  if (uri.scheme !== 'file') return null
  const lower = uri.fsPath.toLowerCase()
  if (lower.endsWith('.zip')) return { fsPath: uri.fsPath, zip: true }
  const folder = path.dirname(uri.fsPath)
  return folder.toLowerCase().endsWith('.gdb') ? { fsPath: folder, zip: false } : null
}

/** What the viewer calls the document: a geodatabase by its folder's name. */
function displayNameOf(uri: vscode.Uri): string {
  const gdb = gdbSourceOf(uri)
  return gdb && !gdb.zip ? path.basename(gdb.fsPath) : path.basename(uri.fsPath)
}

/** Spec 008: the setting the webview needs (contracts/host-and-shells.md). */
function placeSearchEnabled(): boolean {
  return vscode.workspace.getConfiguration('spatialExplorer').get<boolean>('placeSearch.enabled', true)
}

/**
 * Latest reported load outcome. Exposed via the `spatialExplorer._getLoadState`
 * command so @vscode/test-electron integration tests can observe the
 * webview's result without being able to inspect its rendered DOM directly.
 */
let lastLoadState: {
  loadState: string
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
} | null = null

/** Latest selection, same rationale as `lastLoadState` (T015). */
let lastSelection: string | number | null = null

/** Latest query state, same rationale (spec 002 test hooks). */
let lastQueryState: unknown = null
let lastStyleState: unknown = null
let lastTableState: unknown = null
let lastOpenState: unknown = null
let lastMapViewState: unknown = null
/** Spec 007 test hook: thresholds sent to the next viewers (see readModes TestOverrides). */
let testOverrides: Record<string, unknown> = {}
/** Spec 007 test hook: the next viewers are told partial reads failed. */
let forceBytesFallback = false
let lastExportState: unknown = null
/** Last logged lines (spec 002 T037: tests assert what reached the output channel). */
const recentLogLines: string[] = []

/** Latest basemap/theme state, same rationale (T039-T041 tests). */
let lastViewState: { basemapId: string; appearance: string; basemapNotice: string | null; sourceChanged: boolean } | null = null

/**
 * Query logs and timings (CLAUDE.md "VS Code integration"): one line per
 * open with format, counts, CRS and load time, plus errors and basemap
 * fallbacks. View > Output > Spatial Explorer.
 */
let output: vscode.OutputChannel | null = null
function log(line: string): void {
  output?.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`)
  recentLogLines.push(line)
  if (recentLogLines.length > 50) recentLogLines.shift()
}

// --- Spec 008 research §15: the SQL engine's local copy ---------------------
// The engine isn't shipped. Each file (DuckDB-WASM, its extensions, sql.js) is
// downloaded once by the extension host from its pinned URL (jsDelivr,
// extensions.duckdb.org, community-extensions.duckdb.org), checked against the SHA-256 the webview sends (from
// the build-time record), and kept in global storage, named by its hash. The
// webview reads it from there: offline after the first use.
const engineDir = (context: vscode.ExtensionContext): vscode.Uri => vscode.Uri.joinPath(context.globalStorageUri, 'engine')
const engineDownloads = new Map<string, Promise<vscode.Uri>>()
/** Test hook (_getEngineDownloads): the engine files downloaded in this session. */
const engineDownloadLog: string[] = []

async function ensureEngineFile(context: vscode.ExtensionContext, file: { name: string; url: string; sha256: string }, refresh: boolean): Promise<vscode.Uri> {
  if (!/^[0-9a-f]{64}$/.test(file.sha256) || !/^[\w.@-]+$/.test(file.name)) throw new Error('not an engine file')
  if (!/^https:\/\/(cdn\.jsdelivr\.net|extensions\.duckdb\.org|community-extensions\.duckdb\.org)\//.test(file.url)) throw new Error(`not an engine download URL: ${file.url}`)
  const target = vscode.Uri.joinPath(engineDir(context), `${file.sha256}-${file.name}`)
  if (!refresh) {
    try {
      await vscode.workspace.fs.stat(target)
      return target
    } catch {
      // not downloaded yet
    }
  }
  const running = engineDownloads.get(file.sha256)
  if (running && !refresh) return running
  const download = (async () => {
    const res = await fetch(file.url)
    if (!res.ok) throw new Error(`${new URL(file.url).host} answered ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const got = createHash('sha256').update(bytes).digest('hex')
    if (got !== file.sha256) throw new Error(`the download does not match the expected file (SHA-256 ${got.slice(0, 12)}…, expected ${file.sha256.slice(0, 12)}…)`)
    await vscode.workspace.fs.createDirectory(engineDir(context))
    // Written next to the target, then renamed: a half-written file never has the final name.
    const partial = vscode.Uri.joinPath(engineDir(context), `${file.sha256}-${file.name}.part`)
    await vscode.workspace.fs.writeFile(partial, bytes)
    await vscode.workspace.fs.rename(partial, target, { overwrite: true })
    engineDownloadLog.push(file.name)
    log(`SQL engine: downloaded ${file.name} (${(bytes.length / 1024 / 1024).toFixed(1)} MB) from ${new URL(file.url).host}`)
    return target
  })()
  engineDownloads.set(file.sha256, download)
  try {
    return await download
  } finally {
    engineDownloads.delete(file.sha256)
  }
}

async function pruneEngineFiles(context: vscode.ExtensionContext, keep: string[]): Promise<void> {
  let entries: Array<[string, vscode.FileType]>
  try {
    entries = await vscode.workspace.fs.readDirectory(engineDir(context))
  } catch {
    return
  }
  for (const [name] of entries) {
    const sha = name.slice(0, 64)
    if (!keep.includes(sha) && !engineDownloads.has(sha)) await vscode.workspace.fs.delete(vscode.Uri.joinPath(engineDir(context), name)).then(undefined, () => {})
  }
}

// --- Spec 010 phase 9: workspace files a query can name -------------------------

/** Data files a query can name (packages/core/src/sql/workspacePaths.ts WORKSPACE_DATA_EXTENSIONS). */
const WORKSPACE_GLOB = '**/*.{geojson,json,shp,gpkg,fgb,flatgeobuf,parquet,geoparquet,csv,tsv,gml,kml,gpx,sqlite,db,xlsx}'
const WORKSPACE_EXCLUDE = '**/{node_modules,.git,.venv,dist,out}/**'

/** The workspace folder holding the document, or the document's own folder. */
function workspaceRootOf(documentUri: vscode.Uri): vscode.Uri {
  return vscode.workspace.getWorkspaceFolder(documentUri)?.uri ?? vscode.Uri.joinPath(documentUri, '..')
}

/** The data files under the root, relative with '/', sorted, with sizes (at most 5,000). */
async function listWorkspaceFiles(documentUri: vscode.Uri): Promise<Array<{ path: string; size: number }>> {
  const root = workspaceRootOf(documentUri)
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, WORKSPACE_GLOB), WORKSPACE_EXCLUDE, 5000)
  const files = await Promise.all(
    uris.map(async (u) => {
      const rel = path.posix.relative(root.path, u.path)
      const size = await vscode.workspace.fs.stat(u).then((s) => s.size, () => 0)
      return { path: rel, size, ...(u.toString() === documentUri.toString() ? { open: true } : {}) }
    })
  )
  return files.filter((f) => f.path && !f.path.startsWith('..')).sort((a, b) => a.path.localeCompare(b.path))
}

/** A relative workspace path as an absolute file path inside the root, or null (absolute, `..`, backslashes, a scheme). */
export function resolveInside(rootFsPath: string, p: string): string | null {
  if (!p || p.includes('\\') || p.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null
  if (p.split('/').some((s) => s === '..')) return null
  const resolved = path.resolve(rootFsPath, p)
  return resolved.startsWith(rootFsPath.endsWith(path.sep) ? rootFsPath : rootFsPath + path.sep) ? resolved : null
}

let gdbReaderInstance: GdbNodeReader | null = null
/** The one geodatabase reader of this extension host (set in activate). */
function gdbReader(): GdbNodeReader {
  if (!gdbReaderInstance) throw new Error('The geodatabase reader is not ready.')
  return gdbReaderInstance
}

class SpatialExplorerEditorProvider implements vscode.CustomReadonlyEditorProvider<SpatialExplorerDocument> {
  private panels = new Set<vscode.WebviewPanel>()
  /** Spec 007: each viewer's loopback-server registration, and the files a whole-transfer fallback would send. */
  private sources = new Map<
    vscode.WebviewPanel,
    { token: string | null; urlBase?: string; documentUri: vscode.Uri; files: Array<{ name: string; uri: vscode.Uri; isPrimary: boolean }>; chunksSent: boolean }
  >()
  private statusBarCrs: vscode.StatusBarItem
  private statusBarFeatureCount: vscode.StatusBarItem
  private statusBarCursor: vscode.StatusBarItem
  /** Spec 010: how the map draws the result; in tiles mode, Load all. */
  private statusBarDraw: vscode.StatusBarItem

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBarCrs = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 30)
    this.statusBarFeatureCount = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 29)
    this.statusBarCursor = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 28)
    this.statusBarDraw = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 31)
  }

  openCustomDocument(uri: vscode.Uri): SpatialExplorerDocument {
    return new SpatialExplorerDocument(uri)
  }

  async resolveCustomEditor(document: SpatialExplorerDocument, panel: vscode.WebviewPanel): Promise<void> {
    lastLoadState = null
    lastOpenState = null
    lastMapViewState = null
    this.panels.add(panel)
    // Spec edge case: a file changed on disk must not be silently presented
    // as current. The webview shows a "changed on disk, Reload" banner.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), path.posix.basename(document.uri.path))
    )
    const notifyChanged = (): void => {
      void panel.webview.postMessage({ type: 'sourceChanged' })
    }
    watcher.onDidChange(notifyChanged)
    watcher.onDidCreate(notifyChanged)

    // Spec 010 phase 9: data files a query can name; the viewer's list follows the folder.
    const root = workspaceRootOf(document.uri)
    const dataWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, WORKSPACE_GLOB))
    let dataChanged: ReturnType<typeof setTimeout> | null = null
    const notifyData = (): void => {
      if (dataChanged) clearTimeout(dataChanged)
      dataChanged = setTimeout(() => void panel.webview.postMessage({ type: 'workspaceFilesChanged' }), 500)
    }
    dataWatcher.onDidCreate(notifyData)
    dataWatcher.onDidDelete(notifyData)

    panel.onDidDispose(() => {
      watcher.dispose()
      dataWatcher.dispose()
      if (dataChanged) clearTimeout(dataChanged)
      this.releaseSource(panel)
      this.panels.delete(panel)
      this.statusBarCrs.hide()
      this.statusBarFeatureCount.hide()
      this.statusBarCursor.hide()
      this.statusBarDraw.hide()
    })
    // Status bar items belong to the active viewer: hide them when another
    // editor takes focus, restore them when this one comes back.
    panel.onDidChangeViewState(() => {
      if (panel.active) {
        if (this.statusBarCrs.text) this.statusBarCrs.show()
        if (this.statusBarFeatureCount.text) this.statusBarFeatureCount.show()
        if (this.statusBarDraw.text) this.statusBarDraw.show()
      } else if (![...this.panels].some((p) => p.active)) {
        this.statusBarCrs.hide()
        this.statusBarFeatureCount.hide()
        this.statusBarCursor.hide()
        this.statusBarDraw.hide()
      }
    })

    const webviewRoot = vscode.Uri.file(path.join(this.context.extensionPath, 'dist-webview'))
    const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath))

    panel.webview.options = {
      enableScripts: true,
      // Spec 008 research §15: plus the engine's local copy.
      localResourceRoots: [webviewRoot, documentDir, engineDir(this.context)],
    }

    // Register the message listener BEFORE setting .html — if the webview
    // loads and posts 'ready' before a listener exists, that message is
    // lost with no error, no retry, and no visible symptom other than the
    // viewer silently never receiving a file (documented omx-viewer gotcha;
    // see contracts/host-webview-protocol.md).
    panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      if (msg.type === 'ready') {
        void this.sendAssetsAndFile(panel, webviewRoot, document.uri)
      } else if (msg.type === 'statusUpdate') {
        this.updateStatusBar(panel, msg)
      } else if (msg.type === 'loadStateChanged') {
        lastLoadState = {
          loadState: msg.loadState,
          featureCount: msg.featureCount,
          invalidGeometryCount: msg.invalidGeometryCount,
          rowCount: msg.rowCount,
          errorMessage: msg.errorMessage,
          sourceCrsLabel: msg.sourceCrsLabel,
          crsAssumed: msg.crsAssumed,
          extent: msg.extent,
          mapCanvasRect: msg.mapCanvasRect,
          renderedFeatureCount: msg.renderedFeatureCount,
          styleSource: msg.styleSource,
          loadMs: msg.loadMs,
          loadTimings: msg.loadTimings,
        }
      } else if (msg.type === 'viewState') {
        lastViewState = { basemapId: msg.basemapId, appearance: msg.appearance, basemapNotice: msg.basemapNotice, sourceChanged: msg.sourceChanged }
        if (msg.basemapNotice) log(`${path.posix.basename(document.uri.path)}: ${msg.basemapNotice}`)
      } else if (msg.type === 'engineFile') {
        const reply = (result: unknown) => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result })
        void ensureEngineFile(this.context, msg, msg.refresh).then(
          (uri) => reply({ uri: panel.webview.asWebviewUri(uri).toString() }),
          (err: unknown) => {
            log(`SQL engine: ${msg.name}: ${err instanceof Error ? err.message : String(err)}`)
            void reply({ error: err instanceof Error ? err.message : String(err) })
          }
        )
      } else if (msg.type === 'gdbList' || msg.type === 'gdbConvert') {
        void this.handleGdb(panel, document.uri, msg)
      } else if (msg.type === 'gdbCancel') {
        this.gdbAborts.get(msg.requestId)?.abort()
      } else if (msg.type === 'pruneEngineFiles') {
        void pruneEngineFiles(this.context, msg.keep)
      } else if (msg.type === 'loadState') {
        // Global, not per-workspace: a preference like the blank basemap
        // color should follow the user to every file and window.
        void panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result: { value: this.context.globalState.get(`spatialExplorer.${msg.key}`) } })
      } else if (msg.type === 'saveState') {
        void this.context.globalState
          .update(`spatialExplorer.${msg.key}`, msg.value ?? undefined)
          .then(() => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result: {} }))
      } else if (msg.type === 'listWorkspaceFiles') {
        void listWorkspaceFiles(document.uri).then(
          (files) => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result: { files } }),
          (err: unknown) => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result: { files: [], error: String(err) } })
        )
      } else if (msg.type === 'resolveWorkspaceFiles') {
        void this.resolveWorkspaceFiles(panel, document.uri, msg.paths).then((results) =>
          panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result: { results } })
        )
      } else if (msg.type === 'getSecret' || msg.type === 'setSecret') {
        void this.handleSecret(panel, msg)
      } else if (msg.type === 'queryState') {
        lastQueryState = msg.state
      } else if (msg.type === 'styleState') {
        lastStyleState = msg.state
      } else if (msg.type === 'tableState') {
        lastTableState = msg.state
      } else if (msg.type === 'exportState') {
        lastExportState = msg.state
      } else if (msg.type === 'requestBytes') {
        // Spec 007 FR-015: partial reads failed in this window; send the whole file.
        log(`${path.posix.basename(document.uri.path)}: reading the whole file (${msg.reason}).`)
        void this.sendWholeFile(panel)
      } else if (msg.type === 'openState') {
        lastOpenState = msg.state
      } else if (msg.type === 'mapViewState') {
        lastMapViewState = msg.state
      } else if (msg.type === 'reloadSource') {
        log(`Reloading ${path.posix.basename(document.uri.path)} after it changed on disk.`)
        lastLoadState = null
        panel.webview.html = this.getHtml(panel.webview, webviewRoot) + `<!-- ${Date.now()} -->`
      } else if (msg.type === 'selectionChanged') {
        lastSelection = msg.id
      } else if (msg.type === 'saveFileChunk') {
        const chunks = pendingSaves.get(msg.transferId) ?? new Array<string>(msg.count)
        chunks[msg.index] = msg.bytesBase64
        pendingSaves.set(msg.transferId, chunks)
      } else if (msg.type === 'saveFileEnd') {
        void this.handleDataSave(panel, document.uri, msg)
      } else if (msg.type === 'saveFile' || msg.type === 'saveSidecar' || msg.type === 'pickTextFile') {
        void this.handleFileRequest(panel, document.uri, msg)
      } else if (msg.type === 'showInfo') {
        void vscode.window.showInformationMessage(msg.message)
      } else if (msg.type === 'log') {
        log(msg.detail)
      }
    })

    panel.webview.html = this.getHtml(panel.webview, webviewRoot)
  }

  /**
   * Host side of the webview's style save/export/import requests
   * (HostAdapter.saveFile / saveSidecar / pickTextFile). Paths are resolved
   * relative to the document URI with Uri.joinPath, not fsPath, so this also
   * works on remote and virtual file systems.
   */
  private async handleFileRequest(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    msg: Extract<WebviewToHostMessage, { type: 'saveFile' | 'saveSidecar' | 'pickTextFile' }>
  ): Promise<void> {
    const reply = (result: unknown): Thenable<boolean> => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result })
    const dir = vscode.Uri.joinPath(documentUri, '..')
    const docName = path.posix.basename(documentUri.path)
    try {
      if (msg.type === 'pickTextFile') {
        const picked = await vscode.window.showOpenDialog({
          title: msg.title,
          defaultUri: dir,
          canSelectMany: false,
          filters: { 'Layer styles': msg.extensions.map((e) => e.replace(/^\./, '')), 'All files': ['*'] },
        })
        if (!picked?.[0]) return void reply(null)
        const bytes = await vscode.workspace.fs.readFile(picked[0])
        return void reply({ name: path.posix.basename(picked[0].path), text: new TextDecoder().decode(bytes) })
      }

      const content = new TextEncoder().encode(msg.text)
      if (msg.type === 'saveSidecar') {
        const target = vscode.Uri.joinPath(dir, msg.name)
        const exists = await vscode.workspace.fs.stat(target).then(
          () => true,
          () => false
        )
        if (exists) {
          const choice = await vscode.window.showWarningMessage(
            `"${msg.name}" already exists next to "${docName}". Replace it?`,
            { modal: true, detail: "QGIS loads this file as the layer's default style. Saving replaces the style in it with the current one." },
            'Replace'
          )
          if (choice !== 'Replace') return void reply({ saved: false })
        }
        await vscode.workspace.fs.writeFile(target, content)
        return void reply({ saved: true, location: msg.name })
      }

      const lower = msg.name.toLowerCase()
      const filters: Record<string, string[]> = lower.endsWith('.qml')
        ? { 'QGIS style': ['qml'] }
        : lower.endsWith('.sld')
          ? { 'OGC SLD': ['sld'] }
          : { 'Mapbox GL style': ['json'] }
      let uri: vscode.Uri | undefined
      if (nextExportPath) {
        // Test hook (spec 008 T012): no dialog.
        uri = vscode.Uri.file(nextExportPath)
        nextExportPath = null
      } else uri = await vscode.window.showSaveDialog({ title: 'Save layer style', defaultUri: vscode.Uri.joinPath(dir, msg.name), filters })
      if (!uri) return void reply({ saved: false })
      await vscode.workspace.fs.writeFile(uri, content)
      return void reply({ saved: true, location: path.posix.basename(uri.path) })
    } catch (err) {
      return void reply({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * Host side of a data export (spec 005): joins the chunks, asks where to
   * save (next to the source by default), refuses the source itself
   * (FR-012), and writes only once every byte has arrived, so a cancelled or
   * failed export never leaves a file (FR-010).
   */
  private async handleDataSave(
    panel: vscode.WebviewPanel,
    documentUri: vscode.Uri,
    msg: Extract<WebviewToHostMessage, { type: 'saveFileEnd' }>
  ): Promise<void> {
    const reply = (result: unknown): Thenable<boolean> => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result })
    const chunks = pendingSaves.get(msg.transferId) ?? []
    pendingSaves.delete(msg.transferId)
    try {
      const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c ?? '', 'base64')))
      if (bytes.length !== msg.totalBytes) throw new Error(`The export arrived incomplete (${bytes.length} of ${msg.totalBytes} bytes).`)
      let target: vscode.Uri | undefined
      if (nextExportPath) {
        target = vscode.Uri.file(nextExportPath)
        nextExportPath = null
      } else {
        const ext = path.posix.extname(msg.name).toLowerCase()
        target = await vscode.window.showSaveDialog({
          title: msg.kind === 'image' ? 'Save map' : 'Export data',
          defaultUri: vscode.Uri.joinPath(documentUri, '..', msg.name),
          filters: DATA_FILTERS[ext] ?? { 'All files': ['*'] },
        })
      }
      if (!target) return void reply({ saved: false })
      const same = process.platform === 'win32' ? target.toString().toLowerCase() === documentUri.toString().toLowerCase() : target.toString() === documentUri.toString()
      if (same) return void reply({ saved: false, error: 'Choose a different file: this is the opened source.' })
      await vscode.workspace.fs.writeFile(target, bytes)
      log(`[export] saved ${target.fsPath} (${bytes.length.toLocaleString()} bytes)`)
      return void reply({ saved: true, location: path.posix.basename(target.path) })
    } catch (err) {
      return void reply({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  private updateStatusBar(
    panel: vscode.WebviewPanel,
    msg: { crs?: string; featureCount?: number; countLabel?: 'features' | 'rows'; cursor?: { lon: number; lat: number; elevation?: number | null } | null; drawMode?: 'geojson' | 'tiles'; drawLoadAllAvailable?: boolean }
  ): void {
    if (!panel.active) return
    if (msg.drawMode) {
      const tiles = msg.drawMode === 'tiles'
      this.statusBarDraw.text = tiles ? '$(layers) Tiles · Load all' : '$(layers) All drawn'
      this.statusBarDraw.tooltip = tiles
        ? 'Over 100,000 features: drawn from tiles the engine builds as you move. Load all draws every feature at once (slower to open, then no work while panning).'
        : 'Every feature is drawn from memory: panning needs no engine work.'
      this.statusBarDraw.command = tiles && msg.drawLoadAllAvailable !== false ? 'spatialExplorer.loadAll' : undefined
      this.statusBarDraw.show()
    }
    if (msg.crs) {
      this.statusBarCrs.text = `$(globe) ${msg.crs}`
      this.statusBarCrs.show()
    }
    if (msg.featureCount !== undefined) {
      const unit = msg.countLabel === 'rows' ? (msg.featureCount === 1 ? 'row' : 'rows') : msg.featureCount === 1 ? 'feature' : 'features'
      this.statusBarFeatureCount.text = `$(list-flat) ${msg.featureCount.toLocaleString()} ${unit}`
      this.statusBarFeatureCount.show()
    }
    if (msg.cursor) {
      this.statusBarCursor.text = `${msg.cursor.lat.toFixed(5)}, ${msg.cursor.lon.toFixed(5)}${typeof msg.cursor.elevation === 'number' ? ` · ${Math.round(msg.cursor.elevation).toLocaleString('en-US')} m` : ''}`
      this.statusBarCursor.show()
    } else if (msg.cursor === null) {
      this.statusBarCursor.hide()
    }
  }

  /**
   * Sends the webview everything it needs: the DuckDB-WASM asset URIs
   * (T005's proven approach — webview.asWebviewUri(), not
   * `new URL(..., import.meta.url)`), then the opened document's bytes plus
   * any same-basename sidecar files discovered next to it (Shapefile needs
   * `.shx`/`.dbf`/`.prj` — see contracts/host-adapter.md's multi-file
   * `FileSource`), via the initFileStart/initFileChunk/initFilesDone
   * protocol (contracts/host-webview-protocol.md).
   */
  private async sendAssetsAndFile(panel: vscode.WebviewPanel, webviewRoot: vscode.Uri, documentUri: vscode.Uri): Promise<void> {
    // Spec 008 research §15: the SQL engine isn't shipped; the webview downloads it (hash-checked).
    const maplibreWorkerUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'maplibre', 'maplibre-gl-worker.mjs'))
    const primaryName = path.basename(documentUri.fsPath)
    panel.title = displayNameOf(documentUri)
    await panel.webview.postMessage({
      type: 'assets',
      maplibreWorkerUrl: maplibreWorkerUri.toString(),
      placeSearchEnabled: placeSearchEnabled(),
      primaryFileName: displayNameOf(documentUri),
      // Stable per-file key for persisted webview state (spec 002 history).
      primaryFileUri: documentUri.toString(),
    })

    try {
      const basename = primaryName.slice(0, primaryName.length - path.extname(primaryName).length)
      const dirUri = vscode.Uri.file(path.dirname(documentUri.fsPath))

      const files: Array<{ name: string; uri: vscode.Uri; isPrimary: boolean }> = [{ name: primaryName, uri: documentUri, isPrimary: true }]
      try {
        if (gdbSourceOf(documentUri)?.zip === false) throw new Error('a geodatabase table file has no sidecars')
        const entries = await vscode.workspace.fs.readDirectory(dirUri)
        for (const [entryName] of entries) {
          if (entryName === primaryName) continue
          const entryBase = entryName.slice(0, entryName.length - path.extname(entryName).length)
          if (entryBase === basename) files.push({ name: entryName, uri: vscode.Uri.joinPath(dirUri, entryName), isPrimary: false })
        }
      } catch {
        // Folder-based or otherwise unlistable source — proceed with the primary file only.
      }

      // The QGIS style sidecar travels as text; other style files are never data.
      const isStyle = (name: string): boolean => /\.(qml|sld)$/i.test(name)
      const style = files.find((f) => !f.isPrimary && f.name.toLowerCase() === `${basename}.qml`.toLowerCase())
      const styleSidecar = style ? { fileName: style.name, text: new TextDecoder().decode(await vscode.workspace.fs.readFile(style.uri)) } : null
      const dataSidecars = files.filter((f) => !f.isPrimary && !isStyle(f.name))

      // Spec 007 (research §3): serve the file from the loopback range server;
      // the engine reads it in parts. The webview probes the URL and asks for
      // the whole file (requestBytes) only if that fails.
      this.releaseSource(panel)
      const size = (await vscode.workspace.fs.stat(documentUri)).size
      let token: string | null = null
      let urlBase: string | undefined
      let url: string | null = null
      let sidecars: Array<{ name: string; url: string }> = []
      let serverError: string | null = null
      if (documentUri.scheme === 'file') {
        try {
          const reg = await sourceServer.register(documentUri.fsPath, dataSidecars.map((f) => f.uri.fsPath))
          token = reg.token
          url = reg.urlFor(primaryName)
          urlBase = url.slice(0, url.lastIndexOf('/'))
          sidecars = dataSidecars.map((f) => ({ name: f.name, url: reg.urlFor(f.name) }))
        } catch (err) {
          serverError = err instanceof Error ? err.message : String(err)
        }
      } else {
        serverError = `files from ${documentUri.scheme}: can't be served locally`
      }
      this.sources.set(panel, { token, urlBase, documentUri, files, chunksSent: false })
      await panel.webview.postMessage({
        type: 'fileSource',
        name: primaryName,
        size,
        url,
        sidecars,
        styleSidecar,
        resourceUri: panel.webview.asWebviewUri(documentUri).toString(),
        forceFallback: forceBytesFallback,
        serverError,
        testOverrides,
      })
    } catch (err) {
      await panel.webview.postMessage({
        type: 'triggerError',
        message: `Could not read "${path.basename(documentUri.fsPath)}": ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  /** The whole-file transfer (spec 001's protocol): the fallback when partial reads fail, and FlatGeobuf "load for queries". */
  private async sendWholeFile(panel: vscode.WebviewPanel): Promise<void> {
    const source = this.sources.get(panel)
    if (!source) return
    try {
      for (const file of source.files) {
        const bytes = await vscode.workspace.fs.readFile(file.uri)
        await this.sendFile(panel, file.name, bytes, file.isPrimary)
      }
      source.chunksSent = true
      await panel.webview.postMessage({ type: 'initFilesDone' })
    } catch (err) {
      await panel.webview.postMessage({
        type: 'triggerError',
        message: `Could not read "${path.basename(source.documentUri.fsPath)}": ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  /** Stops serving a viewer's file, logging how much of it was read (spec 007). */
  private releaseSource(panel: vscode.WebviewPanel): void {
    const source = this.sources.get(panel)
    if (!source?.token) return
    const stats = sourceServer.release(source.token)
    source.token = null
    if (stats) {
      const mb = (n: number): string => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)
      log(`${path.posix.basename(source.documentUri.path)}: read ${mb(stats.bytes)} MB of ${mb(stats.size)} MB in ${stats.requests} requests.`)
    }
  }

  /** Test hook (spec 008 T066): the CSP of the active viewer's page. */
  activeCsp(): string | null {
    const panel = [...this.panels].find((p) => p.active) ?? [...this.panels][0]
    return panel ? (/http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(panel.webview.html)?.[1] ?? null) : null
  }

  /** Spec 008: tells every open viewer about a changed setting. */
  postPreferences(): void {
    for (const panel of this.panels) void panel.webview.postMessage({ type: 'preferences', placeSearchEnabled: placeSearchEnabled() })
  }

  /** Test hook (spec 007): the active viewer's bytes served, and whether a whole transfer was sent. */
  sourceStats(): { bytes: number; requests: number; size: number; chunksSent: boolean } | null {
    const panel = [...this.panels].find((p) => p.active) ?? [...this.panels][0]
    const source = panel ? this.sources.get(panel) : undefined
    if (!source) return null
    const stats = source.token ? sourceServer.statsFor(source.token) : undefined
    return { bytes: stats?.bytes ?? 0, requests: stats?.requests ?? 0, size: stats?.size ?? 0, chunksSent: source.chunksSent }
  }

  private async sendFile(panel: vscode.WebviewPanel, fileName: string, bytes: Uint8Array, isPrimary: boolean): Promise<void> {
    const totalBytes = bytes.byteLength
    const chunkCount = Math.max(1, Math.ceil(totalBytes / CHUNK_BYTES))
    await panel.webview.postMessage({ type: 'initFileStart', fileName, totalBytes, chunkCount, isPrimary })
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_BYTES
      const end = Math.min(start + CHUNK_BYTES, totalBytes)
      const chunkBase64 = Buffer.from(bytes.buffer, bytes.byteOffset + start, end - start).toString('base64')
      await panel.webview.postMessage({ type: 'initFileChunk', fileName, index: i, bytesBase64: chunkBase64 })
    }
  }

  /**
   * Spec 010 phase 9: serves the workspace files a query names, under the
   * viewer's token, as `ws/<path>` (and their same-basename sidecars).
   */
  private async resolveWorkspaceFiles(panel: vscode.WebviewPanel, documentUri: vscode.Uri, paths: string[]): Promise<unknown[]> {
    const root = workspaceRootOf(documentUri)
    const token = this.sources.get(panel)?.token ?? null
    const out: unknown[] = []
    for (const p of paths) {
      if (root.scheme !== 'file' || !token) {
        out.push({ path: p, error: "Joining workspace files needs local file access, which this window doesn't have." })
        continue
      }
      const resolved = resolveInside(root.fsPath, p)
      if (!resolved) {
        out.push({ path: p, error: `"${p}" is not a path inside the workspace.` })
        continue
      }
      let size: number
      try {
        const stat = fs.statSync(resolved)
        if (!stat.isFile()) throw new Error('not a file')
        size = stat.size
      } catch {
        out.push({ path: p, error: `"${p}" was not found in the workspace (${path.basename(root.fsPath)}).`, missing: true })
        continue
      }
      const dir = path.dirname(resolved)
      const base = path.basename(resolved, path.extname(resolved))
      const relDir = path.posix.dirname(p) === '.' ? '' : `${path.posix.dirname(p)}/`
      let sidecars: string[] = []
      try {
        sidecars = fs
          .readdirSync(dir)
          .filter((n) => n !== path.basename(resolved) && path.basename(n, path.extname(n)) === base && !/\.(qml|sld)$/i.test(n))
      } catch {
        // The primary file alone.
      }
      const name = `ws/${p}`
      try {
        sourceServer.addFiles(token, [{ name, fsPath: resolved }, ...sidecars.map((s) => ({ name: `ws/${relDir}${s}`, fsPath: path.join(dir, s) }))])
      } catch (err) {
        out.push({ path: p, error: err instanceof Error ? err.message : String(err) })
        continue
      }
      const reg = { urlFor: (n: string) => this.sourceUrl(panel, n) }
      out.push({
        path: p,
        source: {
          kind: 'url',
          name,
          size,
          url: reg.urlFor(name),
          sidecars: sidecars.map((s) => ({ name: `ws/${relDir}${s}`, url: reg.urlFor(`ws/${relDir}${s}`) })),
          styleSidecar: null,
        },
      })
    }
    return out
  }

  /** Spec 013: requests in flight, so the webview's Cancel can stop one. */
  private gdbAborts = new Map<number, AbortController>()
  /** The catalog of each geodatabase listed in this window (convert needs its domains). */
  private gdbCatalogs = new Map<string, GdbCatalog>()

  /** Lists a geodatabase's layers, or converts one layer into the cache and serves it to the webview. */
  private async handleGdb(panel: vscode.WebviewPanel, documentUri: vscode.Uri, msg: Extract<WebviewToHostMessage, { type: 'gdbList' | 'gdbConvert' }>): Promise<void> {
    const reply = (result: unknown): Thenable<boolean> => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result })
    const progress = (step: GdbProgress): void => void panel.webview.postMessage({ type: 'gdbProgress', requestId: msg.requestId, step })
    const abort = new AbortController()
    this.gdbAborts.set(msg.requestId, abort)
    try {
      const source = gdbSourceOf(documentUri)
      if (!source) return void reply({ error: 'This geodatabase is not on a disk this window can read.', code: 'unreadable' })
      const name = displayNameOf(documentUri)
      const reader = gdbReader()
      const catalog = this.gdbCatalogs.get(source.fsPath) ?? (await reader.list(source, name, { signal: abort.signal, onProgress: progress }))
      this.gdbCatalogs.set(source.fsPath, catalog)
      if (msg.type === 'gdbList') return void reply({ catalog })
      const layer = catalog.layers.find((l) => l.name === msg.layer.name)
      if (!layer) return void reply({ error: `The layer "${msg.layer.name}" is not in this geodatabase.`, code: 'unreadable' })
      const converted = await reader.convert(source, catalog, layer, { signal: abort.signal, onProgress: progress })
      const token = this.sources.get(panel)?.token
      if (!token) return void reply({ error: "This window can't serve files to the viewer, so the geodatabase can't be shown.", code: 'unreadable' })
      const served = `gdb/${path.basename(converted.path)}`
      sourceServer.addFiles(token, [{ name: served, fsPath: converted.path }])
      return void reply({ name: path.basename(converted.path), size: converted.size, url: this.sourceUrl(panel, served), domains: converted.domains })
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unreadable'
      log(`geodatabase: ${err instanceof Error ? err.message : String(err)}`)
      return void reply({ error: err instanceof Error ? err.message : String(err), code })
    } finally {
      this.gdbAborts.delete(msg.requestId)
    }
  }

  /** The URL of a file served under a viewer's token. */
  private sourceUrl(panel: vscode.WebviewPanel, name: string): string {
    const base = this.sources.get(panel)?.urlBase ?? ''
    return `${base}/${encodeURIComponent(name)}`
  }

  /** Spec 010: basemap API keys in SecretStorage; only `basemapKey.<provider>` names. */
  private async handleSecret(panel: vscode.WebviewPanel, msg: Extract<WebviewToHostMessage, { type: 'getSecret' | 'setSecret' }>): Promise<void> {
    const reply = (result: unknown): Thenable<boolean> => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result })
    if (!SECRET_NAME.test(msg.name)) {
      await reply({ error: `Not a basemap key name: ${msg.name}` })
      return
    }
    const key = `spatialExplorer.${msg.name}`
    try {
      if (msg.type === 'getSecret') {
        await reply({ value: await this.context.secrets.get(key) })
      } else {
        if (msg.value) await this.context.secrets.store(key, msg.value)
        else await this.context.secrets.delete(key)
        await reply({})
      }
    } catch (err) {
      await reply({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  private getHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.css'))
    const csp = webview.cspSource

    // connect-src: the SQL engine is downloaded by the extension host (spec 008
    // research §15) and read from its local copy (${csp}), so the webview never
    // contacts jsDelivr or extensions.duckdb.org; `blob:` is how the worker
    // reads the verified extension bytes. Extend this
    // list for basemap tile/style/sprite/glyph hosts per CLAUDE.md's basemap
    // CSP notes
    // (spec 004). tiles.openfreemap.org serves every basemap resource in the
    // catalog (style JSON, vector + raster tiles, sprites, glyphs); a blocked
    // request degrades to blank + message (FR-016), never breaks the viewer.
    return `<!DOCTYPE html>
<html lang="en" data-theme="vscode"${this.context.extensionMode === vscode.ExtensionMode.Production ? '' : ' data-se-test-hooks'}>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'wasm-unsafe-eval' ${csp}; style-src ${csp} 'unsafe-inline'; worker-src ${csp} blob: data:; connect-src ${csp} blob: http://localhost.:* https://tiles.openfreemap.org ${FEATURED_TILE_HOSTS} ${BASEMAP_HOSTS} ${TERRAIN_HOSTS} https://nominatim.openstreetmap.org; img-src ${csp} data: blob: https://tiles.openfreemap.org ${FEATURED_TILE_HOSTS} ${BASEMAP_HOSTS} ${TERRAIN_HOSTS}; font-src ${csp};">
<link rel="stylesheet" href="${styleUri}">
<title>Spatial Explorer</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`
  }

  /**
   * Spec 005 FR-013: opens the export dialog in the ACTIVE viewer (never another
   * one). Returns false, after a short message, when no viewer is active.
   */
  openExportInActive(): boolean {
    const panel = [...this.panels].find((p) => p.active)
    if (!panel) {
      void vscode.window.showInformationMessage('Open a file in Spatial Explorer to export its data.')
      return false
    }
    void panel.webview.postMessage({ type: 'openExport' })
    return true
  }

  /** Test-only: posts a message to whichever viewer is active (or the only one). */
  postToActive(message: unknown): void {
    const panel = [...this.panels].find((p) => p.active) ?? [...this.panels][0]
    void panel?.webview.postMessage(message)
  }

  /** Test-only (T015): posts a testSelectFeature message to whichever panel is active. */
  testSelectFeature(id: string | number | null): void {
    const panel = [...this.panels].find((p) => p.active) ?? [...this.panels][0]
    void panel?.webview.postMessage({ type: 'testSelectFeature', id })
  }
}

/** Formats the 'default' editor claims; the rest open via the 'option' editor. */
const DEFAULT_EDITOR_EXTENSIONS = new Set(['.gpkg', '.fgb', '.flatgeobuf', '.shp', '.geoparquet'])

/**
 * Files passed on the command line at launch (`code parcels.gpkg`) are
 * opened before extension contributions are registered, so VS Code shows its
 * "binary file" text editor even for formats this extension claims as the
 * default editor. Confirmed with an installed VSIX (research.md §10). Once,
 * at startup, reopen those tabs in Spatial Explorer in the same group. Only
 * the binary default formats are touched: the text editor can't show them,
 * whereas a GeoJSON or CSV in a text tab may be exactly what the user wanted.
 */
async function reopenBinaryTabsFromStartup(): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputText)) continue
      const uri = tab.input.uri
      if (!DEFAULT_EDITOR_EXTENSIONS.has(path.posix.extname(uri.path).toLowerCase())) continue
      await vscode.commands.executeCommand('vscode.openWith', uri, 'spatialExplorer.editor', { viewColumn: group.viewColumn, preserveFocus: !tab.isActive })
      await vscode.window.tabGroups.close(tab)
    }
  }
}

/** What `activate` exposes; tests reach the loopback server through it (source-server.test.ts). */
export interface ExtensionApi {
  sourceServerForTests: Pick<typeof sourceServer, 'register' | 'release' | 'isListening' | 'addFiles'>
  resolveInsideForTests: typeof resolveInside
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  output = vscode.window.createOutputChannel('Spatial Explorer')
  context.subscriptions.push(output)
  const provider = new SpatialExplorerEditorProvider(context)
  // Spec 013: File Geodatabases. The reader's files come from the same pinned downloads as the SQL engine.
  gdbReaderInstance = new GdbNodeReader(
    path.join(context.globalStorageUri.fsPath, 'gdb-cache'),
    async (file) => ({ fsPath: (await ensureEngineFile(context, file, false)).fsPath, fresh: false }),
    () => Math.max(256, vscode.workspace.getConfiguration('spatialExplorer').get<number>('gdb.cacheLimitMB', DEFAULT_CACHE_LIMIT_MB)) * 1024 * 1024,
    log
  )
  context.subscriptions.push({ dispose: () => gdbReaderInstance?.stop() })
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('spatialExplorer.placeSearch.enabled')) provider.postPreferences()
    })
  )
  void reopenBinaryTabsFromStartup().catch((err) => log(`Could not reopen startup tabs: ${String(err)}`))

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('spatialExplorer.editor', provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.window.registerCustomEditorProvider('spatialExplorer.editorOption', provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    // Explorer / editor-tab context menu (CLAUDE.md): "Open in Spatial Explorer".
    // Spec 008 US8 (FR-032): the bundled sample, no workspace file needed. It is
    // copied to the extension's own storage first: the install folder may be
    // read-only, and exports and styles are saved next to the data.
    vscode.commands.registerCommand('spatialExplorer.openSample', async () => {
      const source = vscode.Uri.joinPath(context.extensionUri, 'sample', 'us-counties.parquet')
      const dir = vscode.Uri.joinPath(context.globalStorageUri, 'sample')
      const target = vscode.Uri.joinPath(dir, 'us-counties.parquet')
      try {
        await vscode.workspace.fs.stat(target)
      } catch {
        await vscode.workspace.fs.createDirectory(dir)
        await vscode.workspace.fs.copy(source, target, { overwrite: true })
      }
      await vscode.commands.executeCommand('vscode.openWith', target, 'spatialExplorer.editorOption')
    }),
    vscode.commands.registerCommand('spatialExplorer.openInViewer', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri
      if (!target) return
      const ext = path.posix.extname(target.path).toLowerCase()
      if (ext === '.gdb') {
        // Spec 013: a File Geodatabase is a folder, which a custom editor cannot open: open a table file inside it.
        let marker: vscode.Uri | undefined
        try {
          const entries = await vscode.workspace.fs.readDirectory(target)
          const tables = entries.filter(([n, t]) => t === vscode.FileType.File && /^a[0-9a-f]{8}\.gdbtable$/i.test(n)).map(([n]) => n)
          marker = vscode.Uri.joinPath(target, tables.find((n) => n.toLowerCase() === 'a00000001.gdbtable') ?? tables[0] ?? '')
          if (!tables.length) marker = undefined
        } catch {
          marker = undefined
        }
        if (!marker) {
          void vscode.window.showWarningMessage(`"${path.basename(target.fsPath)}" doesn't look like a File Geodatabase: it holds no table files (a0000000N.gdbtable).`)
          return
        }
        await vscode.commands.executeCommand('vscode.openWith', marker, 'spatialExplorer.editorOption')
        return
      }
      const viewType = DEFAULT_EDITOR_EXTENSIONS.has(ext) ? 'spatialExplorer.editor' : 'spatialExplorer.editorOption'
      await vscode.commands.executeCommand('vscode.openWith', target, viewType)
    }),
    vscode.commands.registerCommand('spatialExplorer._getLoadState', () => lastLoadState),
    vscode.commands.registerCommand('spatialExplorer.clearGdbCache', () => {
      const removed = gdbReader().clearCache()
      void vscode.window.showInformationMessage(removed.files ? `Cleared the geodatabase cache (${(removed.bytes / 1024 / 1024).toFixed(0)} MB).` : 'The geodatabase cache is empty.')
    }),
    // Spec 008 T066: the active viewer's Content-Security-Policy.
    vscode.commands.registerCommand('spatialExplorer._getCsp', () => provider.activeCsp()),
    vscode.commands.registerCommand('spatialExplorer._getViewState', () => lastViewState),
    // Spec 002 test hooks: drive and observe queries in the active viewer.
    vscode.commands.registerCommand('spatialExplorer._runQuery', (sql: string) =>
      provider.postToActive({ type: 'testRunQuery', sql })
    ),
    vscode.commands.registerCommand('spatialExplorer.exportData', () => provider.openExportInActive()),
    vscode.commands.registerCommand('spatialExplorer._cancelOpen', () => provider.postToActive({ type: 'testCancelOpen' })),
    vscode.commands.registerCommand('spatialExplorer._cancelQuery', () => provider.postToActive({ type: 'testCancelQuery' })),
    vscode.commands.registerCommand('spatialExplorer._getQueryState', () => lastQueryState),
    // Spec 003 test hooks: read the resolved style, apply a style, save it.
    vscode.commands.registerCommand('spatialExplorer._getStyleState', () => lastStyleState),
    // Spec 008 T026: table columns, filters and selection.
    vscode.commands.registerCommand('spatialExplorer._getTableState', () => lastTableState),
    vscode.commands.registerCommand('spatialExplorer._setFilter', (column: string, filter: unknown) => provider.postToActive({ type: 'testSetFilter', column, filter })),
    vscode.commands.registerCommand('spatialExplorer._switchLayer', (name: string) => provider.postToActive({ type: 'testSwitchLayer', column: name })),
    vscode.commands.registerCommand('spatialExplorer._setHiddenColumns', (hidden: string[]) => provider.postToActive({ type: 'testSetHiddenColumns', hidden })),
    // Spec 005 test hooks: run an export, read its state.
    vscode.commands.registerCommand('spatialExplorer._runExport', (request: unknown) => provider.postToActive({ type: 'testRunExport', request })),
    vscode.commands.registerCommand('spatialExplorer._getExportState', () => lastExportState),
    // Spec 007 test hooks: bytes served per viewer, a forced whole-transfer fallback, the open state.
    vscode.commands.registerCommand('spatialExplorer._getSourceStats', () => provider.sourceStats()),
    vscode.commands.registerCommand('spatialExplorer._forceBytesFallback', (on: boolean) => {
      forceBytesFallback = on
    }),
    vscode.commands.registerCommand('spatialExplorer._getOpenState', () => lastOpenState),
    // Spec 007 test hooks: thresholds for the next viewers (cap…), the drawn map view, the camera.
    vscode.commands.registerCommand('spatialExplorer._setTestOverrides', (o: Record<string, unknown> | null) => {
      testOverrides = o ?? {}
    }),
    vscode.commands.registerCommand('spatialExplorer._getMapView', () => lastMapViewState),
    // Spec 010: the status bar's Load all (hidden from the palette: it acts on the active viewer).
    vscode.commands.registerCommand('spatialExplorer.loadAll', () => provider.postToActive({ type: 'loadAll' })),
    vscode.commands.registerCommand('spatialExplorer._jumpTo', (lon: number, lat: number, zoom: number) => provider.postToActive({ type: 'testJumpTo', lon, lat, zoom })),

    // Spec 005 test hook: write the next data export to this path (no dialog).
    vscode.commands.registerCommand('spatialExplorer._saveNextExportTo', (fsPath: string) => {
      nextExportPath = fsPath
    }),
    vscode.commands.registerCommand('spatialExplorer._setStyle', (style: unknown) => provider.postToActive({ type: 'testSetStyle', style })),
    vscode.commands.registerCommand('spatialExplorer._saveStyle', () => provider.postToActive({ type: 'testSaveStyle' })),
    // Spec 008 T012: the Save button's menu (pair with _saveNextExportTo for formats other than the sidecar).
    vscode.commands.registerCommand('spatialExplorer._saveStyleAs', (format: string) => provider.postToActive({ type: 'testSaveStyleAs', format })),
    // Spec 008 US7 T081: export the map image (pair with _saveNextExportTo).
    vscode.commands.registerCommand('spatialExplorer._exportMapImage', (scale: number, format?: string, paper?: string, title?: string, furniture?: boolean) =>
      provider.postToActive({ type: 'testExportMapImage', scale, format, paper, title, furniture })
    ),
    vscode.commands.registerCommand('spatialExplorer._getLogLines', () => [...recentLogLines]),
    // Spec 008 research §15: where the engine's local copy lives, and what was downloaded this session.
    vscode.commands.registerCommand('spatialExplorer._getEngineDownloads', () => ({ dir: engineDir(context).fsPath, downloaded: [...engineDownloadLog] })),
    vscode.commands.registerCommand('spatialExplorer._testSelectFeature', (id: string | number | null) => {
      lastSelection = null
      provider.testSelectFeature(id)
    }),
    vscode.commands.registerCommand('spatialExplorer._getSelection', () => lastSelection)
  )
  return {
    sourceServerForTests: { register: sourceServer.register, release: sourceServer.release, isListening: sourceServer.isListening, addFiles: sourceServer.addFiles },
    resolveInsideForTests: resolveInside,
  }
}

export function deactivate(): void {}
