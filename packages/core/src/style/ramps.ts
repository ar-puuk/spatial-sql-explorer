// Color ramp catalog (spec 003 FR-007/FR-008, research §6). Like the basemap
// catalog, this is DATA: the picker renders from it, and adding a ramp means
// adding a row. Colors are fixed and theme-independent (Constitution III).
import { BREWER as BREWER_CORE, PERCEPTUAL as PERCEPTUAL_CORE } from './rampData.js'
import { BREWER_MORE, PERCEPTUAL_MORE } from './rampDataMore.js'

const BREWER = { ...BREWER_CORE, ...BREWER_MORE }
const PERCEPTUAL = { ...PERCEPTUAL_CORE, ...PERCEPTUAL_MORE }
import { parseColor, rgbToHex, type RampRef } from './model.js'

export type RampKind = 'sequential' | 'diverging' | 'qualitative'

export interface Ramp {
  id: string
  name: string
  kind: RampKind
  license: 'Apache-2.0 (ColorBrewer)' | 'CC0' | 'Apache-2.0 (Google)' | 'BSD-3-Clause (seaborn)' | 'ISC (d3-scale-chromatic)' | 'Published palette (Okabe & Ito)'
  /** Qualitative palettes: how many distinct colors before they repeat. */
  maxClasses?: number
  /** Perceptual colormaps (Viridis and kin: even in lightness, kind to color blindness) or ColorBrewer schemes. */
  family: 'perceptual' | 'brewer'
}

interface RampSource {
  /** A ColorBrewer scheme name (n-class lists) or a perceptual colormap (anchors). */
  brewer?: string
  anchors?: string
}

