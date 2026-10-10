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
    }
  | { type: 'selectionChanged'; id: string | number | null }

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
} | null = null

/** Latest selection, same rationale as `lastLoadState` (T015). */
let lastSelection: string | number | null = null

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
    panel.onDidDispose(() => {
      this.panels.delete(panel)
      this.statusBarCrs.hide()
      this.statusBarFeatureCount.hide()
      this.statusBarCursor.hide()
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
        }
      } else if (msg.type === 'selectionChanged') {
        lastSelection = msg.id
      } else if (msg.type === 'showInfo') {
        void vscode.window.showInformationMessage(msg.message)
      } else if (msg.type === 'log') {
        console.log('[spatial-explorer webview]', msg.detail)
      }
    })

    panel.webview.html = this.getHtml(panel.webview, webviewRoot)
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
      this.statusBarFeatureCount.text = `$(list-flat) ${msg.featureCount.toLocaleString()} features`
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
    const primaryName = path.basename(documentUri.fsPath)
    await panel.webview.postMessage({
      type: 'assets',
      duckdbWorkerUrl: workerUri.toString(),
      duckdbWasmUrl: wasmUri.toString(),
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
    // (spec 004).
    return `<!DOCTYPE html>
<html lang="en" data-theme="vscode">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'wasm-unsafe-eval' ${csp}; style-src ${csp} 'unsafe-inline'; worker-src ${csp} blob: data:; connect-src ${csp} https://extensions.duckdb.org; img-src ${csp} data:; font-src ${csp};">
<link rel="stylesheet" href="${styleUri}">
<title>Spatial Explorer</title>
<style>html,body,#app{height:100%;margin:0;padding:0}body{background:var(--vscode-editor-background)}</style>
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

export function activate(context: vscode.ExtensionContext): void {
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
    vscode.commands.registerCommand('spatialExplorer._getLoadState', () => lastLoadState),
    vscode.commands.registerCommand('spatialExplorer._testSelectFeature', (id: string | number | null) => {
      lastSelection = null
      provider.testSelectFeature(id)
    }),
    vscode.commands.registerCommand('spatialExplorer._getSelection', () => lastSelection)
  )
}

export function deactivate(): void {}
