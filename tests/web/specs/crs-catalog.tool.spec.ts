// Spec 008 tool (not a test): filters scripts/.crs-candidates.json (from
// scripts/crs-catalog.py) to the EPSG codes the WASM engine's PROJ can
// transform to, and writes packages/core/src/export/epsgCatalog.json.
//   CRS_CATALOG=1 npx playwright test crs-catalog.tool
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, openFile } from './helpers'

type Row = [number, string, 'g' | 'p', string, number, number, number, number, number]
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

test('build the EPSG catalog', async ({ page }) => {
  test.skip(!process.env.CRS_CATALOG, 'A tool: set CRS_CATALOG=1 to run it.')
  test.setTimeout(30 * 60_000)
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/.crs-candidates.json'), 'utf8')) as { epsg: string; proj: string; groups: string[]; crs: Row[] }
  await openFile(page, fixture('sample.geojson'), '?e2e=1')
  const engine = await page.evaluate(async () => {
    const r = (await (window as any).__spatialExplorerE2E.runRaw('SELECT DuckDB_Proj_Version() AS v')) as Array<{ v: string }>
    return r[0].v
  })
  // A chunk of codes in one query; a chunk that fails is checked code by code.
  const works = (rows: Row[]) =>
    page.evaluate(async (rs) => {
      const sql = rs
        .map(([code, , , , w, s, e, n]) => `SELECT ST_Transform(ST_Point(${(w + e) / 2}, ${(s + n) / 2}), 'EPSG:4326', 'EPSG:${code}', always_xy := true) AS g`)
        .join(' UNION ALL ')
      try {
        await (window as any).__spatialExplorerE2E.runRaw(sql)
        return true
      } catch {
        return false
      }
    }, rows)
  const kept: Row[] = []
  const dropped: number[] = []
  for (let i = 0; i < src.crs.length; i += 200) {
    const chunk = src.crs.slice(i, i + 200)
    if (await works(chunk)) kept.push(...chunk)
    else
      for (const r of chunk) {
        if (await works([r])) kept.push(r)
        else dropped.push(r[0])
      }
  }
  expect(kept.find((r) => r[0] === 4326)).toBeTruthy()
  const out = { source: `EPSG ${src.epsg} via PROJ ${src.proj}, filtered to the codes the engine's PROJ ${engine} accepts`, groups: src.groups, crs: kept }
  fs.writeFileSync(path.join(ROOT, 'packages/core/src/export/epsgCatalog.json'), JSON.stringify(out))
  console.log(`kept ${kept.length}, dropped ${dropped.length}: ${dropped.slice(0, 40).join(', ')}`)
})
