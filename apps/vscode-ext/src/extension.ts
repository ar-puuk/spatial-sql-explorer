import * as vscode from 'vscode'
import * as path from 'path'

// SpatialExplorerDocument — minimal CustomDocument wrapper. No in-memory
// model beyond the URI: DuckDB-WASM (inside the webview) owns the actual
// parsed file state. Read-only for spec 001 — no save/revert/backup needed.
class SpatialExplorerDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}
  dispose(): void {}
}

type FormatResult = { label: string; ok: boolean; detail: string }

type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'log'; detail: string }
  | {
      type: 'spikeResult'
      ok: boolean
      stage: string
      detail?: string
    }
  | { type: 'formatResult'; label: string; ok: boolean; detail: string }
  | { type: 'formatSummary'; results: FormatResult[] }

/**
 * Latest T005 worker-bootstrap spike result, if any webview has reported
 * one. Exposed via the `spatialExplorer._getSpikeResult` command so
 * @vscode/test-electron integration tests can retrieve it without needing
 * to intercept webview postMessage directly (the extension host process and
 * the webview's renderer process are not directly observable from a test
 * running in the extension host).
 */
let lastSpikeResult: { ok: boolean; stage: string; detail?: string } | null = null

/** Latest T006 format-support spike summary, same rationale as above. */
let lastFormatSummary: FormatResult[] | null = null

class SpatialExplorerEditorProvider implements vscode.CustomReadonlyEditorProvider<SpatialExplorerDocument> {
  private panels = new Set<vscode.WebviewPanel>()

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): SpatialExplorerDocument {
    return new SpatialExplorerDocument(uri)
  }

  async resolveCustomEditor(
    _document: SpatialExplorerDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    this.panels.add(panel)
    panel.onDidDispose(() => this.panels.delete(panel))

    const webviewRoot = vscode.Uri.file(path.join(this.context.extensionPath, 'dist-webview'))
    // T006 spike only: real sample files for formats this WASM build's own
    // GDAL writer can't reliably produce (see research.md §1), generated via
    // geopandas/GDAL outside the sandbox. Not part of the real open-file
    // pipeline (that's T019/T024 — the opened document's own URI, not a
    // fixed fixtures path).
    const fixturesRoot = vscode.Uri.file(
      path.join(this.context.extensionPath, '..', '..', 'tests', 'vscode-ext', 'fixtures')
    )

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot, fixturesRoot],
    }

    // Register the message listener BEFORE setting .html — if the webview
    // loads and posts 'ready' before a listener exists, that message is
    // lost with no error, no retry, and no visible symptom other than the
    // viewer silently never receiving a file (documented omx-viewer gotcha;
    // see contracts/host-webview-protocol.md).
    panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      if (msg.type === 'ready') {
        void this.sendAssetUris(panel, webviewRoot, fixturesRoot)
      } else if (msg.type === 'spikeResult') {
        lastSpikeResult = { ok: msg.ok, stage: msg.stage, detail: msg.detail }
      } else if (msg.type === 'formatResult') {
        console.log('[spatial-explorer webview] format:', msg.label, msg.ok, msg.detail)
      } else if (msg.type === 'formatSummary') {
        lastFormatSummary = msg.results
      } else if (msg.type === 'log') {
        console.log('[spatial-explorer webview]', msg.detail)
      }
    })

    panel.webview.html = this.getHtml(panel.webview, webviewRoot)
  }

  /**
   * T005 spike: sends the webview the asWebviewUri()-resolved URLs for the
   * bundled DuckDB-WASM worker and wasm module, rather than letting the
   * webview compute them via `new URL(..., import.meta.url)` — that pattern
   * is the one ../omx-viewer's own shipped extension found throws
   * synchronously in a webview (origin mismatch). See research.md §4.
   */
  private async sendAssetUris(
    panel: vscode.WebviewPanel,
    webviewRoot: vscode.Uri,
    fixturesRoot: vscode.Uri
  ): Promise<void> {
    const workerUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewRoot, 'duckdb', 'duckdb-browser-eh.worker.js')
    )
    const wasmUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewRoot, 'duckdb', 'duckdb-eh.wasm')
    )
    // T006 spike only — see the fixturesRoot comment above.
    const fixtureFiles = [
      'world-boundaries.geojson',
      'sample.fgb',
      'sample.gpkg',
      'sample.shp',
      'sample.shx',
      'sample.dbf',
      'sample.prj',
      'sample.cpg',
      'sample.gml',
      'sample.xsd',
      'sample.tab',
      'sample.dat',
      'sample.id',
      'sample.map',
    ]
    const fixtureUris: Record<string, string> = {}
    for (const name of fixtureFiles) {
      fixtureUris[name] = panel.webview.asWebviewUri(vscode.Uri.joinPath(fixturesRoot, name)).toString()
    }
    await panel.webview.postMessage({
      type: 'assets',
      duckdbWorkerUrl: workerUri.toString(),
      duckdbWasmUrl: wasmUri.toString(),
      fixtureUris,
    })
  }

  private getHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js'))
    const csp = webview.cspSource

    return `<!DOCTYPE html>
<html lang="en" data-theme="vscode">
<head>
<meta charset="UTF-8">
<!-- connect-src widened to https: for the T006 format-support spike only,
     to test whether a worker's fetch of a REAL internet host (the DuckDB
     extension CDN) hits the same "worker fetch never completes" limitation
     found for VS Code's own vscode-resource.vscode-cdn.net virtual host
     (research.md §4), or whether that limitation is specific to VS Code's
     custom protocol interception. Narrow this back down once T006 is
     resolved and the extension delivery decision (research.md §3: bundle,
     don't rely on CDN) is implemented for real. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'wasm-unsafe-eval' ${csp}; style-src ${csp} 'unsafe-inline'; worker-src ${csp} blob: data:; connect-src ${csp} https:; img-src ${csp} data:; font-src ${csp};">
<title>Spatial Explorer</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="${scriptUri}"></script>
</body>
</html>`
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
    // Test-only introspection command (T005 spike) — not user-facing.
    vscode.commands.registerCommand('spatialExplorer._getSpikeResult', () => lastSpikeResult),
    vscode.commands.registerCommand('spatialExplorer._getFormatSummary', () => lastFormatSummary)
  )
}

export function deactivate(): void {}
