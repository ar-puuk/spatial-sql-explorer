// Spec 020: the time slider. It is a column filter (query/filters.ts, kind `between`) on a date or timestamp column,
// moved by a range slider and a play button, so the map, the table, the counts and export all read the same rows.
// This file is the pure part: which columns qualify, the engine query for a column's time span, the text a time
// takes in a filter and on the slider, and the steps of the animation.
import { columnClass, type ColumnFilter } from '../query/filters.js'
import { quoteIdent } from '../query/util.js'

export type TimeKind = 'date' | 'timestamp'

export interface TimeColumn {
  name: string
  type: string
  kind: TimeKind
}

/** The date and timestamp columns of a result, in table order. */
export function temporalColumns(columns: ReadonlyArray<{ name: string; type: string }>): TimeColumn[] {
  const out: TimeColumn[] = []
  for (const c of columns) {
    const cls = columnClass(c.type)
    if (cls === 'date' || cls === 'timestamp') out.push({ name: c.name, type: c.type, kind: cls })
  }
  return out
}

/** One row: the column's earliest and latest time (epoch milliseconds, UTC) and how many rows have none. */
export function timeExtentSql(relation: string, column: string): string {
  const t = `TRY_CAST(${quoteIdent(column)} AS TIMESTAMP)`
  return `SELECT epoch_ms(min(${t})) AS lo, epoch_ms(max(${t})) AS hi, count(*) FILTER (WHERE ${t} IS NULL) AS missing FROM ${relation}`
}

export interface TimeDomain {
  /** Epoch milliseconds, UTC. */
  min: number
  max: number
  /** Rows with no time (they are left out while the slider narrows). */
  missing: number
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** `YYYY-MM-DD` of a time (UTC, as the engine's TIMESTAMP is read). */
export function dateText(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** `YYYY-MM-DD HH:MM:SS`. */
export function timestampText(ms: number): string {
  const d = new Date(ms)
  return `${dateText(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** What the slider's labels show: the date, plus the clock when the whole span is short. */
export function timeLabel(ms: number, kind: TimeKind, domain: Pick<TimeDomain, 'min' | 'max'>): string {
  if (kind === 'date' || domain.max - domain.min >= 3 * 86_400_000) return dateText(ms)
  return timestampText(ms).slice(0, 16)
}

const DAY = 86_400_000

/** A time snapped the way the column stores it: whole days for a date column. */
export function snapTime(ms: number, kind: TimeKind): number {
  return kind === 'date' ? Math.round(ms / DAY) * DAY : Math.round(ms / 1000) * 1000
}

/**
 * The filter for a window `[from, to]` of a column, or null when the window is the whole span (no filter: rows with no
 * time stay). The bounds are the text `parseFilter` reads for the column's type.
 */
export function timeFilter(column: string, kind: TimeKind, from: number, to: number, domain: Pick<TimeDomain, 'min' | 'max'>): ColumnFilter | null {
  const lo = snapTime(Math.min(from, to), kind)
  const hi = snapTime(Math.max(from, to), kind)
  if (lo <= snapTime(domain.min, kind) && hi >= snapTime(domain.max, kind)) return null
  const text = kind === 'date' ? dateText : timestampText
  return { column, kind: 'between', value: text(lo), value2: text(hi) }
}

/** Slider positions run 0 to this; a position is a share of the span. */
export const TIME_STEPS = 1000

export function positionToTime(pos: number, domain: Pick<TimeDomain, 'min' | 'max'>): number {
  return domain.min + (Math.min(TIME_STEPS, Math.max(0, pos)) / TIME_STEPS) * (domain.max - domain.min)
}

export function timeToPosition(ms: number, domain: Pick<TimeDomain, 'min' | 'max'>): number {
  const span = domain.max - domain.min
  return span <= 0 ? 0 : Math.round(((Math.min(domain.max, Math.max(domain.min, ms)) - domain.min) / span) * TIME_STEPS)
}

/**
 * The next window of the animation: the same width, moved on by a fifth of it (at least a thousandth of the span, and for
 * a date column a whole day), and back to the start after the end. A window that is the whole span first shrinks to a tenth.
 */
export function nextWindow(from: number, to: number, domain: Pick<TimeDomain, 'min' | 'max'>, kind: TimeKind): { from: number; to: number } {
  const span = domain.max - domain.min
  let width = to - from
  if (width <= 0 || width >= span) width = span / 10
  const floor = kind === 'date' ? DAY : 1000
  width = Math.max(width, floor)
  const step = Math.max(width / 5, span / 1000, floor)
  // The last window ends exactly at the end of the span; the one after it starts over.
  const start = to >= domain.max ? domain.min : Math.min(from + step, domain.max - width)
  return { from: start, to: Math.min(domain.max, start + width) }
}
