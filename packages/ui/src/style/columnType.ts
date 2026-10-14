// A column's type as a short symbol for column pickers, as Power Query and
// QGIS show field types: 123 whole numbers, 1.2 decimals, Abc text, and small
// icons for dates, times, true/false, geometry and nested values. The full
// type stays in the option's tooltip.

export type TypeIcon = 'date' | 'time' | 'bool' | 'geo' | 'nested'

export interface TypeSymbol {
  /** A text symbol (123, 1.2, Abc), or none when an icon stands for the type. */
  text?: string
  icon?: TypeIcon
  /** Spelled out, for tooltips. */
  name: string
}

export function columnTypeSymbol(type: string): TypeSymbol {
  const t = type.trim().toUpperCase()
  if (/(\[\]|^STRUCT|^MAP|^LIST|^UNION|^JSON)/.test(t)) return { icon: 'nested', name: 'Nested value' }
  if (/^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?\d*|INT\d+|LONG|SHORT)\b/.test(t)) return { text: '123', name: 'Whole number' }
  if (/^(DOUBLE|FLOAT\d*|REAL|DECIMAL|NUMERIC)\b/.test(t)) return { text: '1.2', name: 'Decimal number' }
  if (/^BOOL(EAN)?\b/.test(t)) return { icon: 'bool', name: 'True or false' }
  if (/^DATE\b/.test(t)) return { icon: 'date', name: 'Date' }
  if (/^(TIME|TIMESTAMP|INTERVAL)/.test(t)) return { icon: 'time', name: 'Time' }
  if (/^(GEOMETRY|POINT|LINESTRING|POLYGON|MULTI|WKB|BLOB)/.test(t)) return { icon: 'geo', name: 'Geometry' }
  return { text: 'Abc', name: 'Text' }
}
