import * as vscode from 'vscode'
import * as path from 'path'

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
  | { type: 'statusUpdate'; crs?: string; featureCount?: number; cursor?: { lon: number; lat: number } | null }
  | {
      type: 'loadStateChanged'
      loadState: string
      featureCount?: number
      invalidGeometryCount?: number
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
  | { type: 'loadState'; requestId: number; key: string }
  | { type: 'saveState'; requestId: number; key: string; value: unknown }
  | { type: 'saveFile'; requestId: number; name: string; text: string }
  | { type: 'saveSidecar'; requestId: number; name: string; text: string }
  | { type: 'pickTextFile'; requestId: number; title: string; extensions: string[] }

const CHUNK_BYTES = 32 * 1024 * 1024

/**
 * Latest reported load outcome. Exposed via the `spatialExplorer._getLoadState`
 * command so @vscode/test-electron integration tests can observe the
 * webview's result without being able to inspect its rendered DOM directly.
 */
let lastLoadState: {
  loadState: string
  featureCount?: number
  invalidGeometryCount?: number
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
}

class SpatialExplorerEditorProvider implements vscode.CustomReadonlyEditorProvider<SpatialExplorerDocument> {
  private panels = new Set<vscode.WebviewPanel>()
  private statusBarCrs: vscode.StatusBarItem
  private statusBarFeatureCount: vscode.StatusBarItem
  private statusBarCursor: vscode.StatusBarItem

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBarCrs = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 30)
    this.statusBarFeatureCount = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 29)
    this.statusBarCursor = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 28)
  }

  openCustomDocument(uri: vscode.Uri): SpatialExplorerDocument {
    return new SpatialExplorerDocument(uri)
  }

  async resolveCustomEditor(document: SpatialExplorerDocument, panel: vscode.WebviewPanel): Promise<void> {
    lastLoadState = null
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

    panel.onDidDispose(() => {
      watcher.dispose()
      this.panels.delete(panel)
      this.statusBarCrs.hide()
      this.statusBarFeatureCount.hide()
      this.statusBarCursor.hide()
    })
    // Status bar items belong to the active viewer: hide them when another
    // editor takes focus, restore them when this one comes back.
    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.statusBarCrs.text && this.statusBarCrs.show()
        this.statusBarFeatureCount.text && this.statusBarFeatureCount.show()
      } else if (![...this.panels].some((p) => p.active)) {
        this.statusBarCrs.hide()
        this.statusBarFeatureCount.hide()
        this.statusBarCursor.hide()
      }
    })

    const webviewRoot = vscode.Uri.file(path.join(this.context.extensionPath, 'dist-webview'))
    const documentDir = vscode.Uri.file(path.dirname(document.uri.fsPath))

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot, documentDir],
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
      } else if (msg.type === 'loadState') {
        // Global, not per-workspace: a preference like the blank basemap
        // color should follow the user to every file and window.
        void panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result: { value: this.context.globalState.get(`spatialExplorer.${msg.key}`) } })
      } else if (msg.type === 'saveState') {
        void this.context.globalState
          .update(`spatialExplorer.${msg.key}`, msg.value ?? undefined)
          .then(() => panel.webview.postMessage({ type: 'requestResult', requestId: msg.requestId, result: {} }))
      } else if (msg.type === 'reloadSource') {
        log(`Reloading ${path.posix.basename(document.uri.path)} after it changed on disk.`)
        lastLoadState = null
        panel.webview.html = this.getHtml(panel.webview, webviewRoot) + `<!-- ${Date.now()} -->`
      } else if (msg.type === 'selectionChanged') {
        lastSelection = msg.id
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
            { modal: true, detail: "QGIS loads this file as the layer's default style. Spatial Explorer writes a single-symbol style, so a categorized or graduated QGIS style in it would be replaced." },
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
      const uri = await vscode.window.showSaveDialog({ title: 'Export layer style', defaultUri: vscode.Uri.joinPath(dir, msg.name), filters })
      if (!uri) return void reply({ saved: false })
      await vscode.workspace.fs.writeFile(uri, content)
      return void reply({ saved: true, location: path.posix.basename(uri.path) })
    } catch (err) {
      return void reply({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  private updateStatusBar(
    panel: vscode.WebviewPanel,
    msg: { crs?: string; featureCount?: number; cursor?: { lon: number; lat: number } | null }
  ): void {
    if (!panel.active) return
    if (msg.crs) {
      this.statusBarCrs.text = `$(globe) ${msg.crs}`
      this.statusBarCrs.show()
    }
    if (msg.featureCount !== undefined) {
      this.statusBarFeatureCount.text = `$(list-flat) ${msg.featureCount.toLocaleString()} ${msg.featureCount === 1 ? 'feature' : 'features'}`
      this.statusBarFeatureCount.show()
    }
    if (msg.cursor) {
      this.statusBarCursor.text = `${msg.cursor.lat.toFixed(5)}, ${msg.cursor.lon.toFixed(5)}`
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
    const workerUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'duckdb', 'duckdb-browser-eh.worker.js'))
    const wasmUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'duckdb', 'duckdb-eh.wasm'))
    const maplibreWorkerUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'maplibre', 'maplibre-gl-worker.mjs'))
    const primaryName = path.basename(documentUri.fsPath)
    await panel.webview.postMessage({
      type: 'assets',
      duckdbWorkerUrl: workerUri.toString(),
      duckdbWasmUrl: wasmUri.toString(),
      maplibreWorkerUrl: maplibreWorkerUri.toString(),
      primaryFileName: primaryName,
    })

    try {
      const basename = primaryName.slice(0, primaryName.length - path.extname(primaryName).length)
      const dirUri = vscode.Uri.file(path.dirname(documentUri.fsPath))

      const filesToSend: Array<{ name: string; uri: vscode.Uri; isPrimary: boolean }> = [
        { name: primaryName, uri: documentUri, isPrimary: true },
      ]

      try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri)
        for (const [entryName] of entries) {
          if (entryName === primaryName) continue
          const entryBase = entryName.slice(0, entryName.length - path.extname(entryName).length)
          if (entryBase === basename) {
            filesToSend.push({ name: entryName, uri: vscode.Uri.joinPath(dirUri, entryName), isPrimary: false })
          }
        }
      } catch {
        // Folder-based or otherwise unlistable source — proceed with the primary file only.
      }

      for (const file of filesToSend) {
        const bytes = await vscode.workspace.fs.readFile(file.uri)
        await this.sendFile(panel, file.name, bytes, file.isPrimary)
      }

      await panel.webview.postMessage({ type: 'initFilesDone' })
    } catch (err) {
      await panel.webview.postMessage({
        type: 'triggerError',
        message: `Could not read "${path.basename(documentUri.fsPath)}": ${err instanceof Error ? err.message : String(err)}`,
      })
    }
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

  private getHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.css'))
    const csp = webview.cspSource

    // connect-src allows extensions.duckdb.org: T007/T009 found extension
    // loading bypasses JS-level fetch() entirely (handled inside the
    // compiled Emscripten/WASM runtime), so the spatial extension is loaded
    // from the real CDN rather than bundled locally — a considered, final
    // decision (research.md §3). Extend this list later for basemap
    // tile/style/sprite/glyph hosts per CLAUDE.md's basemap CSP notes
    // (spec 004). tiles.openfreemap.org serves every basemap resource in the
    // catalog (style JSON, vector + raster tiles, sprites, glyphs); a blocked
    // request degrades to blank + message (FR-016), never breaks the viewer.
    return `<!DOCTYPE html>
<html lang="en" data-theme="vscode">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'wasm-unsafe-eval' ${csp}; style-src ${csp} 'unsafe-inline'; worker-src ${csp} blob: data:; connect-src ${csp} https://extensions.duckdb.org https://tiles.openfreemap.org; img-src ${csp} data: blob: https://tiles.openfreemap.org; font-src ${csp};">
<link rel="stylesheet" href="${styleUri}">
<title>Spatial Explorer</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`
  }

  /** Test-only (T015): posts a testSelectFeature message to whichever panel is active. */
  testSelectFeature(id: string | number | null): void {
    const panel = [...this.panels].find((p) => p.active) ?? [...this.panels][0]
    void panel?.webview.postMessage({ type: 'testSelectFeature', id })
  }
}

/** Formats the 'default' editor claims; the rest open via the 'option' editor. */
const DEFAULT_EDITOR_EXTENSIONS = new Set(['.gpkg', '.fgb', '.flatgeobuf', '.shp', '.geoparquet'])

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Spatial Explorer')
  context.subscriptions.push(output)
  const provider = new SpatialExplorerEditorProvider(context)

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
    vscode.commands.registerCommand('spatialExplorer.openInViewer', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri
      if (!target) return
      const ext = path.posix.extname(target.path).toLowerCase()
      const viewType = DEFAULT_EDITOR_EXTENSIONS.has(ext) ? 'spatialExplorer.editor' : 'spatialExplorer.editorOption'
      await vscode.commands.executeCommand('vscode.openWith', target, viewType)
    }),
    vscode.commands.registerCommand('spatialExplorer._getLoadState', () => lastLoadState),
    vscode.commands.registerCommand('spatialExplorer._getViewState', () => lastViewState),
    vscode.commands.registerCommand('spatialExplorer._testSelectFeature', (id: string | number | null) => {
      lastSelection = null
      provider.testSelectFeature(id)
    }),
    vscode.commands.registerCommand('spatialExplorer._getSelection', () => lastSelection)
  )
}

export function deactivate(): void {}
