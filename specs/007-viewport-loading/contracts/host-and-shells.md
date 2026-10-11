# Contract: hosts and shells

## HostAdapter (changed)

```ts
getFileSource(ref: OpenedFileRef, options?: { whole?: boolean }): Promise<FileSource>
readRange(ref: OpenedFileRef, offset: number, length: number): Promise<Uint8Array>   // NEW (PMTiles)
```

### Web (`apps/web/src/hostAdapter.ts`)

- **`getFileSource`** returns `{ kind: 'handle', handle: File, size, sidecars:
  [File…] }`, with the sidecars found among the picked or dropped files, as
  today.
  - With `{ whole: true }`, it returns `{ kind: 'bytes' }` from
    `file.arrayBuffer()` (FlatGeobuf "load for queries").
- **`readRange`** returns `file.slice(offset, offset + length).arrayBuffer()`.

### VS Code webview (`apps/vscode-ext/src/webview/hostAdapter.ts`)

- **`getFileSource`**:
  1. Receive `{ type: 'fileSource', url, size, sidecars: [{ name, url }] }`
     from the host.
  2. **Probe**: a main-thread `fetch(url, { method: 'HEAD', headers: { Range:
     'bytes=0-' } })` that must return 206 within 3 s.
  3. On success, return `{ kind: 'url' }`.
  4. On failure, post `{ type: 'requestBytes' }`, receive today's chunked
     transfer, and return `{ kind: 'bytes' }`. The platform is marked
     `partialReads: false` with the reason (FR-015).
  5. With `{ whole: true }`, use the same chunked transfer.
- **`readRange`**: `fetch(resourceUri, { headers: { Range } })` on the main
  thread. Verified as 206 (research §3). `resourceUri` is
  `asWebviewUri(file)`, sent with `fileSource`.

## Loopback source server (`apps/vscode-ext/src/sourceServer.ts`)

**Lifecycle**:
- One server per extension host, started lazily on the first open.
- It listens on `127.0.0.1` and `::1`, on an OS-assigned port.
- It closes when the last viewer closes.

**Routes**:
- `GET|HEAD /<token>/<name>`: `token` is 128 random bits per opened
  document.
- `name` is the primary file or one of its registered sidecars (shapefile
  `.dbf/.shx/.prj/.cpg`). Anything else gets 404.

**Behavior**:

| Request | Response |
|---|---|
| `OPTIONS` (preflight) | 204 with the CORS headers |
| `HEAD` with `Range` | **206**, `Content-Length: <size>`, `Content-Range: bytes 0-<size-1>/<size>`, `Accept-Ranges: bytes` |
| `HEAD` without `Range` | 200, `Content-Length`, `Accept-Ranges` |
| `GET` with a single `Range: bytes=a-b` | 206 with exactly that slice, streamed from disk |
| `GET` without `Range` | 200, the whole file, streamed (never buffered in memory) |
| Multi-range, malformed or unsatisfiable | 416 |
| Wrong token or name | 404 |
| `Origin` present and not `vscode-webview://…` | 403 |

**CORS headers on every response**:
- `Access-Control-Allow-Origin: <origin>`;
- `Access-Control-Allow-Headers: Range`;
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`;
- `Access-Control-Allow-Private-Network: true`;
- `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`.

**URL given to the webview**: `http://localhost.:<port>/<token>/<name>`.
- Under a remote extension host: `vscode.env.asExternalUri(http://127.0.0.1:
  <port>/…)`, with the returned host rewritten to `localhost.`.
- **Unverified**: the probe decides (research §3).

**Logging**: the output channel logs the bytes served per document at
close: "Read 36 MB of 762 MB."

## Extension host (`extension.ts`)

- **Open**: register the document with the server, then post `{ type:
  'fileSource', url, size, resourceUri, sidecars }` instead of the
  `initFileStart` / `initFileChunk` stream.
- **Fallback**: on `{ type: 'requestBytes' }`, use today's chunked transfer.
  The output channel logs the reason.
- **CSP**: `connect-src` adds `http://localhost.:*`.
- **Test hooks**:
  - `_getSourceStats` (bytes served per document);
  - `_forceBytesFallback(true)` (makes the probe fail);
  - `_getOpenState` (the phase and facts).

## Web shell

No server. A `File` handle always reads in parts, so the web never takes the
fallback.
