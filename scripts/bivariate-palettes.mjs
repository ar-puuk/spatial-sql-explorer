// Spec 009 T035 (research §8): generates packages/core/src/style/bivariateData.ts,
// the 3x3 bivariate palettes. No palette data is copied from anywhere: each
// grid is a bilinear interpolation in CIELAB between four corners:
//   low/low   a light neutral, #e8e8e8;
//   high x    a ColorBrewer anchor already vendored in rampData.ts;
//   high y    another vendored ColorBrewer anchor;
//   high/high the average CIELAB hue (a, b) of the two high corners at lightness 28.
// Each palette is scored: the smallest CIE76 difference between two of its 9
// cells, plainly and under a deuteranope simulation (Machado et al. 2009,
// severity 1). Below 15 (plain) the script fails; below 12 (deuteranope) the
// palette is marked with a note. Rerun after changing a palette:
//
//   node scripts/bivariate-palettes.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rampSource = fs.readFileSync(path.join(root, 'packages/core/src/style/rampData.ts'), 'utf8')

/** A vendored ColorBrewer color: scheme, class count, index. */
function brewer(scheme, n, i) {
  const at = rampSource.indexOf(`  ${scheme}: {`)
  if (at < 0) throw new Error(`ColorBrewer ${scheme} is not in rampData.ts`)
  const list = rampSource.slice(at).match(new RegExp(`\\n\\s+${n}: \\[([^\\]]+)\\]`))
  const colors = list?.[1].match(/#[0-9a-f]{6}/g)
  if (!colors?.[i]) throw new Error(`ColorBrewer ${scheme}[${n}][${i}] is missing`)
  return colors[i]
}

const PALETTES = [
  { id: 'orange-blue', name: 'Orange – Blue', x: brewer('Oranges', 3, 2), y: brewer('Blues', 3, 2) },
  { id: 'red-blue', name: 'Red – Blue', x: brewer('Reds', 3, 2), y: brewer('YlGnBu', 3, 2) },
  { id: 'green-purple', name: 'Green – Purple', x: brewer('Greens', 3, 2), y: brewer('Purples', 3, 2) },
  { id: 'pink-blue', name: 'Pink – Blue', x: brewer('PiYG', 9, 0), y: brewer('Blues', 3, 2) },
]
// Spec 015: the five built-in palettes of mapgl's `bivariate_palettes()` (R package, https://github.com/walkerke/mapgl;
// MIT License, Copyright (c) Kyle Walker): "blue_pink" is Joshua Stevens' well-known bivariate scheme. Row-major from
// low/low (index i + 3j: i axis 1 class, j axis 2 class), as mapgl's matrices read.
const FROM_MAPGL = [
  { id: 'blue-pink', name: 'Blue – Pink', cells: ['#e8e8e8', '#ace4e4', '#5ac8c8', '#dfb0d6', '#a5add3', '#5698b9', '#be64ac', '#8c62aa', '#3b4994'] },
  { id: 'blue-red', name: 'Blue – Red', cells: ['#e8e8e8', '#e4acac', '#c85a5a', '#b0d5df', '#ad9ea5', '#985356', '#64acbe', '#627f8c', '#574249'] },
  { id: 'green-blue', name: 'Green – Blue', cells: ['#e8e8e8', '#b5c0da', '#6c83b5', '#b8d6be', '#90b2b3', '#567994', '#73ae80', '#5a9178', '#2a5a5b'] },
  { id: 'purple-orange', name: 'Purple – Orange', cells: ['#f2f2f2', '#fddbc7', '#f4a582', '#d1e5f0', '#b3a2c7', '#b35806', '#67a9cf', '#8073ac', '#542788'] },
  { id: 'brown-green', name: 'Brown – Green', cells: ['#f5f5f5', '#c7eae5', '#80cdc1', '#dfc27d', '#a6b88f', '#35978f', '#bf812d', '#8c6d31', '#01665e'] },
]
const LOW = '#e8e8e8'
const HIGH_HIGH_L = 28

// --- color math (sRGB D65 <-> CIELAB) -------------------------------------------
const W = [0.95047, 1, 1.08883]
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (c) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const unlin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055)
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
const fi = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
function toLab(c) {
  const [r, g, b] = c.map(lin)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / W[0]
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / W[2]
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}
function fromLab([L, a, bb]) {
  const fy = (L + 16) / 116
  const x = fi(fy + a / 500) * W[0]
  const y = fi(fy)
  const z = fi(fy - bb / 200) * W[2]
  return [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z].map(unlin)
}
const DEUTERANOPE = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
]
const deuteranope = (c) => {
  const l = c.map(lin)
  return DEUTERANOPE.map((row) => unlin(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))))
}
const dE = (a, b) => Math.hypot(...toLab(a).map((v, i) => v - toLab(b)[i]))
const minDE = (cells, view = (x) => x) => {
  let m = Infinity
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) m = Math.min(m, dE(view(cells[i]), view(cells[j])))
  return m
}

