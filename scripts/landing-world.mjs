// The web landing page's map: the world's population, estimated per hexagon,
// as one static SVG (apps/web/public/landing/world-population.svg). Drawn as
// an image, so the landing page needs no engine, no network and no live SVG.
//
//   node scripts/landing-world.mjs
//
// Sources (Natural Earth, public domain):
//   https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip       (POP_EST per country)
//   https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip (pop_max per place: the metro area)
//
// The estimate, per hexagon of equal area (Equal Earth, EPSG:8857, so every
// hexagon covers the same ground): the places inside it (their metro pop_max, at
// most 90% of their country's population, scaled down when over), plus the
// rest of each country's population spread evenly over its land. Coarse on
// purpose: hexagons HEX_KM across. Needs curl and the DuckDB CLI on PATH.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'apps', 'web', 'public', 'landing', 'world-population.svg')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-world-'))
const fwd = (p) => p.replace(/\\/g, '/')
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr || r.error}`)
}

/** Same ramp as Landing.svelte's RAMP (fixed data colors). */
const RAMP = ['#fdecb4', '#fcd27f', '#f9b14f', '#f08a32', '#dd6526', '#b9441f', '#8a2c1b']
/** Class breaks (people per hexagon): RAMP[i] is for values from BREAKS[i - 1]. Landing.svelte's legend labels them. */
const BREAKS = [100e3, 300e3, 1e6, 3e6, 10e6, 30e6]
const HEX_KM = 450 // flat-to-flat (pointy-top hexagons)
const WIDTH = 800 // viewBox width; the height follows the land's extent
const INSET = 0.86 // drawn hexagons are smaller than the grid's, leaving gaps

const countries = path.join(tmp, 'countries.zip')
const places = path.join(tmp, 'places.zip')
run('curl', ['-sSfLo', countries, 'https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip'])
run('curl', ['-sSfLo', places, 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip'])
const json = path.join(tmp, 'hexes.json')

const w = HEX_KM * 1000
const r = w / Math.sqrt(3) // circumradius
run('duckdb', [], `LOAD spatial;
CREATE TEMP TABLE country AS
  SELECT ADM0_A3 AS iso, POP_EST::DOUBLE AS pop,
         ST_Transform(ST_MakeValid(geom), 'EPSG:4326', 'EPSG:8857', always_xy := true) AS g
  FROM ST_Read('/vsizip/${fwd(countries)}/ne_50m_admin_0_countries.shp')
  WHERE ADM0_A3 <> 'ATA' AND POP_EST > 0;
CREATE TEMP TABLE place AS
  SELECT adm0_a3 AS iso, pop_max::DOUBLE AS pop, ST_Transform(geom, 'EPSG:4326', 'EPSG:8857', always_xy := true) AS g
  FROM ST_Read('/vsizip/${fwd(places)}/ne_10m_populated_places_simple.shp')
  WHERE pop_max > 0;
-- Places count up to 90% of their country; the rest is spread over its land.
CREATE TEMP TABLE share AS
  SELECT c.iso, c.pop, ST_Area(c.g) AS area,
         least(1, 0.9 * c.pop / nullif(sum(p.pop), 0)) AS k,
         c.pop - least(coalesce(sum(p.pop), 0), 0.9 * c.pop) AS rural
  FROM country c LEFT JOIN place p USING (iso)
  GROUP BY c.iso, c.pop, c.g;
CREATE TEMP TABLE hex AS
  SELECT q, rr, cx, cy,
         ST_GeomFromText('POLYGON((' || array_to_string([
           (cx + ${r} * cos(radians(60 * (j % 6) - 30)))::VARCHAR || ' ' || (cy + ${r} * sin(radians(60 * (j % 6) - 30)))::VARCHAR
           FOR j IN range(7)], ', ') || '))') AS g
  FROM (
    SELECT q, rr, ${w} * (q + 0.5 * (rr % 2)) AS cx, ${1.5 * r} * rr AS cy
    FROM range(-42, 43) t(q), range(-24, 25) u(rr)
  );
CREATE TEMP TABLE est AS
  SELECT h.q, h.rr, h.cx, h.cy, sum(part) AS pop
  FROM hex h
  JOIN (
    SELECT h.q, h.rr, s.rural * ST_Area(ST_Intersection(h.g, c.g)) / s.area AS part
    FROM hex h JOIN country c ON ST_Intersects(h.g, c.g) JOIN share s USING (iso)
    UNION ALL
    SELECT h.q, h.rr, p.pop * s.k
    FROM hex h JOIN place p ON ST_Contains(h.g, p.g) JOIN share s USING (iso)
  ) USING (q, rr)
  GROUP BY ALL
  HAVING sum(part) >= 1000;
COPY (
  SELECT min(cx) AS x0, max(cx) AS x1, min(cy) AS y0, max(cy) AS y1, sum(pop)::BIGINT AS total,
         list({'x': cx, 'y': cy, 'c': ${BREAKS.map((b) => `(pop >= ${b})::INT`).join(' + ')}} ORDER BY rr DESC, q) AS hexes
  FROM est
) TO '${fwd(json)}' (FORMAT json);`)

const { x0, x1, y0, y1, total, hexes } = JSON.parse(fs.readFileSync(json, 'utf8').trim())
fs.rmSync(tmp, { recursive: true, force: true })

// Grid space to the picture: x right, y down, a hexagon's margin all round.
const f = (WIDTH - 2) / (x1 - x0 + w)
const height = Math.ceil((y1 - y0 + 2 * r) * f) + 2
const px = (x) => (1 + (x - x0 + w / 2) * f).toFixed(1)
const py = (y) => (1 + (y1 - y + r) * f).toFixed(1)
// One hexagon outline, relative to its top corner.
const rd = r * f * INSET
const a = ((rd * Math.sqrt(3)) / 2).toFixed(2)
const b = (rd / 2).toFixed(2)
const c = rd.toFixed(2)
const outline = `l${a} ${b}v${c}l-${a} ${b}l-${a} -${b}v-${c}z`
const byClass = RAMP.map(() => [])
for (const h of hexes) byClass[h.c].push(`M${px(h.x)} ${(py(h.y) - rd).toFixed(1)}${outline}`)
const paths = byClass.map((d, i) => (d.length ? `<path fill="${RAMP[i]}" d="${d.join('')}"/>` : '')).join('\n')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}">
<!-- World population, estimated per ${HEX_KM} km hexagon (Equal Earth). Natural Earth, public domain. Made by scripts/landing-world.mjs. -->
${paths}
</svg>
`
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, svg)
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(0)} KB, ${WIDTH}×${height}); ${hexes.length} hexagons, ${(total / 1e9).toFixed(2)} billion people`)
console.log(`per class: ${byClass.map((d) => d.length).join(' / ')}`)
