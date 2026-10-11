# Contract: VS Code extension-host ↔ webview message protocol

This is the VS Code-specific transport underneath `HostAdapter.getFileSource`
(it has no equivalent in the web shell, where the browser context reads file
bytes directly with no process boundary to cross).

## Transport decision: base64-chunked by default

**Decision**: transfer file bytes from the extension host to the webview as
base64-encoded chunks over `panel.webview.postMessage`, matching the pattern
already shipped and proven in `../omx-viewer/apps/vscode-ext/src/extension.ts`,
rather than assuming native binary `ArrayBuffer` transfer.

**Why not native binary transfer by default**: VS Code has documented
efficient `ArrayBuffer`/`TypedArray` support over `postMessage` for
`WebviewPanel` since 1.57+, but omx-viewer's own shipped extension —
targeting the same `WebviewPanel`/`customEditors` surface this project
uses — empirically found this did not work as documented and ships
base64-chunked transfer instead (see `research.md` §2). Given that direct,
contradicting, tested evidence on the exact boundary this project needs,
the safer default is the approach already proven to ship. Chunking (not one
base64 blob) is required regardless, because a single `base64` string for a
file above ~400MB can exceed V8's max string length — not a concern for
spec 001's ~10MB target today, but cheap to do right from the start and
avoids a breaking protocol change later.

**Upgrade path**: if a future spike confirms native binary transfer is
reliable on this project's actual target VS Code `engines` version inside a
real custom editor, the chunk messages can carry `ArrayBuffer`/`Uint8Array`
payloads instead of base64 strings without changing the message *shape*
below — only the `bytesBase64` field's encoding would change.

## Message shapes

Extended beyond the original single-file design to support sidecar-based
formats (Shapefile needs `.shp`+`.shx`+`.dbf`+`.prj` — see
`host-adapter.md`'s `FileSource.files`): one `initFileStart`/`initFileChunk`
sequence per file, keyed by `fileName`, followed by one `initFilesDone` once
every file has been fully sent.

Extension host → webview:

```ts
type HostToWebviewMessage =
  | { type: 'initFileStart'; fileName: string; totalBytes: number; chunkCount: number; isPrimary: boolean }
  | { type: 'initFileChunk'; fileName: string; index: number; bytesBase64: string }
  | { type: 'initFilesDone' }
  | { type: 'assets'; duckdbWorkerUrl: string; duckdbWasmUrl: string; maplibreWorkerUrl: string; primaryFileName: string }
  | { type: 'themeChange'; theme: 'light' | 'dark' | 'high-contrast' }
  | { type: 'triggerError'; message: string }
  // Reply to any webview request below, matched by requestId.
  | { type: 'requestResult'; requestId: number; result: unknown };
```

`maplibreWorkerUrl` is required: the webview fetches it and runs MapLibre's
worker from a same-origin `blob:` URL (research.md §8). Without a worker,
the map draws no data at all.

Webview → extension host:

```ts
type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'log'; detail: string }
  | { type: 'showInfo'; message: string }
  | { type: 'statusUpdate'; crs?: string; featureCount?: number; cursor?: { lon: number; lat: number } | null }
  // Test observability (spatialExplorer._getLoadState), see main.ts.
  | { type: 'loadStateChanged'; loadState: string; /* counts, CRS, extent, mapCanvasRect, renderedFeatureCount, styleSource */ }
  | { type: 'selectionChanged'; id: string | number | null }
  // Style file I/O (HostAdapter.saveFile / saveSidecar / pickTextFile). The host answers with requestResult.
  | { type: 'saveFile'; requestId: number; name: string; text: string }      // save dialog, defaults next to the data file
  | { type: 'saveSidecar'; requestId: number; name: string; text: string }   // writes <basename>.qml next to the data; modal confirm before replacing
  | { type: 'pickTextFile'; requestId: number; title: string; extensions: string[] };
```

Every webview→host message passes through one `post()` that normalizes it via
a JSON round-trip. `postMessage` structured-clones its payload, and Svelte 5
`$state` Proxies make that throw a `DataCloneError` before anything is sent
(research.md §7).

## Sequencing (mirrors omx-viewer's proven flow)

1. Webview boots, registers its message listener, then posts `{ type: 'ready' }`.
2. Extension host — **must already have its listener registered before
   `panel.webview.html` is set**, or a `ready` sent before the listener
   exists is silently lost (documented omx-viewer gotcha) — reads the
   opened document's URI via `vscode.workspace.fs.readFile`, then discovers
   same-basename sibling files next to it (for sidecar formats) via
   `vscode.workspace.fs.readDirectory`. For each file (primary first, then
   siblings), sends one `initFileStart` followed by `initFileChunk` messages
   (chunk size: 32MB of raw bytes per chunk, matching omx-viewer's proven
   constant, pre-base64-inflation — in practice a single chunk for spec
   001's ~10MB target). Sends `initFilesDone` once every file is sent.
3. Webview reassembles each file's chunks into an `ArrayBuffer`, decodes
   base64, and once `initFilesDone` arrives, resolves the pending
   `HostAdapter.getFileSource()` call with `{ files, primaryFileName,
   totalBytes }` — `packages/core`'s open-file pipeline then parses it and
   populates `ViewerSession`/`Layer` per `data-model.md`.
4. On error at any point, the host sends `triggerError` (or the webview sets
   its own `ViewerSession.loadState = 'error'` for parse-time failures) — see
   FR-011.

## Constitution compliance

This protocol lives entirely inside `apps/vscode-ext` (both the
`extension.ts` side and the webview-side adapter that implements
`HostAdapter` for the VS Code target). `packages/core`/`packages/ui` never see
these message types directly — they only see the resolved `ArrayBuffer` that
`HostAdapter.getFileSource` returns once reassembly is complete.
