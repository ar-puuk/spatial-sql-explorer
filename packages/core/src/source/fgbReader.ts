// FlatGeobuf read in parts, for map views (spec 007; research.md "FlatGeobuf
// views in JS"). DuckDB's ST_Read + spatial_filter_box through GDAL collects
// every index candidate, then reads features one at a time through the file
// handle: on the 1.45 GB 4M-parcel file a city tile took 2-7 s and the
// overview 128 s. Here the `flatgeobuf` reference library searches the
// packed R-tree and reads features in coalesced range batches through
// HostAdapter.readRange, so a view reads only its features' bytes. The
// overview never walks the whole tree: the level above the leaves (one box
// per `indexNodeSize` features, ~10 MB for 4M) is read once, counts what is in
// view, and its node centers stand in for the features as dots.
import { HttpReader } from 'flatgeobuf/lib/mjs/http-reader.js'
import { generateLevelBounds, NODE_ITEM_BYTE_LEN } from 'flatgeobuf/lib/mjs/packedrtree.js'
import { fromFeature } from 'flatgeobuf/lib/mjs/geojson/feature.js'
import type { Bbox, Feature } from '../models.js'

export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>

interface Header {
  featuresCount: number
  indexNodeSize: number
}

/** What a view gets: features (real geometry), or an overview of index node centers. */
export interface FgbView {
  features: Feature[]
  /** Features in view: exact when `exact`, else estimated from the index (a lower bound is never claimed). */
  inView: number
  exact: boolean
  /** True when the view is an overview (node centers, thinned). */
  thinned: boolean
}

/** Overview dots carry ids above every feature index, so they never collide with real features. */
export const FGB_DOT_ID_BASE = 2 ** 40

export class FgbReader {
  private parents: Float64Array | null = null

  private constructor(
    private readonly reader: HttpReader,
    private readonly header: Header,
    private readonly readRange: ReadRange,
    private readonly lengthBeforeTree: number
  ) {}

  /** Opens the file's header (two small reads). Requires a spatial index. */
  static async open(readRange: ReadRange): Promise<FgbReader> {
    const client = {
      async getRange(begin: number, length: number): Promise<ArrayBuffer> {
        return (await readRange(begin, length)).slice().buffer
      },
    }
    const reader = await HttpReader.openSource(client as never)
    const header = (reader as unknown as { header: Header }).header
    const lengthBeforeTree = (reader as unknown as { lengthBeforeTree(): number }).lengthBeforeTree()
    return new FgbReader(reader, header, readRange, lengthBeforeTree)
  }

  get featuresCount(): number {
    return this.header.featuresCount
  }

  /** The index level above the leaves: one box per node of `indexNodeSize` features. Read once. */
  private async parentBoxes(): Promise<Float64Array> {
    if (this.parents) return this.parents
    const levels = generateLevelBounds(this.header.featuresCount, this.header.indexNodeSize)
    // levels[0] holds the features' own boxes; levels[1] their parents (a single root for tiny files).
    const [start, end] = levels[Math.min(1, levels.length - 1)]
    const bytes = await this.readRange(this.lengthBeforeTree + start * NODE_ITEM_BYTE_LEN, (end - start) * NODE_ITEM_BYTE_LEN)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const out = new Float64Array((end - start) * 4)
    for (let i = 0; i < end - start; i++) {
      const o = i * NODE_ITEM_BYTE_LEN
      out[i * 4] = view.getFloat64(o, true)
      out[i * 4 + 1] = view.getFloat64(o + 8, true)
      out[i * 4 + 2] = view.getFloat64(o + 16, true)
      out[i * 4 + 3] = view.getFloat64(o + 24, true)
    }
    this.parents = out
    return out
  }

  /**
   * One map view. Up to `cap` estimated features: every feature in view, read
   * from the file. Above: an overview of index node centers, a proportional
   * deterministic sample of at most `cap` (like the other formats' dots).
   */
  async view(box: Bbox, cap: number, isCancelled: () => boolean): Promise<FgbView> {
    const parents = await this.parentBoxes()
    const nodeSize = this.header.indexNodeSize
    const hits: number[] = []
    for (let i = 0; i < parents.length / 4; i++) {
      if (parents[i * 4 + 2] >= box[0] && parents[i * 4] <= box[2] && parents[i * 4 + 3] >= box[1] && parents[i * 4 + 1] <= box[3]) hits.push(i)
    }
    const estimate = Math.min(this.header.featuresCount, hits.length * nodeSize)
    if (estimate <= cap) {
      const features: Feature[] = []
      const rect = { minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] }
      for await (const { id, feature } of this.reader.selectBbox(rect)) {
        if (isCancelled()) break
        const f = fromFeature(id, feature, this.reader.header) as unknown as { geometry: GeoJSON.Geometry | null; properties?: Record<string, unknown> }
        features.push({ id, geometry: f.geometry, attributes: (f.properties ?? {}) as Feature['attributes'] })
      }
      return { features, inView: features.length, exact: true, thinned: false }
    }
    // Overview: node centers, kept with probability ~cap / nodes by a hash of the node index.
    const keep = Math.min(1, cap / hits.length)
    const features: Feature[] = []
    for (const i of hits) {
      if (hashUnit(i) >= keep) continue
      const x = (parents[i * 4] + parents[i * 4 + 2]) / 2
      const y = (parents[i * 4 + 1] + parents[i * 4 + 3]) / 2
      features.push({ id: FGB_DOT_ID_BASE + i, geometry: { type: 'Point', coordinates: [x, y] }, attributes: {} })
      if (features.length >= cap) break
    }
    return { features, inView: estimate, exact: false, thinned: true }
  }
}

/** A stable pseudo-random number in [0, 1) for a node index (mulberry32 step). */
function hashUnit(n: number): number {
  let t = (n + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
