// Spec 023: the snippet library. A snippet is a complete, runnable query for the open layer ("buffer every feature", "count points in
// each polygon of another file"), written with the layer's own table name, geometry column and a number or text column, and with a
// few editable fields (the distance, the column) that Tab moves between. Pure text: it needs the layer's facts, never the engine.
//
// Templates use the editor's snippet syntax: `${1:default}` is a field, and a field number used twice is one field written twice.
// `plainSql` drops the markers (what the query reads when nothing is edited), and is what the tests run against the engine.
import type { Bbox, GeometryType } from '../models.js'
import { quoteIdent } from '../query/util.js'
import { isNumericType } from '../style/resolve.js'

export type SnippetCategory = 'Reshape' | 'Measure' | 'Select' | 'Summarize' | 'Combine'

/** What a template needs to know about the open layer. */
export interface SnippetContext {
  /** The table to query: the file's own name (`us_counties`) or `layer`. */
  table: string
  /** The geometry column as SQL (quoted). */
  geom: string
  /** The geometry in longitude and latitude, as SQL (the column itself, or converted when the layer is projected). */
  geom4326: string
  /** Whether the layer's coordinates are degrees (distances and tolerances are then small numbers). */
  geographic: boolean
  geometryType: GeometryType
  /** The layer's extent in longitude and latitude, or null. */
  extent: Bbox | null
  /** Column names (not quoted): the number columns, and the others that hold text. */
  numeric: readonly string[]
  text: readonly string[]
  /** A path to put where another file goes: the first other file of the workspace, or a made-up name. */
  file: string
}

export interface SnippetDef {
  id: string
  title: string
  category: SnippetCategory
  /** One sentence: what the query gives. */
  description: string
  /** The layers it makes sense for ('Mixed' layers are offered all of them). */
  geometry: readonly GeometryType[] | 'any'
  /** What the layer must have: a number column, a text column, or another file in the workspace. */
  needs?: 'numeric' | 'text' | 'column'
  template: (ctx: SnippetContext) => string
}