/** The 3x3 grid, row-major from low/low: index i + 3j (i: x class, j: y class). */
function grid(x, y) {
  const A = toLab(hex(LOW))
  const B = toLab(hex(x))
  const C = toLab(hex(y))
  const D = [HIGH_HIGH_L, (B[1] + C[1]) / 2, (B[2] + C[2]) / 2]
  const cells = []
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const u = i / 2
      const v = j / 2
      cells.push(fromLab([0, 1, 2].map((k) => (1 - u) * (1 - v) * A[k] + u * (1 - v) * B[k] + (1 - u) * v * C[k] + u * v * D[k])))
    }
  return cells
}

const out = []
for (const p of PALETTES) {
  const cells = grid(p.x, p.y)
  const plain = minDE(cells)
  const cvd = minDE(cells, deuteranope)
  if (plain < 15) throw new Error(`${p.id}: cells too close (min ΔE ${plain.toFixed(1)} < 15)`)
  const note = cvd < 12 ? 'Less distinct for red-green color blindness.' : undefined
  out.push({ id: p.id, name: p.name, cells: cells.map(toHex), ...(note ? { note } : {}) })
  console.log(`${p.id.padEnd(14)} ΔE ${plain.toFixed(1)}  deuteranope ${cvd.toFixed(1)}${note ? '  (note)' : ''}`)
}

for (const p of FROM_MAPGL) {
  const rgbCells = p.cells.map(hex)
  const cvd = minDE(rgbCells, deuteranope)
  const plain = minDE(rgbCells)
  const notes = [plain < 15 ? 'Some cells are close in color.' : '', cvd < 12 ? 'Less distinct for red-green color blindness.' : ''].filter(Boolean)
  out.push({ id: p.id, name: p.name, cells: p.cells, ...(notes.length ? { note: notes.join(' ') } : {}) })
  console.log(`${p.id.padEnd(14)} ΔE ${minDE(rgbCells).toFixed(1)}  deuteranope ${cvd.toFixed(1)}  (mapgl)`)
}

const file = `// GENERATED by scripts/bivariate-palettes.mjs (spec 009 research §8). Do not edit by hand.
// Bilinear CIELAB interpolation between #e8e8e8, two ColorBrewer anchors from
// rampData.ts (Copyright (c) 2002 Cynthia Brewer, Mark Harrower, and The
// Pennsylvania State University; Apache-2.0) and their average hue at
// lightness ${HIGH_HIGH_L}; and (spec 015) the five palettes of mapgl's bivariate_palettes() (MIT, Copyright (c) Kyle
// Walker; "blue-pink" is Joshua Stevens' scheme), kept as they are. Cells are row-major from low/low: index i + 3j.

export interface BivariatePalette {
  id: string
  name: string
  /** 9 colors, \`#rrggbb\`, cell (i, j) at index i + 3j (i: axis 1 class, j: axis 2 class). */
  cells: readonly string[]
  /** e.g. less distinct for red-green color blindness. */
  note?: string
}

export const BIVARIATE_PALETTES: ReadonlyArray<BivariatePalette> = ${JSON.stringify(out, null, 2).replace(/"(\w+)":/g, '$1:').replace(/"/g, "'")}
`
fs.writeFileSync(path.join(root, 'packages/core/src/style/bivariateData.ts'), file)
console.log('wrote packages/core/src/style/bivariateData.ts')
