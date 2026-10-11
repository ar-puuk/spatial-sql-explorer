// Spec 008 sample data (tasks.md T003, research §12): US counties as GeoParquet,
// bundled with both shells so "Try sample data" works with no network.
//
//   node scripts/sample-data.mjs
//
// Sources (US Census Bureau, public domain):
//   https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip   (cartographic boundaries, 1:20m)
//   https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/counties/totals/co-est2023-alldata.csv
// Writes apps/web/public/sample/us-counties.parquet and copies it to
// apps/vscode-ext/sample/. Needs curl and the native DuckDB CLI on PATH.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-sample-'))
const fwd = (p) => p.replace(/\\/g, '/')
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr || r.error}`)
}

const zip = path.join(tmp, 'counties.zip')
const csv = path.join(tmp, 'pop.csv')
run('curl', ['-sSfLo', zip, 'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip'])
run('curl', ['-sSfLo', csv, 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/counties/totals/co-est2023-alldata.csv'])

const webOut = path.join(root, 'apps', 'web', 'public', 'sample', 'us-counties.parquet')
fs.mkdirSync(path.dirname(webOut), { recursive: true })
run('duckdb', [], `INSTALL spatial; LOAD spatial;
COPY (
  SELECT c.NAME AS name, c.STATE_NAME AS state, c.GEOID AS fips,
         p.POPESTIMATE2023::INTEGER AS population,
         round(c.ALAND / 1e6, 1) AS area_km2,
         round(p.POPESTIMATE2023::DOUBLE / nullif(c.ALAND / 1e6, 0), 1) AS density,
         ST_Transform(ST_SimplifyPreserveTopology(c.geom, 0.005), 'EPSG:4269', 'EPSG:4326', always_xy := true)::GEOMETRY('EPSG:4326') AS geom
  FROM ST_Read('/vsizip/${fwd(zip)}/cb_2023_us_county_20m.shp') c
  LEFT JOIN read_csv('${fwd(csv)}', all_varchar = true, header = true, encoding = 'latin-1') p
    ON p.SUMLEV = '050' AND p.STATE || p.COUNTY = c.GEOID
  ORDER BY c.GEOID
) TO '${fwd(webOut)}' (FORMAT parquet, COMPRESSION zstd);`)

const vsOut = path.join(root, 'apps', 'vscode-ext', 'sample', 'us-counties.parquet')
fs.mkdirSync(path.dirname(vsOut), { recursive: true })
fs.copyFileSync(webOut, vsOut)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`wrote ${webOut} (${(fs.statSync(webOut).size / 1e6).toFixed(2)} MB) and ${vsOut}`)
