// Spec 020: the pure part of the time slider (view/timeSlider.ts).
import { describe, expect, it } from 'vitest'
import { TIME_STEPS, dateText, nextWindow, parseFilter, positionToTime, snapTime, temporalColumns, timeExtentSql, timeFilter, timeLabel, timeToPosition, timestampText } from '@spatial-explorer/core'

const DAY = 86_400_000
const domain = { min: Date.UTC(2020, 0, 1), max: Date.UTC(2020, 11, 31) }

describe('temporalColumns', () => {
  it('lists date and timestamp columns only', () => {
    const cols = [
      { name: 'id', type: 'BIGINT' },
      { name: 'day', type: 'DATE' },
      { name: 'at', type: 'TIMESTAMP' },
      { name: 'at_tz', type: 'TIMESTAMP WITH TIME ZONE' },
      { name: 'clock', type: 'TIME' },
      { name: 'when_text', type: 'VARCHAR' },
      { name: 'geom', type: 'GEOMETRY' },
    ]
    expect(temporalColumns(cols).map((c) => [c.name, c.kind])).toEqual([['day', 'date'], ['at', 'timestamp'], ['at_tz', 'timestamp']])
  })
})

describe('timeExtentSql', () => {
  it('reads the span as epoch milliseconds and counts rows with no time', () => {
    const sql = timeExtentSql('layer', 'My "day"')
    expect(sql).toContain('epoch_ms(min(TRY_CAST("My ""day""" AS TIMESTAMP)))')
    expect(sql).toContain('FILTER (WHERE')
  })
})

describe('time text', () => {
  it('writes dates and timestamps the filters read', () => {
    expect(dateText(Date.UTC(2021, 2, 5))).toBe('2021-03-05')
    expect(timestampText(Date.UTC(2021, 2, 5, 7, 8, 9))).toBe('2021-03-05 07:08:09')
  })
  it('shows the clock on the labels only for a short span', () => {
    const t = Date.UTC(2021, 2, 5, 7, 8)
    expect(timeLabel(t, 'timestamp', { min: t, max: t + DAY })).toBe('2021-03-05 07:08')
    expect(timeLabel(t, 'timestamp', { min: t, max: t + 10 * DAY })).toBe('2021-03-05')
    expect(timeLabel(t, 'date', { min: t, max: t + DAY })).toBe('2021-03-05')
  })
  it('snaps a date column to whole days', () => {
    expect(snapTime(Date.UTC(2021, 2, 5, 15), 'date')).toBe(Date.UTC(2021, 2, 6))
  })
})

describe('timeFilter', () => {
  it('is no filter for the whole span, so undated rows stay', () => {
    expect(timeFilter('d', 'date', domain.min, domain.max, domain)).toBeNull()
  })
  it('is a between filter the column filter parser accepts, either order', () => {
    const f = timeFilter('d', 'date', Date.UTC(2020, 5, 30), Date.UTC(2020, 2, 1), domain)!
    expect(f).toEqual({ column: 'd', kind: 'between', value: '2020-03-01', value2: '2020-06-30' })
    expect(parseFilter(f, 'DATE').valid).toBe(true)
    const g = timeFilter('t', 'timestamp', Date.UTC(2020, 2, 1, 5), Date.UTC(2020, 2, 2), domain)!
    expect(g.value).toBe('2020-03-01 05:00:00')
    expect(parseFilter(g, 'TIMESTAMP').valid).toBe(true)
  })
})

describe('positions', () => {
  it('map the span to 0..1000 and back', () => {
    expect(positionToTime(0, domain)).toBe(domain.min)
    expect(positionToTime(TIME_STEPS, domain)).toBe(domain.max)
    expect(timeToPosition(domain.min + (domain.max - domain.min) / 2, domain)).toBe(500)
    expect(timeToPosition(domain.max + DAY, domain)).toBe(TIME_STEPS)
    expect(timeToPosition(5, { min: 3, max: 3 })).toBe(0)
  })
})

describe('nextWindow', () => {
  it('starts at the beginning, a tenth of the span wide, when the window is all of it', () => {
    const w = nextWindow(domain.min, domain.max, domain, 'date')
    expect(w.to - w.from).toBeCloseTo((domain.max - domain.min) / 10, -3)
    expect(w.from).toBe(domain.min)
  })
  it('keeps its width, moves on, ends exactly at the end, then starts over', () => {
    const width = 30 * DAY
    let w = { from: domain.min, to: domain.min + width }
    const seen: number[] = []
    for (let i = 0; i < 200 && w.to < domain.max; i++) {
      w = nextWindow(w.from, w.to, domain, 'date')
      seen.push(w.to - w.from)
    }
    expect(w.to).toBe(domain.max)
    expect(seen.every((x) => Math.abs(x - width) < 1)).toBe(true)
    expect(nextWindow(w.from, w.to, domain, 'date').from).toBe(domain.min)
  })
  it('never moves less than a day on a date column', () => {
    const tiny = { min: 0, max: 100 * DAY }
    const w = nextWindow(0, 1000, tiny, 'date')
    expect(w.from).toBeGreaterThanOrEqual(DAY / 5)
    expect(w.to - w.from).toBeGreaterThanOrEqual(DAY)
  })
})
