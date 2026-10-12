// Spec 008 research §15 (constitution IV): the SQL engine is downloaded, not
// bundled. Every piece of engine code (DuckDB-WASM's worker and wasm, its
// extensions, sql.js) comes from a pinned URL and is checked against the
// SHA-256 recorded at build time (scripts/engine-assets.mjs) before it runs.
// A file that doesn't match is refused, never executed.
import assets from './engineAssets.json'
import type { HostAdapter } from './hostAdapter.js'

export const ENGINE_ASSETS = assets
export type ExtensionName = keyof typeof assets.extensions.files

/** Where engine files come from: the pinned CDNs, or (tests) a local mirror with the same paths and the same hashes. */
export interface EngineSource {
  /** e.g. `/engine-mirror`: `https://cdn.jsdelivr.net/npm/…` → `<mirror>/npm/…`, `https://extensions.duckdb.org/…` → `<mirror>/extensions/…`. */
  mirror?: string
  /** The host's local copy (offline after first use); without it, every start downloads. */
  host?: Pick<HostAdapter, 'engineFile' | 'pruneEngineFiles'>
}

/** Every engine file's SHA-256: what a host keeps (anything else is an old version). */
export function engineHashes(): string[] {
  return [assets.duckdb.worker.sha256, assets.duckdb.wasm.sha256, assets.sqljs.wasm.sha256, ...Object.values(assets.extensions.files).map((f) => f.sha256)]
}

const CDN_HOSTS = ['cdn.jsdelivr.net', 'extensions.duckdb.org']

export function engineUrl(url: string, source: EngineSource = {}): string {
  if (!source.mirror) return url
  const m = source.mirror.replace(/\/$/, '')
  return url.replace('https://cdn.jsdelivr.net/', `${m}/`).replace('https://extensions.duckdb.org/', `${m}/extensions/`)
}

/** The engine could not be downloaded, or a download didn't match its recorded hash. */
export class EngineLoadError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'integrity'
  ) {
    super(message)
    this.name = 'EngineLoadError'
  }
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Downloads `url` and returns its bytes only if their SHA-256 is `expected`.
 * The browser's HTTP cache serves repeat loads (pinned URLs never change).
 */
export async function fetchVerified(url: string, expected: string, label: string, source: EngineSource = {}): Promise<ArrayBuffer> {
  const from = engineUrl(url, source)
  const host = source.host
  if (host?.engineFile) {
    // The host's local copy (downloaded once from the same URL). Its hash is
    // checked here too; a copy that doesn't match is replaced once.
    const file = { name: from.split('/').pop() ?? label, url: from, sha256: expected }
    for (const refresh of [false, true]) {
      let buf: ArrayBuffer
      try {
        buf = await host.engineFile(file, { refresh })
      } catch (err) {
        // The host's own download names the file; the message uses the friendly label.
        if (err instanceof EngineLoadError) throw new EngineLoadError(err.message.split(file.name).join(label), err.kind)
        throw new EngineLoadError(`Spatial Explorer could not download its SQL engine (${label}): ${err instanceof Error ? err.message : String(err)}. The first start needs an internet connection to ${CDN_HOSTS.join(' and ')}; after that it works offline.`, 'network')
      }
      if ((await sha256(buf)) === expected) return buf
    }
    throw new EngineLoadError(`Spatial Explorer refused to run its SQL engine: ${label} from ${new URL(from, globalThis.location?.href ?? 'http://localhost/').host} does not match the expected file, even after downloading it again.`, 'integrity')
  }
  return fetchFromNetwork(from, expected, label)
}

/** The download itself, checked; also what web hosts use to fill their local copy. */
export async function fetchFromNetwork(from: string, expected: string, label: string): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetch(from, { credentials: 'omit' })
  } catch {
    throw new EngineLoadError(`Spatial Explorer could not download its SQL engine (${label}). It needs an internet connection to ${CDN_HOSTS.join(' and ')} the first time; check the connection or proxy.`, 'network')
  }
  const host = new URL(from, globalThis.location?.href ?? 'http://localhost/').host
  if (!res.ok) throw new EngineLoadError(`Spatial Explorer could not download its SQL engine (${label}): ${host} answered ${res.status}.`, 'network')
  const buf = await res.arrayBuffer()
  const got = await sha256(buf)
  if (got !== expected) {
    throw new EngineLoadError(`Spatial Explorer refused to run its SQL engine: ${label} from ${host} does not match the expected file (SHA-256 ${got.slice(0, 12)}…, expected ${expected.slice(0, 12)}…).`, 'integrity')
  }
  return buf
}

let sqlWasm: Promise<ArrayBuffer> | null = null
/** sql.js's wasm (the GeoPackage writer), verified, downloaded on first use only. */
export function loadSqlWasm(source: EngineSource = {}): Promise<ArrayBuffer> {
  if (!sqlWasm) {
    const attempt = fetchVerified(assets.sqljs.wasm.url, assets.sqljs.wasm.sha256, 'sql.js', source)
    sqlWasm = attempt
    attempt.catch(() => {
      if (sqlWasm === attempt) sqlWasm = null
    })
  }
  return sqlWasm
}