const ROWS: Array<Omit<Ramp, 'family'> & RampSource> = [
  { id: 'viridis', name: 'Viridis', kind: 'sequential', license: 'CC0', anchors: 'viridis' },
  { id: 'magma', name: 'Magma', kind: 'sequential', license: 'CC0', anchors: 'magma' },
  { id: 'plasma', name: 'Plasma', kind: 'sequential', license: 'CC0', anchors: 'plasma' },
  { id: 'inferno', name: 'Inferno', kind: 'sequential', license: 'CC0', anchors: 'inferno' },
  { id: 'cividis', name: 'Cividis', kind: 'sequential', license: 'CC0', anchors: 'cividis' },
  { id: 'mako', name: 'Mako', kind: 'sequential', license: 'BSD-3-Clause (seaborn)', anchors: 'mako' },
  { id: 'rocket', name: 'Rocket', kind: 'sequential', license: 'BSD-3-Clause (seaborn)', anchors: 'rocket' },
  { id: 'turbo', name: 'Turbo', kind: 'sequential', license: 'Apache-2.0 (Google)', anchors: 'turbo' },
  { id: 'brewer-blues', name: 'Blues', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Blues' },
  { id: 'brewer-greens', name: 'Greens', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Greens' },
  { id: 'brewer-oranges', name: 'Oranges', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Oranges' },
  { id: 'brewer-reds', name: 'Reds', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Reds' },
  { id: 'brewer-purples', name: 'Purples', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Purples' },
  { id: 'brewer-ylorrd', name: 'Yellow–orange–red', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'YlOrRd' },
  { id: 'brewer-ylgnbu', name: 'Yellow–green–blue', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'YlGnBu' },
  { id: 'brewer-bugn', name: 'Blue–green', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'BuGn' },
  { id: 'brewer-bupu', name: 'Blue–purple', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'BuPu' },
  { id: 'brewer-gnbu', name: 'Green–blue', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'GnBu' },
  { id: 'brewer-orrd', name: 'Orange–red', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'OrRd' },
  { id: 'brewer-pubu', name: 'Purple–blue', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'PuBu' },
  { id: 'brewer-pubugn', name: 'Purple–blue–green', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'PuBuGn' },
  { id: 'brewer-purd', name: 'Purple–red', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'PuRd' },
  { id: 'brewer-rdpu', name: 'Red–purple', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'RdPu' },
  { id: 'brewer-ylgn', name: 'Yellow–green', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'YlGn' },
  { id: 'brewer-ylorbr', name: 'Yellow–orange–brown', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'YlOrBr' },
  { id: 'brewer-greys', name: 'Greys', kind: 'sequential', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Greys' },
  { id: 'brewer-rdbu', name: 'Red–blue', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'RdBu' },
  { id: 'brewer-rdylbu', name: 'Red–yellow–blue', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'RdYlBu' },
  { id: 'brewer-brbg', name: 'Brown–teal', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'BrBG' },
  { id: 'brewer-piyg', name: 'Pink–green', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'PiYG' },
  { id: 'brewer-spectral', name: 'Spectral', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Spectral' },
  { id: 'brewer-prgn', name: 'Purple–green', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'PRGn' },
  { id: 'brewer-puor', name: 'Purple–orange', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'PuOr' },
  { id: 'brewer-rdgy', name: 'Red–grey', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'RdGy' },
  { id: 'brewer-rdylgn', name: 'Red–yellow–green', kind: 'diverging', license: 'Apache-2.0 (ColorBrewer)', brewer: 'RdYlGn' },
  { id: 'brewer-set2', name: 'Set 2', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Set2', maxClasses: 8 },
  { id: 'brewer-dark2', name: 'Dark 2', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Dark2', maxClasses: 8 },
  { id: 'brewer-set1', name: 'Set 1', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Set1', maxClasses: 9 },
  { id: 'brewer-paired', name: 'Paired', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Paired', maxClasses: 12 },
  { id: 'brewer-set3', name: 'Set 3', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Set3', maxClasses: 12 },
  { id: 'brewer-accent', name: 'Accent', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Accent', maxClasses: 8 },
  { id: 'brewer-pastel1', name: 'Pastel 1', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Pastel1', maxClasses: 9 },
  { id: 'brewer-pastel2', name: 'Pastel 2', kind: 'qualitative', license: 'Apache-2.0 (ColorBrewer)', brewer: 'Pastel2', maxClasses: 8 },
  { id: 'okabe-ito', name: 'Okabe–Ito (color-blind safe)', kind: 'qualitative', license: 'Published palette (Okabe & Ito)', brewer: 'OkabeIto', maxClasses: 8 },
  { id: 'tableau10', name: 'Tableau 10', kind: 'qualitative', license: 'ISC (d3-scale-chromatic)', brewer: 'Tableau10', maxClasses: 10 },
]

export const RAMPS: readonly Ramp[] = ROWS.map(({ brewer: _b, anchors, ...ramp }) => ({ ...ramp, family: anchors ? ('perceptual' as const) : ('brewer' as const) }))

const byId = new Map(ROWS.map((r) => [r.id, r]))

export function rampById(id: string): Ramp | undefined {
  const r = byId.get(id)
  return r ? RAMPS.find((x) => x.id === r.id) : undefined
}

/** Graduated uses sequential and diverging ramps; Categorized uses qualitative palettes. */
export function rampsFor(renderer: 'categorized' | 'graduated'): readonly Ramp[] {
  return RAMPS.filter((r) => (renderer === 'categorized' ? r.kind === 'qualitative' : r.kind !== 'qualitative'))
}

/** Viridis for graduated; Set 2 up to 8 categories, Paired for 9–12 (research §6). */
export function defaultRamp(renderer: 'categorized' | 'graduated', classCount: number): RampRef {
  if (renderer === 'graduated') return { id: 'viridis', reversed: false }
  return { id: classCount <= 8 ? 'brewer-set2' : 'brewer-paired', reversed: false }
}

/**
 * `n` colors for the ramp, low to high (or reversed). ColorBrewer's own
 * n-class list when it has one; otherwise even samples in CIE Lab across the
 * longest list (or the anchors). Qualitative palettes never interpolate: they
 * repeat in order past their length (the panel says so).
 */
export function rampColors(ref: RampRef, n: number): string[] {
  const count = Math.max(0, Math.floor(n))
  const src = byId.get(ref.id) ?? ROWS[0] // unknown ids (e.g. from a newer file) fall back to Viridis
  const lists = src.brewer ? BREWER[src.brewer] : undefined
  let colors: string[]
  if (src.kind === 'qualitative' && lists) {
    const list = largest(lists)
    colors = Array.from({ length: count }, (_, i) => list[i % list.length])
  } else if (lists?.[count]) {
    colors = [...lists[count]]
  } else {
    const anchors = src.anchors ? [...PERCEPTUAL[src.anchors]] : lists ? largest(lists) : [...PERCEPTUAL.viridis]
    colors = sample(anchors, count)
  }
  return ref.reversed ? colors.reverse() : colors
}

function largest(lists: Readonly<Record<number, readonly string[]>>): string[] {
  const max = Math.max(...Object.keys(lists).map(Number))
  return [...lists[max]]
}

/** `n` evenly spaced colors along the anchors, interpolated in Lab. */
function sample(anchors: string[], n: number): string[] {
  if (n <= 0) return []
  if (n === 1) return [anchors[Math.floor((anchors.length - 1) / 2)]]
  const labs = anchors.map(toLab)
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (labs.length - 1)
    const k = Math.min(Math.floor(t), labs.length - 2)
    const f = t - k
    const [a, b] = [labs[k], labs[k + 1]]
    return fromLab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
  })
}

// --- sRGB <-> CIE Lab (D65) -----------------------------------------------

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const WHITE = [0.95047, 1, 1.08883]
const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
const fi = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))

export function toLab(hex: string): [number, number, number] {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 }
  const [r, g, b] = [lin(c.r / 255), lin(c.g / 255), lin(c.b / 255)]
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0]
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1]
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2]
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function fromLab([l, a, bb]: number[]): string {
  const fy = (l + 16) / 116
  const [x, y, z] = [fi(fy + a / 500) * WHITE[0], fi(fy) * WHITE[1], fi(fy - bb / 200) * WHITE[2]]
  const r = gam(3.2404542 * x - 1.5371385 * y - 0.4985314 * z)
  const g = gam(-0.969266 * x + 1.8760108 * y + 0.041556 * z)
  const b = gam(0.0556434 * x - 0.2040259 * y + 1.0572252 * z)
  return rgbToHex({ r: r * 255, g: g * 255, b: b * 255 })
}
