// Spec 010 fixtures, written into tests/vscode-ext/fixtures/:
//   places.xlsx   one sheet: name, lon, lat, pop for 3 Utah cities (xlsx input, research.md S9)
//
//   node scripts/fixtures-010.mjs
//
// Needs the native DuckDB CLI on PATH (its excel extension writes the workbook).
// Existing files are kept: delete one to regenerate it.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'tests', 'vscode-ext', 'fixtures')
const out = (f) => path.join(dir, f).replace(/\\/g, '/')
const exists = (f) => fs.existsSync(path.join(dir, f))

function duckdb(sql) {
  const r = spawnSync('duckdb', [], { input: sql, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`duckdb failed:\n${r.stderr || r.error}`)
}

if (!exists('places.xlsx')) {
  duckdb(`INSTALL excel; LOAD excel;
COPY (SELECT * FROM (VALUES ('Salt Lake City', -111.891, 40.7608, 200133), ('Provo', -111.6585, 40.2338, 115162), ('Ogden', -111.9738, 41.223, 87321)) t(name, lon, lat, pop))
  TO '${out('places.xlsx')}' (FORMAT xlsx, HEADER true);`)
  console.log('wrote places.xlsx')
}
