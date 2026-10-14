// Spec 011 fixtures (tasks.md T001), written into tests/vscode-ext/fixtures/:
//   roads-los.geojson      1,500 lines with los (A-F, every 30th null), volume (log-normal,
//                          every 40th null) and name: color by one column, width by another
//   crashes.geojson        3,000 points with severity (4 values), crash_type (9 values, uneven),
//                          heading (0-359), age_days, hex_color (every 25th invalid) and name:
//                          shape, rotation, opacity and as-is colors by column
//   counties-011.geojson   600 grid polygons with pop, density and name: continuous color, labels
//
//   node scripts/fixtures-011.mjs
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
const pick = (rand, list) => list[Math.floor(rand() * list.length)]

function write(name, features) {
  const text = `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`
  fs.writeFileSync(path.join(dir, name), text)
  console.log(`wrote ${name} (${features.length} features)`)
}

const STREETS = ['Main St', 'Oak Ave', 'Ålesund Way', 'Café Row', 'Elm Rd', 'Pine Blvd', 'Šumava Ln', 'Cedar Dr', 'Birch Ct', 'Maple Pkwy', 'Δέλτα St', 'Willow Way']

if (!exists('roads-los.geojson')) {
  const rand = rng(1101)
  const LOS = ['A', 'B', 'C', 'D', 'E', 'F']
  const features = []
  for (let i = 0; i < 1500; i++) {
    // Busier roads tend to a worse level of service: volume and LOS correlate loosely.
    const v = Math.exp(8.5 + normal(rand) * 0.9)
    const grade = Math.max(0, Math.min(5, Math.floor(Math.log(v) - 6 + rand() * 2)))
    const x = -111.95 + (i % 50) * 0.005
    const y = 40.65 + Math.floor(i / 50) * 0.005
    const dx = 0.004 * (0.5 + rand())
    const dy = 0.004 * (rand() - 0.5)
    features.push({
      type: 'Feature',
      properties: {
        id: i + 1,
        los: i % 30 === 13 ? null : LOS[grade],
        volume: i % 40 === 21 ? null : Math.round(v),
        name: `${STREETS[i % STREETS.length]} ${Math.floor(i / STREETS.length) + 1}`,
      },
      geometry: { type: 'LineString', coordinates: [[r4(x), r4(y)], [r4(x + dx / 2), r4(y + dy)], [r4(x + dx), r4(y)]] },
    })
  }
  write('roads-los.geojson', features)
}

if (!exists('crashes.geojson')) {
  const rand = rng(1102)
  const SEVERITY = ['Fatal', 'Serious injury', 'Minor injury', 'Property damage']
  const severityWeights = [0.02, 0.1, 0.33, 0.55]
  // Nine types with uneven frequencies: the three rarest fall into Other for shapes (6 + Other).
  const TYPES = ['Rear end', 'Angle', 'Sideswipe', 'Head on', 'Single vehicle', 'Pedestrian', 'Bicycle', 'Animal', 'Rollover']
  const typeWeights = [0.3, 0.22, 0.14, 0.1, 0.09, 0.06, 0.04, 0.03, 0.02]
  const weighted = (weights) => {
    let u = rand()
    for (let k = 0; k < weights.length; k++) if ((u -= weights[k]) < 0) return k
    return weights.length - 1
  }
  const hex = (n) => n.toString(16).padStart(2, '0')
  const features = []
  for (let i = 0; i < 3000; i++) {
    const x = -111.95 + rand() * 0.25
    const y = 40.65 + rand() * 0.15
    const color = `#${hex(Math.floor(rand() * 256))}${hex(Math.floor(rand() * 256))}${hex(Math.floor(rand() * 256))}`
    features.push({
      type: 'Feature',
      properties: {
        id: i + 1,
        severity: SEVERITY[weighted(severityWeights)],
        crash_type: TYPES[weighted(typeWeights)],
        heading: Math.floor(rand() * 360),
        age_days: Math.floor(rand() * 3651),
        hex_color: i % 25 === 9 ? 'not-a-color' : color,
        name: `${pick(rand, STREETS)} #${i + 1}`,
      },
      geometry: { type: 'Point', coordinates: [r4(x), r4(y)] },
    })
  }
  write('crashes.geojson', features)
}

if (!exists('counties-011.geojson')) {
  const rand = rng(1103)
  const features = []
  for (let i = 0; i < 600; i++) {
    const col = i % 30
    const row = Math.floor(i / 30)
    const area = 0.25 * 0.25 * 9600 // km² per cell at ~38°N, roughly
    const pop = Math.round(Math.exp(9.5 + normal(rand) * 1.2 + (col - 15) * 0.03))
    const x = -114 + col * 0.25
    const y = 37 + row * 0.25
    features.push({
      type: 'Feature',
      properties: { id: i + 1, name: `County ${i + 1}`, pop, density: Math.round((pop / area) * 100) / 100 },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.25, y], [x + 0.25, y + 0.25], [x, y + 0.25], [x, y]]] },
    })
  }
  write('counties-011.geojson', features)
}
