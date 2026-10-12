// Spec 009 fixtures (tasks.md T001), written into tests/vscode-ext/fixtures/:
//   roads-traffic.geojson       2,000 lines with functional_class (5 values), aadt (log-normal,
//                               every 40th null) and lanes (1-4): color by one column, width by another
//   counties-bivariate.geojson  600 grid polygons with poverty_rate and obesity_rate (correlated;
//                               every 50th row null in one or the other) and name: bivariate maps
//
//   node scripts/fixtures-009.mjs
//
// Plain Node, seeded: the output is identical on every run. Existing files are
// kept: delete one to regenerate it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'tests', 'vscode-ext', 'fixtures')
const exists = (f) => fs.existsSync(path.join(dir, f))

/** mulberry32: a small seeded PRNG, so the fixtures are deterministic. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Standard normal from two uniforms (Box-Muller). */
const normal = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
const r4 = (n) => Math.round(n * 1e4) / 1e4

function write(name, features) {
  const text = `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`
  fs.writeFileSync(path.join(dir, name), text)
  console.log(`wrote ${name} (${features.length} features)`)
}

if (!exists('roads-traffic.geojson')) {
  const rand = rng(9001)
  const classes = ['Interstate', 'Principal Arterial', 'Minor Arterial', 'Collector', 'Local']
  // Typical traffic per class: the log-normal centers, so classes and aadt correlate loosely.
  const center = [60000, 25000, 12000, 5000, 1500]
  const features = []
  for (let i = 0; i < 2000; i++) {
    const c = Math.min(4, Math.floor(rand() * rand() * 6 + rand() * 2))
    const aadt = i % 40 === 7 ? null : Math.round(center[c] * Math.exp(normal(rand) * 0.6))
    const x = -112.05 + (i % 50) * 0.004
    const y = 40.6 + Math.floor(i / 50) * 0.004
    const dx = 0.003 * (0.5 + rand())
    const dy = 0.003 * (rand() - 0.5)
    features.push({
      type: 'Feature',
      properties: { id: i + 1, functional_class: classes[c], aadt, lanes: 1 + Math.min(3, Math.floor((4 - c) * rand() + c / 4)) },
      geometry: { type: 'LineString', coordinates: [[r4(x), r4(y)], [r4(x + dx / 2), r4(y + dy)], [r4(x + dx), r4(y)]] },
    })
  }
  write('roads-traffic.geojson', features)
}

if (!exists('counties-bivariate.geojson')) {
  const rand = rng(4242)
  const features = []
  for (let i = 0; i < 600; i++) {
    const col = i % 30
    const row = Math.floor(i / 30)
    // A regional trend plus noise; obesity correlates with poverty (~0.6).
    const base = normal(rand)
    const poverty = Math.max(2, Math.round((14 + 5 * base + 3 * normal(rand) + col * 0.15) * 10) / 10)
    const obesity = Math.max(15, Math.round((31 + 3 * (0.6 * base + 0.8 * normal(rand)) + row * 0.1) * 10) / 10)
    const x = -114 + col * 0.25
    const y = 37 + row * 0.25
    features.push({
      type: 'Feature',
      properties: {
        id: i + 1,
        name: `County ${i + 1}`,
        poverty_rate: i % 50 === 11 ? null : poverty,
        obesity_rate: i % 50 === 37 ? null : obesity,
      },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.25, y], [x + 0.25, y + 0.25], [x, y + 0.25], [x, y]]] },
    })
  }
  write('counties-bivariate.geojson', features)
}