/** A field of the template: the text a user may change, with its number. The editor's syntax cannot hold a brace inside one, so a name with a brace stays plain text (never a stop). */
const field = (n: number, text: string | number): string => (/[{}]/.test(String(text)) ? String(text) : `\${${n}:${text}}`)
/** A column name as SQL, inside a field's default. */
const col = (name: string): string => quoteIdent(name)
const lines = (...parts: string[]): string => parts.join('\n')
/** A text that goes in a SQL string: quotes doubled. */
const lit = (s: string): string => s.replace(/'/g, "''")

const firstNumeric = (c: SnippetContext): string => c.numeric[0] ?? 'value'
const firstText = (c: SnippetContext): string => c.text[0] ?? c.numeric[0] ?? 'name'

/** A box a little inside the extent (so the defaults cut something away), as `xmin, ymin, xmax, ymax`. */
function innerBox(extent: Bbox | null): [number, number, number, number] {
  const e = extent ?? [-180, -90, 180, 90]
  const dx = (e[2] - e[0]) / 4
  const dy = (e[3] - e[1]) / 4
  const r = (n: number): number => Math.round(n * 1e4) / 1e4
  return [r(e[0] + dx), r(e[1] + dy), r(e[2] - dx), r(e[3] - dy)]
}

const unitNote = (c: SnippetContext, small: string): string => (c.geographic ? `-- Distances are in degrees (${small}).` : "-- Distances are in the layer's units.")

export const SNIPPETS: readonly SnippetDef[] = [
  // --- Reshape: the geometry becomes another geometry, the columns stay.
  {
    id: 'buffer',
    title: 'Buffer',
    category: 'Reshape',
    description: 'Grows every feature by a distance.',
    geometry: 'any',
    template: (c) => lines(unitNote(c, '0.01 is about 1 km'), `SELECT * REPLACE (ST_Buffer(${c.geom}, ${field(1, c.geographic ? 0.01 : 1000)}) AS ${c.geom}) FROM ${c.table}`),
  },
  {
    id: 'centroids',
    title: 'Centroids',
    category: 'Reshape',
    description: 'One point at the center of each line or polygon.',
    geometry: ['LineString', 'Polygon'],
    template: (c) => `SELECT * REPLACE (ST_Centroid(${c.geom}) AS ${c.geom}) FROM ${c.table}`,
  },
  {
    id: 'bounding-boxes',
    title: 'Bounding boxes',
    category: 'Reshape',
    description: 'The smallest upright rectangle around each feature.',
    geometry: ['LineString', 'Polygon'],
    template: (c) => `SELECT * REPLACE (ST_Envelope(${c.geom}) AS ${c.geom}) FROM ${c.table}`,
  },
  {
    id: 'convex-hull',
    title: 'Convex hulls',
    category: 'Reshape',
    description: 'Each feature wrapped in its tightest convex shape.',
    geometry: ['LineString', 'Polygon'],
    template: (c) => `SELECT * REPLACE (ST_ConvexHull(${c.geom}) AS ${c.geom}) FROM ${c.table}`,
  },
  {
    id: 'simplify',
    title: 'Simplify',
    category: 'Reshape',
    description: 'Fewer vertices, for a lighter map.',
    geometry: ['LineString', 'Polygon'],
    template: (c) => lines(unitNote(c, '0.001 is about 100 m'), `SELECT * REPLACE (ST_Simplify(${c.geom}, ${field(1, c.geographic ? 0.001 : 100)}) AS ${c.geom}) FROM ${c.table}`),
  },
  {
    id: 'boundaries',
    title: 'Polygon outlines as lines',
    category: 'Reshape',
    description: 'The edge of each polygon, as a line.',
    geometry: ['Polygon'],
    template: (c) => `SELECT * REPLACE (ST_Boundary(${c.geom}) AS ${c.geom}) FROM ${c.table}`,
  },
  {
    id: 'dissolve-all',
    title: 'Dissolve everything',
    category: 'Reshape',
    description: 'Merges all the features into one.',
    geometry: 'any',
    template: (c) => `SELECT ST_Union_Agg(${c.geom}) AS ${c.geom}, count(*) AS features FROM ${c.table}`,
  },
  {
    id: 'dissolve-by',
    title: 'Dissolve by a column',
    category: 'Reshape',
    description: 'Merges the features that share a value, one feature per value.',
    geometry: 'any',
    needs: 'column',
    template: (c) => lines(`SELECT ${field(1, col(firstText(c)))}, ST_Union_Agg(${c.geom}) AS ${c.geom}, count(*) AS features`, `FROM ${c.table}`, `GROUP BY ${field(1, col(firstText(c)))}`),
  },
  {
    id: 'make-valid',
    title: 'Repair invalid shapes',
    category: 'Reshape',
    description: 'Fixes self-crossing and other broken shapes.',
    geometry: ['LineString', 'Polygon'],
    template: (c) => `SELECT * REPLACE (ST_MakeValid(${c.geom}) AS ${c.geom}) FROM ${c.table}`,
  },

  // --- Measure: the same features, with a new column.
  {
    id: 'area',
    title: 'Area in square kilometers',
    category: 'Measure',
    description: 'Adds the area of each polygon, largest first.',
    geometry: ['Polygon'],
    template: (c) => lines(`SELECT *, ST_Area_Spheroid(${c.geom4326}) / 1e6 AS area_km2`, `FROM ${c.table}`, 'ORDER BY area_km2 DESC'),
  },
  {
    id: 'length',
    title: 'Length in kilometers',
    category: 'Measure',
    description: 'Adds the length of each line, longest first.',
    geometry: ['LineString'],
    template: (c) => lines(`SELECT *, ST_Length_Spheroid(${c.geom4326}) / 1000 AS length_km`, `FROM ${c.table}`, 'ORDER BY length_km DESC'),
  },
  {
    id: 'density',
    title: 'Value per square kilometer',
    category: 'Measure',
    description: 'Divides a number column by each polygon’s area (a density).',
    geometry: ['Polygon'],
    needs: 'numeric',
    template: (c) =>
      lines(`SELECT *, ${field(1, col(firstNumeric(c)))} / (ST_Area_Spheroid(${c.geom4326}) / 1e6) AS per_km2`, `FROM ${c.table}`, 'ORDER BY per_km2 DESC'),
  },
  {
    id: 'vertices',
    title: 'Vertex count',
    category: 'Measure',
    description: 'Adds how many vertices each feature has: the heaviest shapes first.',
    geometry: ['LineString', 'Polygon'],
    template: (c) => lines(`SELECT *, ST_NPoints(${c.geom}) AS vertices`, `FROM ${c.table}`, 'ORDER BY vertices DESC'),
  },
  {
    id: 'distance-from-point',
    title: 'Distance from a point',
    category: 'Measure',
    description: 'Adds the distance in kilometers from a place to each feature, and keeps the nearest.',
    geometry: 'any',
    template: (c) => {
      const r = (n: number): number => Math.round(n * 1e4) / 1e4
      const lon = c.extent ? r((c.extent[0] + c.extent[2]) / 2) : 0
      const lat = c.extent ? r((c.extent[1] + c.extent[3]) / 2) : 0
      return lines(
        '-- The place is longitude, latitude.',
        `SELECT *, ST_Distance_Spheroid(ST_Point(ST_X(ST_Centroid(${c.geom4326})), ST_Y(ST_Centroid(${c.geom4326}))), ST_Point(${field(1, lon)}, ${field(2, lat)})) / 1000 AS km`,
        `FROM ${c.table}`,
        `ORDER BY km LIMIT ${field(3, 20)}`
      )
    },
  },
  {
    id: 'lon-lat',
    title: 'Add longitude and latitude',
    category: 'Measure',
    description: 'Adds the center of each feature as two columns.',
    geometry: 'any',
    template: (c) => lines(`SELECT *, ST_X(ST_Centroid(${c.geom4326})) AS lon, ST_Y(ST_Centroid(${c.geom4326})) AS lat`, `FROM ${c.table}`),
  },

  // --- Select: some of the features.
  {
    id: 'in-box',
    title: 'Inside a box',
    category: 'Select',
    description: 'The features that touch a rectangle (west, south, east, north).',
    geometry: 'any',
    template: (c) => {
      const [x0, y0, x1, y1] = innerBox(c.extent)
      return lines('-- The box is west, south, east, north, in longitude and latitude.', `SELECT * FROM ${c.table}`, `WHERE ST_Intersects(${c.geom4326}, ST_MakeEnvelope(${field(1, x0)}, ${field(2, y0)}, ${field(3, x1)}, ${field(4, y1)}))`)
    },
  },
  {
    id: 'top-n',
    title: 'Largest by a column',
    category: 'Select',
    description: 'The features with the biggest values of a number column.',
    geometry: 'any',
    needs: 'numeric',
    template: (c) => lines(`SELECT * FROM ${c.table}`, `ORDER BY ${field(1, col(firstNumeric(c)))} DESC`, `LIMIT ${field(2, 10)}`),
  },
  {
    id: 'text-contains',
    title: 'Text contains',
    category: 'Select',
    description: 'The features whose text column has a word, ignoring capitals.',
    geometry: 'any',
    needs: 'text',
    template: (c) => lines(`SELECT * FROM ${c.table}`, `WHERE ${field(1, col(firstText(c)))} ILIKE '%${field(2, lit('word'))}%'`),
  },
  {
    id: 'sample',
    title: 'Random sample',
    category: 'Select',
    description: 'A number of features picked at random.',
    geometry: 'any',
    template: (c) => `SELECT * FROM ${c.table} USING SAMPLE ${field(1, 1000)} ROWS`,
  },
  {
    id: 'invalid',
    title: 'Invalid shapes',
    category: 'Select',
    description: 'The features whose shape is broken.',
    geometry: ['LineString', 'Polygon'],
    template: (c) => lines(`SELECT * FROM ${c.table}`, `WHERE NOT ST_IsValid(${c.geom})`),
  },

  // --- Summarize: a table, not a map.
  {
    id: 'count-by',
    title: 'Count by value',
    category: 'Summarize',
    description: 'How many features have each value of a column.',
    geometry: 'any',
    needs: 'column',
    template: (c) => lines(`SELECT ${field(1, col(firstText(c)))}, count(*) AS n`, `FROM ${c.table}`, `GROUP BY ${field(1, col(firstText(c)))}`, 'ORDER BY n DESC'),
  },
  {
    id: 'statistics',
    title: 'Statistics of a number column',
    category: 'Summarize',
    description: 'Count, smallest, average, median, largest and sum.',
    geometry: 'any',
    needs: 'numeric',
    template: (c) => {
      const n = field(1, col(firstNumeric(c)))
      return lines(`SELECT count(${n}) AS n, min(${n}) AS smallest, avg(${n}) AS average, median(${n}) AS median, max(${n}) AS largest, sum(${n}) AS total`, `FROM ${c.table}`)
    },
  },

  // --- Combine: another file of the workspace (a path from the workspace root), read in place. Both files are taken to share a coordinate system.
  {
    id: 'join-by-location',
    title: 'Join attributes from another file',
    category: 'Combine',
    description: 'Adds the columns of the features of another file that touch each feature.',
    geometry: 'any',
    template: (c) =>
      lines(
        '-- The other file is a path from the workspace root. Both files must use the same coordinate system.',
        'SELECT a.*, b.* EXCLUDE (geom)',
        `FROM ${c.table} a JOIN ST_Read('${field(1, lit(c.file))}') b ON ST_Intersects(a.${c.geom}, b.geom)`
      ),
  },
  {
    id: 'count-in-polygons',
    title: 'Count features in each polygon of another file',
    category: 'Combine',
    description: 'Draws the polygons of another file, with how many of this layer’s features touch each.',
    geometry: 'any',
    template: (c) =>
      lines(
        '-- The other file is a path from the workspace root, and holds polygons. Both files must use the same coordinate system.',
        'SELECT b.*, count(a.' + c.geom + ') AS n',
        `FROM ST_Read('${field(1, lit(c.file))}') b LEFT JOIN ${c.table} a ON ST_Intersects(b.geom, a.${c.geom})`,
        'GROUP BY ALL'
      ),
  },
  {
    id: 'nearest',
    title: 'Nearest feature in another file',
    category: 'Combine',
    description: 'Adds the columns, and the distance, of the closest feature of another file.',
    geometry: 'any',
    template: (c) =>
      lines(
        '-- The other file is a path from the workspace root. The distance is in the coordinate system’s units (degrees for longitude and latitude).',
        'SELECT a.*, n.* EXCLUDE (geom)',
        `FROM ${c.table} a, LATERAL (`,
        `  SELECT b.*, ST_Distance(a.${c.geom}, b.geom) AS distance`,
        `  FROM ST_Read('${field(1, lit(c.file))}') b ORDER BY distance LIMIT 1`,
        ') n'
      ),
  },
  {
    id: 'clip',
    title: 'Clip to another file',
    category: 'Combine',
    description: 'Keeps only the parts of the features that lie inside the shapes of another file.',
    geometry: 'any',
    template: (c) =>
      lines(
        '-- The other file is a path from the workspace root. Both files must use the same coordinate system.',
        `SELECT a.* REPLACE (ST_Intersection(a.${c.geom}, b.geom) AS ${c.geom})`,
        `FROM ${c.table} a JOIN ST_Read('${field(1, lit(c.file))}') b ON ST_Intersects(a.${c.geom}, b.geom)`
      ),
  },
]

export const SNIPPET_CATEGORIES: readonly SnippetCategory[] = ['Reshape', 'Measure', 'Select', 'Summarize', 'Combine']

/** The snippets that fit the open layer: its geometry, and the columns they need. A mixed layer is offered every geometry. */
export function snippetsFor(ctx: Pick<SnippetContext, 'geometryType' | 'numeric' | 'text'>): SnippetDef[] {
  return SNIPPETS.filter((s) => {
    if (s.geometry !== 'any' && ctx.geometryType !== 'Mixed' && !s.geometry.includes(ctx.geometryType)) return false
    if (s.needs === 'numeric') return ctx.numeric.length > 0
    if (s.needs === 'text') return ctx.text.length > 0
    if (s.needs === 'column') return ctx.numeric.length + ctx.text.length > 0
    return true
  })
}

/** The editor's template for a snippet. */
export function snippetTemplate(def: SnippetDef, ctx: SnippetContext): string {
  return def.template(ctx)
}

/** The query as it reads before anything is edited: every field is its default. */
export function plainSql(template: string): string {
  return template.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}/g, '')
}

/** Whether a column type holds text. */
export const isTextType = (type: string): boolean => /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR)/i.test(type.trim())

/** Builds the context from a layer's columns (the geometry column is not one of them). */
export function snippetContextFor(input: {
  table: string
  geom: string
  srid: number | null
  geometryType: GeometryType
  extent: Bbox | null
  columns: ReadonlyArray<{ name: string; type: string }>
  files: readonly string[]
}): SnippetContext {
  const geographic = input.srid === null || input.srid === 4326
  const geom4326 = geographic ? input.geom : `ST_Transform(${input.geom}, 'EPSG:${Math.floor(input.srid ?? 4326)}', 'EPSG:4326', always_xy := true)`
  return {
    table: input.table,
    geom: input.geom,
    geom4326,
    geographic,
    geometryType: input.geometryType,
    extent: input.extent,
    numeric: input.columns.filter((c) => isNumericType(c.type)).map((c) => c.name),
    text: input.columns.filter((c) => isTextType(c.type)).map((c) => c.name),
    file: input.files[0] ?? 'other_file.geojson',
  }
}
