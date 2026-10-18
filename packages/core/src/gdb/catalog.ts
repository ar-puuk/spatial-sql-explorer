// Reads `ogrinfo -json -so -al` of a File Geodatabase (as gdal3.js returns it,
// spikes in specs/013-file-geodatabase/spikes/) into the layer list and the
// domains. Pure: tests feed it saved output.
import type { GeometryType } from '../models.js'
import type { ColumnDomains, GdbCatalog, GdbDomain, GdbField, GdbLayerInfo } from './types.js'

interface OgrField {
  name: string
  type: string
  domainName?: string
}
interface OgrGeometryField {
  name?: string
  type?: string
  coordinateSystem?: { wkt?: string; projjson?: { id?: { authority?: string; code?: number | string } } }
}
interface OgrLayer {
  name: string
  featureCount?: number
  geometryFields?: OgrGeometryField[]
  fields?: OgrField[]
}
interface OgrGroup {
  name?: string
  layerNames?: string[]
  groups?: OgrGroup[]
}
interface OgrDomain {
  type?: string
  fieldType?: string
  description?: string
  codedValues?: Record<string, string>
}
export interface OgrInfoJson {
  layers?: OgrLayer[]
  domains?: Record<string, OgrDomain>
  rootGroup?: OgrGroup
}

/** The geodatabase's own bookkeeping tables (ArcGIS never shows them). */
export function isGdbSystemTable(name: string): boolean {
  return /^GDB_/i.test(name)
}

/** OGR geometry type names (curves read as lines, surfaces as polygons) to the app's types. */
export function geometryTypeFromOgr(raw: string | undefined): GeometryType | null {
  if (!raw) return null
  const t = raw.toUpperCase()
  if (t.includes('POINT')) return 'Point'
  if (t.includes('POLYGON') || t.includes('SURFACE') || t.includes('TRIANGLE') || t.includes('TIN')) return 'Polygon'
  if (t.includes('LINE') || t.includes('CURVE')) return 'LineString'
  return 'Mixed'
}

function sridOf(g: OgrGeometryField | undefined): number | null {
  const id = g?.coordinateSystem?.projjson?.id
  if (id?.authority?.toUpperCase() === 'EPSG') {
    const code = Number(id.code)
    if (Number.isInteger(code) && code > 0) return code
  }
  return null
}

/** Layer name to feature dataset, from the info's group tree (one level deep in practice). */
function datasetsOf(group: OgrGroup | undefined): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (g: OgrGroup, dataset: string | null): void => {
    for (const name of g.layerNames ?? []) if (dataset) out.set(name, dataset)
    for (const sub of g.groups ?? []) walk(sub, sub.name ?? dataset)
  }
  if (group) walk(group, null)
  return out
}

function domainOf(name: string, d: OgrDomain): GdbDomain {
  const kind = d.type === 'coded' ? 'coded' : d.type === 'range' ? 'range' : 'other'
  return { name, kind, fieldType: d.fieldType ?? '', description: d.description ?? '', codes: kind === 'coded' ? { ...(d.codedValues ?? {}) } : {} }
}

/** `name`: the geodatabase's name (`network.gdb`). System tables are left out; every other table is kept. */
export function parseCatalog(info: OgrInfoJson, name: string): GdbCatalog {
  const datasets = datasetsOf(info.rootGroup)
  const layers: GdbLayerInfo[] = []
  for (const l of info.layers ?? []) {
    if (isGdbSystemTable(l.name)) continue
    const geometry = l.geometryFields?.[0]
    const spatial = geometry !== undefined
    const fields: GdbField[] = (l.fields ?? []).map((f) => ({ name: f.name, type: f.type, domain: f.domainName ?? null }))
    layers.push({
      name: l.name,
      geometryType: spatial ? geometryTypeFromOgr(geometry.type) : null,
      geometryColumn: spatial ? 'geom' : null,
      featureCount: typeof l.featureCount === 'number' && l.featureCount >= 0 ? l.featureCount : null,
      srid: sridOf(geometry),
      featureDataset: datasets.get(l.name) ?? null,
      spatial,
      fields,
      crsWkt: geometry?.coordinateSystem?.wkt ?? null,
    })
  }
  const domains: Record<string, GdbDomain> = {}
  for (const [domainName, d] of Object.entries(info.domains ?? {})) domains[domainName] = domainOf(domainName, d)
  return { name, layers, domains }
}

/** The coded domains of one layer's columns: column to (code to description). Range domains and uncoded columns are left out. */
export function layerDomains(layer: GdbLayerInfo, domains: Readonly<Record<string, GdbDomain>>): ColumnDomains {
  const out: ColumnDomains = {}
  for (const f of layer.fields) {
    const d = f.domain ? domains[f.domain] : undefined
    if (d?.kind === 'coded' && Object.keys(d.codes).length) out[f.name] = d.codes
  }
  return out
}
