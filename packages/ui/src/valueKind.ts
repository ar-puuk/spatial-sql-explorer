// What a cell's value is, for coloring it in the table and the feature card (spec 015). The column's declared type
// is used when it is known (it tells a decimal 3.0 from an integer 3, a date string from text); otherwise the value
// itself decides. Color is never the only cue: numbers are right-aligned in the data font, NULL is spelled out in
// italics, booleans read true or false.
import { columnTypeSymbol } from './style/columnType.js'

export type ValueKind = 'null' | 'text' | 'integer' | 'decimal' | 'boolean' | 'datetime' | 'nested' | 'geometry'

export function valueKind(value: unknown, columnType?: string): ValueKind {
  if (value === null || value === undefined) return 'null'
  if (columnType) {
    const s = columnTypeSymbol(columnType)
    if (s.icon === 'nested') return 'nested'
    if (s.icon === 'geo') return 'geometry'
    if (s.icon === 'bool') return 'boolean'
    if (s.icon === 'date' || s.icon === 'time') return 'datetime'
    if (s.text === '123') return 'integer'
    if (s.text === '1.2') return 'decimal'
    if (s.text === 'Abc' && typeof value === 'string') return 'text'
  }
  if (typeof value === 'bigint') return 'integer'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal'
  if (typeof value === 'boolean') return 'boolean'
  if (value instanceof Date) return 'datetime'
  if (typeof value === 'object') return 'nested'
  return 'text'
}

/** Numbers line up on the right. */
export const isNumericKind = (kind: ValueKind): boolean => kind === 'integer' || kind === 'decimal'
