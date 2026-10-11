// Spec 008 research §15 (constitution IV): the SQL engine is downloaded, not
// bundled. Every piece of engine code (DuckDB-WASM's worker and wasm, its
// extensions, sql.js) comes from a pinned URL and is checked against the
// SHA-256 recorded at build time (scripts/engine-assets.mjs) before it runs.
// A file that doesn't match is refused, never executed.
import assets from './engineAssets.json'

export const ENGINE_ASSETS = assets
export type ExtensionName = keyof typeof assets.extensions.files

/** Where engine files come from: the pinned CDNs, or (tests) a local mirror with the same paths and the same hashes. */
export interface EngineSource {
  /** e.g. `/engine-mirror`: `https://cdn.jsdelivr.net/npm/…` → `<mirror>/npm/…`, `https://extensions.duckdb.org/…` → `<mirror>/extensions/…`. */
  mirror?: string
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
