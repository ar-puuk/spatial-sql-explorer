// Spec 008 research §15: the engine is downloaded from pinned URLs and
// checked against hashes recorded at build time. These tests keep the record
// honest: the hashes are those of the installed packages (jsDelivr serves the
// npm files byte for byte), the URLs pin those exact versions, and a file
// that doesn't match is refused.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_ASSETS, EngineLoadError, engineUrl, fetchVerified } from '@spatial-explorer/core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = (name: string) =>
  [path.join(ROOT, 'packages/core/node_modules', name), path.join(ROOT, 'node_modules', name)].find((d) => fs.existsSync(path.join(d, 'package.json')))!
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const version = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version as string

describe('engine assets (run scripts/engine-assets.mjs after upgrading)', () => {
  it('DuckDB-WASM: the installed version, its files, pinned jsDelivr URLs', () => {
    const dir = pkg('@duckdb/duckdb-wasm')
    expect(ENGINE_ASSETS.duckdb.package).toBe(version(dir))
    expect(ENGINE_ASSETS.duckdb.worker.sha256).toBe(sha(path.join(dir, 'dist/duckdb-browser-eh.worker.js')))
    expect(ENGINE_ASSETS.duckdb.wasm.sha256).toBe(sha(path.join(dir, 'dist/duckdb-eh.wasm')))
    expect(ENGINE_ASSETS.duckdb.wasm.url).toBe(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${version(dir)}/dist/duckdb-eh.wasm`)
  })

  it('sql.js: the installed version and its wasm', () => {
    const dir = pkg('sql.js')
    expect(ENGINE_ASSETS.sqljs.package).toBe(version(dir))
    expect(ENGINE_ASSETS.sqljs.wasm.sha256).toBe(sha(path.join(dir, 'dist/sql-wasm.wasm')))
  })

  it('extensions: spatial, parquet and json for the same DuckDB release, each with a hash', () => {
    const { duckdb, platform, files } = ENGINE_ASSETS.extensions
    expect(duckdb).toBe(ENGINE_ASSETS.duckdb.release)
    expect(Object.keys(files).sort()).toEqual(['json', 'parquet', 'spatial'])
    for (const [name, f] of Object.entries(files)) {
      expect(f.url).toBe(`https://extensions.duckdb.org/${duckdb}/${platform}/${name}.duckdb_extension.wasm`)
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('every URL is https on the two allowed hosts; a mirror keeps the paths', () => {
    const urls = [ENGINE_ASSETS.duckdb.worker.url, ENGINE_ASSETS.duckdb.wasm.url, ENGINE_ASSETS.sqljs.wasm.url, ...Object.values(ENGINE_ASSETS.extensions.files).map((f) => f.url)]
    for (const u of urls) expect(new URL(u).host).toMatch(/^(cdn\.jsdelivr\.net|extensions\.duckdb\.org)$/)
    expect(engineUrl(ENGINE_ASSETS.duckdb.wasm.url, { mirror: '/engine-mirror' })).toBe(`/engine-mirror/npm/@duckdb/duckdb-wasm@${ENGINE_ASSETS.duckdb.package}/dist/duckdb-eh.wasm`)
    expect(engineUrl(ENGINE_ASSETS.extensions.files.spatial.url, { mirror: '/engine-mirror/' })).toBe(`/engine-mirror/extensions/${ENGINE_ASSETS.extensions.duckdb}/wasm_eh/spatial.duckdb_extension.wasm`)
    expect(engineUrl(ENGINE_ASSETS.duckdb.wasm.url)).toBe(ENGINE_ASSETS.duckdb.wasm.url)
  })
})

describe('fetchVerified', () => {
  afterEach(() => vi.unstubAllGlobals())
  const bytes = new TextEncoder().encode('engine bytes')
  const good = createHash('sha256').update(bytes).digest('hex')

  it('returns the bytes when the hash matches', async () => {
    vi.stubGlobal('fetch', async () => new Response(bytes))
    expect(new Uint8Array(await fetchVerified('https://cdn.jsdelivr.net/x', good, 'test'))).toEqual(bytes)
  })

  it('refuses different bytes, and says so', async () => {
    vi.stubGlobal('fetch', async () => new Response(new TextEncoder().encode('tampered')))
    const err = await fetchVerified('https://cdn.jsdelivr.net/x', good, 'DuckDB wasm').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineLoadError)
    expect((err as EngineLoadError).kind).toBe('integrity')
    expect((err as Error).message).toMatch(/refused to run its SQL engine: DuckDB wasm from cdn\.jsdelivr\.net does not match/)
  })

  it('no connection: a clear message', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = await fetchVerified('https://extensions.duckdb.org/x', good, 'spatial extension').catch((e: unknown) => e)
    expect((err as EngineLoadError).kind).toBe('network')
    expect((err as Error).message).toMatch(/needs an internet connection to cdn\.jsdelivr\.net and extensions\.duckdb\.org/)
  })
})
