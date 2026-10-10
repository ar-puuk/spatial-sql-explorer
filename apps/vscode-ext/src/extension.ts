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
  | {
      type: 'spikeResult'
      ok: boolean
      stage: string
      detail?: string
    }

/**
 * Latest T005 worker-bootstrap spike result, if any webview has reported
 * one. Exposed via the `spatialExplorer._getSpikeResult` command so
 * @vscode/test-electron integration tests can retrieve it without needing
 * to intercept webview postMessage directly (the extension host process and
 * the webview's renderer process are not directly observable from a test
 * running in the extension host).
 */
let lastSpikeResult: { ok: boolean; stage: string; detail?: string } | null = null

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

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot],
    }

    // Register the message listener BEFORE setting .html — if the webview
    // loads and posts 'ready' before a listener exists, that message is
    // lost with no error, no retry, and no visible symptom other than the
    // viewer silently never receiving a file (documented omx-viewer gotcha;
    // see contracts/host-webview-protocol.md).
    panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      if (msg.type === 'ready') {
        void this.sendAssetUris(panel, webviewRoot)
      } else if (msg.type === 'spikeResult') {
        lastSpikeResult = { ok: msg.ok, stage: msg.stage, detail: msg.detail }
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
  private async sendAssetUris(panel: vscode.WebviewPanel, webviewRoot: vscode.Uri): Promise<void> {
    const workerUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewRoot, 'duckdb', 'duckdb-browser-mvp.worker.js')
    )
    const wasmUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewRoot, 'duckdb', 'duckdb-mvp.wasm')
    )
    await panel.webview.postMessage({
      type: 'assets',
      duckdbWorkerUrl: workerUri.toString(),
      duckdbWasmUrl: wasmUri.toString(),
    })
  }

  private getHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js'))
    const csp = webview.cspSource

    return `<!DOCTYPE html>
<html lang="en" data-theme="vscode">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'wasm-unsafe-eval' ${csp}; style-src ${csp} 'unsafe-inline'; worker-src ${csp} blob: data:; connect-src ${csp}; img-src ${csp} data:; font-src ${csp};">
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
    vscode.commands.registerCommand('spatialExplorer._getSpikeResult', () => lastSpikeResult)
  )
}

export function deactivate(): void {}
