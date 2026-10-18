// Opening a File Geodatabase through the shell's reader (spec 013): list the
// layers, convert the one to open into a FlatGeobuf the normal pipeline reads,
// and give every other layer a view in the geodatabase's schema that is filled
// in the first time a query names it.
import type { OpenedFileRef } from '../hostAdapter.js'
import { activeLayerOf } from '../source/layers.js'
import { quoteIdent, quoteLiteral } from '../query/util.js'
import { GdbError, type GdbCallOptions, type GdbCatalog, type GdbConverted, type GdbHost, type GdbLayerInfo } from './types.js'

export const GDB_NO_READER =
  "This build can't read File Geodatabases. Convert it to GeoPackage, for example: ogr2ogr -f GPKG out.gpkg in.gdb"

export interface GdbOpened {
  catalog: GdbCatalog
  /** The geometry layer opened as `layer`. */
  active: GdbLayerInfo
  converted: GdbConverted
  /** `network.gdb` for `network.gdb` and `network.gdb.zip` (what SQL names are cleaned from). */
  fileName: string
}

/** `network.gdb.zip` and `network.gdb` are both the geodatabase `network.gdb`. */
export function gdbFileName(name: string): string {
  return name.replace(/\.zip$/i, '')
}

/** Lists the geodatabase and converts the layer to open (the requested one, else the first with geometry). */
export async function openGeodatabaseLayer(ref: OpenedFileRef, host: GdbHost | undefined, options: GdbCallOptions & { layer?: string }): Promise<GdbOpened> {
  if (!host) throw new GdbError(GDB_NO_READER, 'unreadable')
  options.onProgress?.({ phase: 'list' })
  const catalog = await host.list(ref, options)
  const active = activeLayerOf(
    catalog.layers.filter((l) => l.spatial),
    options.layer
  )
  if (!active) throw new GdbError('This geodatabase has no layer with geometry. Its tables can only be queried by name, and opening one needs a layer to show.', 'unreadable')
  const converted = await host.convert(ref, active as GdbLayerInfo, options)
  return { catalog, active: active as GdbLayerInfo, converted, fileName: gdbFileName(catalog.name || ref.displayName) }
}

/** OGR field types as DuckDB types, for the empty view that stands in for a layer not read yet. */
function sqlType(ogrType: string): string {
  switch (ogrType) {
    case 'Integer':
    case 'Integer64':
      return 'BIGINT'
    case 'Real':
      return 'DOUBLE'
    case 'Date':
      return 'DATE'
    case 'DateTime':
      return 'TIMESTAMP'
    case 'Binary':
      return 'BLOB'
    default:
      return 'VARCHAR'
  }
}

/**
 * A layer not read yet, as a table with its columns and no rows: autocomplete
 * and DESCRIBE see its shape, and the first query that names it replaces the
 * view with the real one (QuerySession's lazy layers).
 */
export function placeholderViewSql(sqlName: string, layer: GdbLayerInfo): string {
  const columns = layer.fields.map((f) => `NULL::${sqlType(f.type)} AS ${quoteIdent(f.name)}`)
  if (layer.spatial) columns.push(`NULL::GEOMETRY AS ${quoteIdent('geom')}`)
  if (!columns.length) columns.push('NULL::VARCHAR AS "(no columns)"')
  return `CREATE OR REPLACE VIEW ${sqlName} AS SELECT ${columns.join(', ')} WHERE false`
}

/**
 * The view of a converted layer: GDAL's synthetic OGC_FID dropped, like every other multi-layer file's views.
 * A table without shapes comes back from the reader with an empty `geom` column; it is left out.
 */
export function convertedViewSql(sqlName: string, path: string, spatial = true): string {
  const dropped = spatial ? `c <> 'OGC_FID'` : `c NOT IN ('OGC_FID', 'geom')`
  return `CREATE OR REPLACE VIEW ${sqlName} AS SELECT COLUMNS(c -> ${dropped}) FROM ST_Read(${quoteLiteral(path)})`
}

/**
 * The SQL names in `names` (`schema.layer`, either part possibly quoted) that
 * a statement mentions: the layers to read before it runs.
 */
export function namedLayers(statement: string, names: ReadonlyMap<string, string>): string[] {
  const hits: string[] = []
  for (const [layerName, sqlName] of names) {
    const parts = sqlName.split('.').map((p) => p.replace(/^"|"$/g, '').replace(/""/g, '"'))
    const pattern = parts.map((p) => `(?:"${escapeRegExp(p)}"|${escapeRegExp(p)})`).join('\\s*\\.\\s*')
    if (new RegExp(`(?<![\\w"$.])${pattern}(?![\\w"$])`, 'i').test(statement)) hits.push(layerName)
  }
  return hits
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
