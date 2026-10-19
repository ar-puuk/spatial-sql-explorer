// Spec 024 (GTFS): a feed is recognized by what is inside, never by a name.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { confirmGtfsHeaders, csvHeader, findGtfsRoot, inspectZip, missingGtfsFiles } from '@spatial-explorer/core'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)
const zip = (files: Record<string, string | Uint8Array>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? text(v) : v])))
const STOPS = 'stop_id,stop_name,stop_lat,stop_lon\nS1,Central,39.7,-104.9\n'
const ROUTES = 'route_id,route_short_name,route_type,route_color\nR1,1,3,E4572E\n'
const feed = (dir = ''): Record<string, string> => ({
  [`${dir}agency.txt`]: 'agency_name\nX\n',
  [`${dir}stops.txt`]: STOPS,
  [`${dir}routes.txt`]: ROUTES,
  [`${dir}trips.txt`]: 'route_id,service_id,trip_id\nR1,WK,T1\n',
  [`${dir}stop_times.txt`]: 'trip_id,stop_id,stop_sequence\nT1,S1,1\n',
})

describe('findGtfsRoot (names only)', () => {
  it('the top level', () => {
    expect(findGtfsRoot(Object.keys(feed()))).toEqual({ root: '', alternatives: [] })
  })
  it('one wrapper folder', () => {
    expect(findGtfsRoot(Object.keys(feed('google_transit/')))).toEqual({ root: 'google_transit/', alternatives: [] })
  })
  it('not two folders down', () => {
    expect(findGtfsRoot(Object.keys(feed('a/b/')))).toBeNull()
  })
  it('names are matched without regard to case, and backslashes from some tools are tolerated', () => {
    expect(findGtfsRoot(['Stops.TXT', 'ROUTES.txt', 'Trips.txt', 'stop_times.TXT'])?.root).toBe('')
    expect(findGtfsRoot(['feed\\stops.txt', 'feed\\routes.txt', 'feed\\trips.txt', 'feed\\stop_times.txt'])?.root).toBe('feed/')
  })
  it('the top level wins over a wrapper, and the other feed is an alternative', () => {
    const names = [...Object.keys(feed('old/')), ...Object.keys(feed())]
    expect(findGtfsRoot(names)).toEqual({ root: '', alternatives: ['old/'] })
  })
  it('a missing required file is not a feed', () => {
    for (const gone of ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']) expect(findGtfsRoot(Object.keys(feed()).filter((n) => n !== gone))).toBeNull()
  })
  it('ignores macOS leftovers', () => {
    expect(findGtfsRoot(['__MACOSX/stops.txt', '__MACOSX/routes.txt', '__MACOSX/trips.txt', '__MACOSX/stop_times.txt'])).toBeNull()
  })
  it('says what is missing', () => {
    expect(missingGtfsFiles(['stops.txt', 'routes.txt'])).toEqual(['trips.txt', 'stop_times.txt'])
    expect(missingGtfsFiles(['feed/stops.txt', 'feed/routes.txt', 'feed/trips.txt'], 'feed/')).toEqual(['stop_times.txt'])
  })
})

describe('csvHeader and confirmGtfsHeaders', () => {
  it('reads a header with a byte-order mark, CRLF, quotes and odd case', () => {
    expect(csvHeader('\uFEFF"Stop_ID", stop_name\r\n1,A')).toEqual(['stop_id', 'stop_name'])
    expect(csvHeader(text('route_id,"a,b",c\n1'))).toEqual(['route_id', 'a,b', 'c'])
    expect(csvHeader('')).toEqual([''])
  })
  it('wants stop_id in stops.txt and route_id in routes.txt', () => {
    expect(confirmGtfsHeaders({ 'stops.txt': STOPS, 'routes.txt': ROUTES })).toBe(true)
    expect(confirmGtfsHeaders({ 'stops.txt': 'id,name\n', 'routes.txt': ROUTES })).toBe(false)
    expect(confirmGtfsHeaders({ 'stops.txt': STOPS, 'routes.txt': 'id\n' })).toBe(false)
    expect(confirmGtfsHeaders({ 'stops.txt': STOPS })).toBe(false)
  })
})

describe('inspectZip finds a feed', () => {
  it('whatever the zip is called', () => {
    expect(inspectZip(zip(feed()))).toEqual({ kind: 'gtfs', root: '', alternatives: [] })
  })
  it('in a wrapper folder', () => {
    expect(inspectZip(zip(feed('feed/')))).toEqual({ kind: 'gtfs', root: 'feed/', alternatives: [] })
  })
  it('beside another zip, like a real agency download: the inner zip is ignored', () => {
    const c = inspectZip(zip({ ...feed(), 'GTFSOct_1_Google.zip': zip(feed()) }))
    expect(c).toEqual({ kind: 'gtfs', root: '', alternatives: [] })
  })
  it('with a byte-order mark and CRLF on the first lines', () => {
    const c = inspectZip(zip({ ...feed(), 'stops.txt': '\uFEFFstop_id,stop_name\r\nS1,A\r\n', 'routes.txt': '\uFEFFroute_id,route_type\r\nR1,3\r\n' }))
    expect(c.kind).toBe('gtfs')
  })
  it('skips a wrapper that only looks like a feed and takes the one that is', () => {
    const fake = { 'a/stops.txt': 'x,y\n', 'a/routes.txt': 'x,y\n', 'a/trips.txt': 'x\n', 'a/stop_times.txt': 'x\n' }
    expect(inspectZip(zip({ ...fake, ...feed('b/') }))).toEqual({ kind: 'gtfs', root: 'b/', alternatives: [] })
  })
})

describe('inspectZip is not fooled', () => {
  it('four text files with the right names but other columns', () => {
    const names = { 'stops.txt': 'a,b\n1,2\n', 'routes.txt': 'a,b\n', 'trips.txt': 'a\n', 'stop_times.txt': 'a\n' }
    expect(inspectZip(zip(names)).kind).toBe('empty')
  })
  it('a zip of shapefiles named like a feed stays a dataset', () => {
    const c = inspectZip(zip({ 'stops.shp': 'SHP', 'stops.dbf': 'DBF', 'routes.shp': 'SHP', 'routes.dbf': 'DBF' }))
    expect(c.kind).toBe('datasets')
  })
  it('a zip of CSV tables with stops and routes, but no trips or stop times', () => {
    const c = inspectZip(zip({ 'stops.csv': STOPS, 'routes.csv': ROUTES }))
    expect(c.kind).toBe('datasets')
  })
  it('a feed missing stop_times is not a feed (the message names what is missing)', () => {
    const files = feed()
    delete files['stop_times.txt']
    expect(inspectZip(zip(files)).kind).toBe('empty')
    expect(missingGtfsFiles(Object.keys(files))).toEqual(['stop_times.txt'])
  })
  it('a geodatabase still wins', () => {
    expect(inspectZip(zip({ ...feed(), 'net.gdb/a00000001.gdbtable': 'x' })).kind).toBe('gdb')
  })
})

// A real agency download, when the machine has one: SE_GTFS_SAMPLE=D:\GTFS.zip (the feed plus a second zip inside).
const sample = process.env.SE_GTFS_SAMPLE
describe.skipIf(!sample)('a real feed', () => {
  it('is recognized', () => {
    const bytes = new Uint8Array(fs.readFileSync(sample as string))
    expect(inspectZip(bytes)).toEqual({ kind: 'gtfs', root: '', alternatives: [] })
  })
})

describe('the committed fixtures', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vscode-ext', 'fixtures')
  it('gtfs-mini.zip and gtfs-mini-nested.zip', () => {
    expect(inspectZip(new Uint8Array(fs.readFileSync(path.join(dir, 'gtfs-mini.zip'))))).toEqual({ kind: 'gtfs', root: '', alternatives: [] })
    expect(inspectZip(new Uint8Array(fs.readFileSync(path.join(dir, 'gtfs-mini-nested.zip'))))).toEqual({ kind: 'gtfs', root: 'feed/', alternatives: [] })
  })
})
