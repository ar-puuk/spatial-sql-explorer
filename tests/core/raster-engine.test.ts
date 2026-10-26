// Spec 026 T005: the raster engine is downloaded and hash-checked like the SQL engine, and its files are
// kept by the host's cache (engineHashes), or the next DuckDB start would prune them.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_ASSETS, EngineLoadError, engineHashes, engineUrl, loadConverterBytes, loadRasterEngineBytes } from '@spatial-explorer/core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkgDir = (name: string) => path.join(ROOT, 'node_modules', name)
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const version = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version as string

describe('raster engine assets (run scripts/engine-assets.mjs after upgrading)', () => {
  const files = [
    ['whitebox', 'whitebox-wasm', 'whitebox_wasm_bg.wasm'],
    ['cogTiler', 'cog-tiler-wasm', 'cog_tiler_wasm_bg.wasm'],
    ['converter', 'geolibre-wasm', 'geolibre_wasm_bg.wasm'],
  ] as const

  it('the installed versions, their files, pinned jsDelivr URLs', () => {
    expect(Object.keys(ENGINE_ASSETS.raster).sort()).toEqual(['cogTiler', 'converter', 'whitebox'])
    for (const [key, pkg, file] of files) {
      const dir = pkgDir(pkg)
      const f = ENGINE_ASSETS.raster[key]
      expect(f.package).toBe(version(dir))
      expect(f.sha256).toBe(sha(path.join(dir, file)))
      expect(f.bytes).toBe(fs.statSync(path.join(dir, file)).size)
      expect(f.url).toBe(`https://cdn.jsdelivr.net/npm/${pkg}@${version(dir)}/${file}`)
    }
  })

  it('the cog-tiler-wasm version is the one the striped-file matcher and statistics handling were checked against', () => {
    expect(ENGINE_ASSETS.raster.cogTiler.package).toBe('0.5.0')
  })

  it('hosts keep the raster files: engineHashes() lists them (else pruneEngineFiles deletes them at the next DuckDB start)', () => {
    const kept = engineHashes()
    for (const f of Object.values(ENGINE_ASSETS.raster)) expect(kept).toContain(f.sha256)
  })

  it('a mirror keeps the paths', () => {
    expect(engineUrl(ENGINE_ASSETS.raster.whitebox.url, { mirror: '/engine-mirror' })).toBe(`/engine-mirror/npm/whitebox-wasm@${ENGINE_ASSETS.raster.whitebox.package}/whitebox_wasm_bg.wasm`)
  })
})

describe('loading the raster engine', () => {
  afterEach(() => vi.unstubAllGlobals())
  const bytesOf = (url: string) => {
    const f = Object.values(ENGINE_ASSETS.raster).find((r) => url.endsWith(r.url.split('/').pop()!))!
    return fs.readFileSync(path.join(pkgDir(f.url.split('/')[4].split('@')[0]), f.url.split('/').pop()!))
  }

  it('returns the two tiler files, verified, without touching the converter', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (u: string) => {
      asked.push(String(u))
      return new Response(bytesOf(String(u)))
    })
    const e = await loadRasterEngineBytes({ mirror: '/m' })
    expect(e.whitebox.byteLength).toBe(ENGINE_ASSETS.raster.whitebox.bytes)
    expect(e.cogTiler.byteLength).toBe(ENGINE_ASSETS.raster.cogTiler.bytes)
    expect(asked.sort()).toEqual([`/m/npm/cog-tiler-wasm@0.5.0/cog_tiler_wasm_bg.wasm`, `/m/npm/whitebox-wasm@0.6.1/whitebox_wasm_bg.wasm`])
  })

  it('refuses a changed file and names the raster engine, not the SQL engine', async () => {
    vi.stubGlobal('fetch', async () => new Response(new TextEncoder().encode('tampered')))
    const err = await loadConverterBytes().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineLoadError)
    expect((err as EngineLoadError).kind).toBe('integrity')
    expect((err as Error).message).toMatch(/refused to run its raster engine: raster engine \(geolibre_wasm_bg\.wasm\) from cdn\.jsdelivr\.net does not match/)
  })

  it('offline: a clear message about the raster engine', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = await loadRasterEngineBytes().catch((e: unknown) => e)
    expect((err as EngineLoadError).kind).toBe('network')
    expect((err as Error).message).toMatch(/could not download its raster engine .*needs an internet connection/)
  })

  it('uses the host copy when there is one, and checks its hash too (a bad copy is replaced once)', async () => {
    const calls: boolean[] = []
    const host = {
      engineFile: async (f: { url: string }, o?: { refresh?: boolean }) => {
        calls.push(!!o?.refresh)
        return o?.refresh ? new Uint8Array(bytesOf(f.url)).buffer : new TextEncoder().encode('damaged').buffer
      },
      pruneEngineFiles: async () => {},
    }
    const buf = await loadConverterBytes({ host: host as never })
    expect(buf.byteLength).toBe(ENGINE_ASSETS.raster.converter.bytes)
    expect(calls).toEqual([false, true])
  })
})
