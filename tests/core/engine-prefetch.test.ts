// The optional engines (sql.js, GDAL, raster, converter) are kept in the background after the first start,
// so the app works offline for every feature, not only the ones opened first.
import { describe, expect, it } from 'vitest'
import { ENGINE_ASSETS, engineHashes, prefetchOptionalEngineFiles } from '@spatial-explorer/core'

function fakeHost(failOn?: string) {
  const asked: Array<{ name: string; sha256: string; cacheOnly?: boolean }> = []
  return {
    asked,
    host: {
      engineFile: async (f: { name: string; sha256: string }, o?: { cacheOnly?: boolean }) => {
        asked.push({ name: f.name, sha256: f.sha256, cacheOnly: o?.cacheOnly })
        if (f.name === failOn) throw new Error('offline')
        return new ArrayBuffer(0)
      }
    }
  }
}

describe('prefetchOptionalEngineFiles', () => {
  it('asks the host to keep sql.js, the raster engine, the converter and the shell’s GDAL build, and nothing else', async () => {
    const { asked, host } = fakeHost()
    await prefetchOptionalEngineFiles({ host, gdalTarget: 'node' })
    expect(asked.map((a) => a.name).sort()).toEqual(['cog_tiler_wasm_bg.wasm', 'gdal3.node.js', 'gdal3WebAssembly.data', 'gdal3WebAssembly.wasm', 'geolibre_wasm_bg.wasm', 'sql-wasm.wasm', 'whitebox_wasm_bg.wasm'])
    expect(asked.every((a) => a.cacheOnly)).toBe(true)
    // Each is a file the host keeps at the next prune.
    for (const a of asked) expect(engineHashes()).toContain(a.sha256)
  })

  it('goes in order of need: GDAL (geodatabases, GTFS), then sql.js, then the raster engine, its converter last', async () => {
    const { asked, host } = fakeHost()
    await prefetchOptionalEngineFiles({ host, gdalTarget: 'web' })
    const names = asked.map((a) => a.name)
    expect(names.slice(0, 3).sort()).toEqual(['gdal3.js', 'gdal3WebAssembly.data', 'gdal3WebAssembly.wasm'])
    expect(names.slice(3)).toEqual(['sql-wasm.wasm', 'whitebox_wasm_bg.wasm', 'cog_tiler_wasm_bg.wasm', 'geolibre_wasm_bg.wasm'])
  })

  it('fetches the browser build of GDAL on the web', async () => {
    const { asked, host } = fakeHost()
    await prefetchOptionalEngineFiles({ host, gdalTarget: 'web' })
    expect(asked.map((a) => a.name)).toContain('gdal3.js')
    expect(asked.map((a) => a.name)).not.toContain('gdal3.node.js')
  })

  it('goes on after a file fails (offline), without throwing', async () => {
    const { asked, host } = fakeHost('gdal3WebAssembly.wasm')
    await expect(prefetchOptionalEngineFiles({ host, gdalTarget: 'web' })).resolves.toBeUndefined()
    expect(asked.map((a) => a.name)).toContain('geolibre_wasm_bg.wasm')
  })

  it('does nothing without a host copy, or against a test mirror', async () => {
    await expect(prefetchOptionalEngineFiles({})).resolves.toBeUndefined()
    const { asked, host } = fakeHost()
    await prefetchOptionalEngineFiles({ host, mirror: '/engine-mirror', gdalTarget: 'web' })
    expect(asked).toEqual([])
    expect(ENGINE_ASSETS.raster.converter.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
