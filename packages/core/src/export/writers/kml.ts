// KML 2.2 (spec 008 FR-020): one Placemark per row, WGS84 longitude/latitude.
// Attributes go in ExtendedData; the Placemark's name is the first text
// column's value, when there is one. Multi-part geometries are MultiGeometry.
import type { Geometry, Position } from 'geojson'
import { ChunkBuffer, textOf, xmlEscape, type ExportRow, type RowWriter, type WriterColumn } from './common.js'

const coords = (cs: Position[]): string => cs.map((p) => `${p[0]},${p[1]}`).join(' ')
const ring = (tag: string, cs: Position[]): string => `<${tag}><LinearRing><coordinates>${coords(cs)}</coordinates></LinearRing></${tag}>`

function polygon(rings: Position[][]): string {
  if (!rings.length) return '<Polygon/>'
  return `<Polygon>${ring('outerBoundaryIs', rings[0])}${rings.slice(1).map((r) => ring('innerBoundaryIs', r)).join('')}</Polygon>`
}

export function kmlGeometry(g: Geometry): string {
  switch (g.type) {
    case 'Point':
      return g.coordinates.length ? `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]}</coordinates></Point>` : ''
    case 'LineString':
      return `<LineString><coordinates>${coords(g.coordinates)}</coordinates></LineString>`
    case 'Polygon':
      return polygon(g.coordinates)
    case 'MultiPoint':
      return `<MultiGeometry>${g.coordinates.map((p) => kmlGeometry({ type: 'Point', coordinates: p })).join('')}</MultiGeometry>`
    case 'MultiLineString':
      return `<MultiGeometry>${g.coordinates.map((l) => kmlGeometry({ type: 'LineString', coordinates: l })).join('')}</MultiGeometry>`
    case 'MultiPolygon':
      return `<MultiGeometry>${g.coordinates.map(polygon).join('')}</MultiGeometry>`
    case 'GeometryCollection':
      return `<MultiGeometry>${g.geometries.map(kmlGeometry).join('')}</MultiGeometry>`
  }
}

export function kmlWriter(columns: readonly WriterColumn[], documentName: string): RowWriter {
  const out = new ChunkBuffer()
  const nameColumn = columns.findIndex((c) => c.kind === 'text')
  out.push(`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEscape(documentName)}</name>\n`)
  let pending = ''
  return {
    add({ values, geometry }: ExportRow) {
      const name = nameColumn >= 0 && values[nameColumn] !== null && values[nameColumn] !== undefined ? `<name>${xmlEscape(textOf(values[nameColumn]))}</name>` : ''
      const data = columns
        .map((c, i) => (values[i] === null || values[i] === undefined ? '' : `<Data name="${xmlEscape(c.name)}"><value>${xmlEscape(textOf(values[i]))}</value></Data>`))
        .join('')
      pending += `<Placemark>${name}${data ? `<ExtendedData>${data}</ExtendedData>` : ''}${geometry ? kmlGeometry(geometry) : ''}</Placemark>\n`
      if (pending.length > 1 << 20) {
        out.push(pending)
        pending = ''
      }
    },
    get size() {
      return out.size + pending.length
    },
    finish() {
      out.push(pending)
      out.push('</Document></kml>\n')
      return out.bytes()
    },
  }
}
