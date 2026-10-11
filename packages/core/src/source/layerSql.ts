// The SQL that defines `layer` (spec 007, research §9). Two views:
// - `__se_layer` (internal) adds the hidden columns every map view, table
//   page and selection needs: a stable `__se_rowid` and the feature bbox
//   (`__se_xmin/ymin/xmax/ymax`, in the layer's CRS);
// - `layer` (what users query) reads the same source directly, without them,
//   so `SELECT * FROM layer` sees only the file's columns, and user queries
//   never pay for a row-number window or lose filter pushdown.
// Pure builders: tested without an engine (tests/core/result-model.test.ts).
import { quoteIdent } from '../query/util.js'

export const HIDDEN_COLUMNS = ['__se_rowid', '__se_xmin', '__se_ymin', '__se_xmax', '__se_ymax'] as const
export const INTERNAL_LAYER = '__se_layer'

/** Engine-internal names: never shown, exported, offered in autocomplete or used for styling. */
export function isHiddenColumn(name: string): boolean {
  return name.startsWith('__se_')
}

export function visibleColumns<T extends { name: string }>(columns: readonly T[]): T[] {
  return columns.filter((c) => !isHiddenColumn(c.name))
}

const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`

export type LayerViewSource =
  /** GeoParquet / Parquet read in parts. `covering`: the bbox struct column, or null. */
  | { kind: 'parquet'; path: string; attrs: string[]; geomExpr: string; geomName: string; covering: string | null }
  /** A table parsed once (whole-read formats), already holding the hidden columns. */
  | { kind: 'table'; table: string; attrs: string[]; geomExpr: string; geomName: string }
  /** Any reader or table without stored hidden columns: row ids in read order, bbox computed. */
  | { kind: 'reader'; from: string; attrs: string[]; geomExpr: string; geomName: string }
  /** FlatGeobuf read in parts through GDAL; `rowidExpr` is the feature id. */
  | { kind: 'st_read'; path: string; attrs: string[]; geomExpr: string; geomName: string; rowidExpr: string }

const bboxFrom = (g: string): string[] => [`ST_XMin(${g}) AS __se_xmin`, `ST_YMin(${g}) AS __se_ymin`, `ST_XMax(${g}) AS __se_xmax`, `ST_YMax(${g}) AS __se_ymax`]

const headOf = (src: LayerViewSource): string[] => [...src.attrs.map(quoteIdent), `${src.geomExpr} AS ${quoteIdent(src.geomName)}`]

function fromOf(src: LayerViewSource): string {
  switch (src.kind) {
    case 'parquet':
      return `read_parquet(${literal(src.path)}, file_row_number := true)`
    case 'table':
      return src.table
    case 'reader':
      return src.from
    case 'st_read':
      return `ST_Read(${literal(src.path)})`
  }
}

export function internalLayerViewSql(src: LayerViewSource): string {
  const head = headOf(src)
  const from = fromOf(src)
  let rest: string[]
  switch (src.kind) {
    case 'parquet': {
      const c = src.covering === null ? null : quoteIdent(src.covering)
      rest = [
        'file_row_number AS __se_rowid',
        ...(c ? [`${c}.xmin AS __se_xmin`, `${c}.ymin AS __se_ymin`, `${c}.xmax AS __se_xmax`, `${c}.ymax AS __se_ymax`] : bboxFrom(src.geomExpr)),
      ]
      break
    }
    case 'table':
      rest = [...HIDDEN_COLUMNS]
      break
    case 'reader':
      rest = ['row_number() OVER () - 1 AS __se_rowid', ...bboxFrom(src.geomExpr)]
      break
    case 'st_read':
      rest = [`${src.rowidExpr} AS __se_rowid`, ...bboxFrom(src.geomExpr)]
      break
  }
  return `CREATE OR REPLACE VIEW ${INTERNAL_LAYER} AS SELECT ${[...head, ...rest].join(', ')} FROM ${from}`
}

export function publicLayerViewSql(src: LayerViewSource): string {
  return `CREATE OR REPLACE VIEW layer AS SELECT ${headOf(src).join(', ')} FROM ${fromOf(src)}`
}
