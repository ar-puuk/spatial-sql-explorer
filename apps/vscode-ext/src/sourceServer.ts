// The loopback range server (spec 007, contracts/host-and-shells.md). The
// DuckDB worker inside a webview can't read VS Code's resource host, and
// VS Code's webview service worker stalls worker requests to `localhost` /
// `127.0.0.1` for 30 s (research §3). So the extension host serves each
// opened file over HTTP with single-range support, and the webview reaches it
// as `localhost.` (trailing dot), which the service worker doesn't match.
//
// Security: loopback sockets only; an unguessable token per opened document;
// only the files registered under that token (exact names, no paths); browser
// requests must come from a VS Code webview (Origin check). File bytes never
// leave the machine (Constitution IV).
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import * as vscode from 'vscode'

export interface Registration {
  token: string
  port: number
  /** The URL the webview uses for a registered file name. */
  urlFor(name: string): string
}

interface Entry {
  files: Map<string, string>
  bytes: number
  requests: number
  size: number
}

const entries = new Map<string, Entry>()
let servers: http.Server[] = []
let port = 0
let starting: Promise<void> | null = null
/** The externally reachable base URL (asExternalUri: remote hosts forward the port). */
let externalBase = ''

const CORS_BASE = {
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
}

type RangeResult = { kind: 'none' } | { kind: 'ok'; start: number; end: number } | { kind: 'bad' }

/** RFC 7233 single byte range; anything else (multi-range, other units, unsatisfiable) is refused. */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (header === undefined) return { kind: 'none' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'bad' }
  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (suffix === 0) return { kind: 'bad' }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return { kind: 'bad' }
  return { kind: 'ok', start, end }
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin
  // Browsers always send Origin on these cross-origin requests; only VS Code
  // webviews may read. (A local process without a browser could read the
  // file directly anyway; the token keeps web pages out.)
  if (origin !== undefined && !origin.startsWith('vscode-webview://')) {
    res.writeHead(403).end()
    return
  }
  const cors = { ...CORS_BASE, 'Access-Control-Allow-Origin': origin ?? '*', Vary: 'Origin' }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, cors).end()
    return
  }
  const parts = (req.url ?? '').split('?')[0].split('/')
  const entry = parts.length === 3 ? entries.get(parts[1]) : undefined
  let name = ''
  try {
    name = decodeURIComponent(parts[2] ?? '')
  } catch {
    // Malformed escape: not found below.
  }
  const file = entry?.files.get(name)
  if (!entry || !file) {
    res.writeHead(404, cors).end()
    return
  }
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    res.writeHead(404, cors).end()
    return
  }
  entry.requests++
  const range = parseRange(req.headers.range, size)
  if (range.kind === 'bad') {
    res.writeHead(416, { ...cors, 'Content-Range': `bytes */${size}` }).end()
    return
  }
  if (req.method === 'HEAD') {
    // DuckDB-WASM probes with `HEAD` + `Range: bytes=0-` and needs 206 with the full length (research §3).
    const headers = { ...cors, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    if (range.kind === 'ok') res.writeHead(206, { ...headers, 'Content-Range': `bytes 0-${size - 1}/${size}` }).end()
    else res.writeHead(200, headers).end()
    return
  }
  const start = range.kind === 'ok' ? range.start : 0
  const end = range.kind === 'ok' ? range.end : size - 1
  const length = end - start + 1
  entry.bytes += length
  res.writeHead(range.kind === 'ok' ? 206 : 200, {
    ...cors,
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
    ...(range.kind === 'ok' ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  })
  fs.createReadStream(file, { start, end })
    .on('error', () => res.destroy())
    .pipe(res)
}

function listen(host: string, wanted: number): Promise<http.Server | null> {
  return new Promise((resolve) => {
    const server = http.createServer(handle)
    server.once('error', () => resolve(null))
    server.listen({ host, port: wanted }, () => resolve(server))
  })
}

async function start(): Promise<void> {
  const v4 = await listen('127.0.0.1', 0)
  if (!v4) throw new Error('Could not start the local file server.')
  port = (v4.address() as { port: number }).port
  // `localhost.` may resolve to ::1 first; serve the same port there when IPv6 loopback exists.
  const v6 = await listen('::1', port)
  servers = v6 ? [v4, v6] : [v4]
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${port}/`))
  // Remote hosts forward the port to a local `localhost:<p>`; either way the
  // webview must use `localhost.` to avoid the service worker (research §3).
  const authority = external.authority.replace(/^(localhost|127\.0\.0\.1)(?=:|$)/, 'localhost.')
  externalBase = `${external.scheme}://${authority}`
}

function stop(): void {
  for (const s of servers) s.close()
  servers = []
  port = 0
  externalBase = ''
}

/** Serves `primaryPath` (and its sidecars) under a new token until `release`. */
export async function register(primaryPath: string, sidecarPaths: string[]): Promise<Registration> {
  if (!servers.length) {
    starting ??= start().finally(() => {
      starting = null
    })
    await starting
  }
  const token = crypto.randomBytes(16).toString('hex')
  const files = new Map<string, string>()
  for (const p of [primaryPath, ...sidecarPaths]) files.set(path.basename(p), p)
  entries.set(token, { files, bytes: 0, requests: 0, size: fs.statSync(primaryPath).size })
  const base = externalBase
  return { token, port, urlFor: (name: string) => `${base}/${token}/${encodeURIComponent(name)}` }
}

/**
 * Spec 010 phase 9: serves more files under an existing token (workspace files a
 * query names). Names may hold '/' (`ws/data/links.shp`): the URL carries the
 * name as one encoded segment, which `handle` decodes whole.
 */
export function addFiles(token: string, files: Array<{ name: string; fsPath: string }>): void {
  const entry = entries.get(token)
  if (!entry) throw new Error('The viewer is no longer serving files.')
  for (const f of files) entry.files.set(f.name, f.fsPath)
}

/** Stops serving a token's files; the server stops with the last one. */
export function release(token: string): Entry | undefined {
  const entry = entries.get(token)
  entries.delete(token)
  if (entries.size === 0) stop()
  return entry
}

/** Bytes and requests served for a token (output channel, test hooks). */
export function statsFor(token: string): { bytes: number; requests: number; size: number } | undefined {
  const e = entries.get(token)
  return e ? { bytes: e.bytes, requests: e.requests, size: e.size } : undefined
}

export function isListening(): boolean {
  return servers.length > 0
}
