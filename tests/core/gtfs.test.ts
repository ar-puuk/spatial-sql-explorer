// Spec 024 (GTFS): a feed is recognized by what is inside, never by a name.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { confirmGtfsHeaders, csvHeader, findGtfsRoot, findPartialGtfs, firstLineOf, inspectZip, missingGtfsFiles, readStopTimes, splitFeed, tripsLackShapes, zipGtfsFolder, type FolderEntry } from '@spatial-explorer/core'
import { gtfsLayerNames, routesReaderSql, stopsViewSql } from '../../packages/core/src/gtfs/sql'
import { feedNotice } from '../../packages/core/src/gtfs/open'

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

describe('splitFeed', () => {
  const big = 'trip_id,stop_id,stop_sequence\n' + Array.from({ length: 5000 }, (_, i) => `T${i},S1,${i}`).join('\n') + '\n'
  const bytes = zip({ ...feed('feed/'), 'feed/stop_times.txt': big, 'feed/readme.md': 'x', 'other/stops.txt': 'x', 'feed/sub/trips.txt': 'x' })

  it('keeps the small tables, and gives GDAL a flat copy whose stop_times is its header', async () => {
    const parts = await splitFeed(bytes, 'feed/')
    expect(Object.keys(parts.tables).sort()).toEqual(['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt'])
    expect(parts.stopTimesEntry).toBe('feed/stop_times.txt')
    const lite = unzipSync(parts.lite)
    expect(Object.keys(lite).sort()).toEqual(['agency.txt', 'routes.txt', 'stop_times.txt', 'stops.txt', 'trips.txt'])
    expect(new TextDecoder().decode(lite['stop_times.txt'])).toBe('trip_id,stop_id,stop_sequence\n')
    expect(new TextDecoder().decode(lite['routes.txt'])).toBe(ROUTES)
    expect(readStopTimes(bytes, parts.stopTimesEntry).length).toBe(big.length)
  })

  it('reads one line from a compressed entry without the rest', async () => {
    expect(await firstLineOf(zipSync({ 'a.txt': text(big) }, { level: 6 }), 'a.txt')).toBe('trip_id,stop_id,stop_sequence')
    expect(await firstLineOf(zipSync({ 'a.txt': text('h1,h2\r\nx\r\n') }, { level: 0 }), 'a.txt')).toBe('h1,h2')
    expect(await firstLineOf(zipSync({ 'a.txt': text('only') }), 'a.txt')).toBe('only')
  })

  it('names a feed without stop_times', async () => {
    await expect(splitFeed(zip({ 'stops.txt': STOPS }), '')).rejects.toThrow(/stop_times/)
  })
})

describe('tripsLackShapes', () => {
  const t = (s: string): Uint8Array => new TextEncoder().encode(s)
  it('is false when every trip names a shape', () => {
    expect(tripsLackShapes(t('route_id,trip_id,shape_id\nR1,T1,SH1\nR1,T2,SH1\n'))).toBe(false)
  })
  it('is true when one trip names none, or the column is missing', () => {
    expect(tripsLackShapes(t('route_id,trip_id,shape_id\nR1,T1,SH1\nR2,T2,\n'))).toBe(true)
    expect(tripsLackShapes(t('route_id,trip_id\nR1,T1\n'))).toBe(true)
  })
  it('reads quoted cells with commas, a byte-order mark and CRLF', () => {
    expect(tripsLackShapes(t('﻿route_id,trip_headsign,shape_id\r\nR1,"Main, North",SH1\r\n'))).toBe(false)
    expect(tripsLackShapes(t('route_id,trip_headsign,shape_id\r\nR1,"A, B",\r\n'))).toBe(true)
  })
})

describe('the feed in SQL', () => {
  const inv = { tables: ['routes', 'trips', 'stop_times', 'stops', 'calendar'], geometry: ['shapes_geom'] as ('shapes_geom' | 'trips')[] }
  it('orders layer names: the network, routes, stops, then the other tables', () => {
    expect(gtfsLayerNames(inv.tables)).toEqual(['network', 'routes', 'stops', 'calendar', 'stop_times', 'trips'])
  })
  it('routes use the shapes, and add trip lines only when GDAL was asked for them', () => {
    expect(routesReaderSql(inv)).toContain('se-gtfs-shapes_geom.fgb')
    expect(routesReaderSql(inv)).not.toContain('se-gtfs-trips.fgb')
    expect(routesReaderSql({ ...inv, geometry: ['shapes_geom', 'trips'] })).toContain('se-gtfs-trips.fgb')
    expect(routesReaderSql({ tables: inv.tables, geometry: ['trips'] })).not.toContain('se-gtfs-shapes_geom.fgb')
  })
})

describe('zipGtfsFolder (a feed that is a folder of text files)', () => {
  const entries = (files: Record<string, string>): FolderEntry[] =>
    Object.entries(files).map(([path, content]) => ({ path, head: async () => text(content).slice(0, 64), read: async () => text(content) }))

  it('makes a zip of a picked folder, named after it, and the zip is found as a feed', async () => {
    const got = await zipGtfsFolder(entries({ ...feed('google_transit/'), 'google_transit/notes.md': 'x' }))
    expect(got?.name).toBe('google_transit.zip')
    expect(Object.keys(unzipSync(got?.zip as Uint8Array)).sort()).toEqual(['agency.txt', 'routes.txt', 'stop_times.txt', 'stops.txt', 'trips.txt'])
    expect(inspectZip(got?.zip as Uint8Array)).toEqual({ kind: 'gtfs', root: '', alternatives: [] })
  })

  it('makes one of loose files (a multiple pick or drop)', async () => {
    const got = await zipGtfsFolder(entries(feed()))
    expect(got?.name).toBe('gtfs.zip')
    expect(got && Object.keys(unzipSync(got.zip)).length).toBe(5)
  })

  it('is not fooled: wrong columns, other data, or a folder two levels down', async () => {
    expect(await zipGtfsFolder(entries({ ...feed(), 'stops.txt': 'a,b\n1,2\n' }))).toBeNull()
    const noTimes = feed()
    delete noTimes['stop_times.txt']
    // Missing files: still zipped, so that opening it names them (see the partial feeds below).
    expect(inspectZip((await zipGtfsFolder(entries(noTimes)))?.zip as Uint8Array)).toEqual({ kind: 'empty', gtfsMissing: ['stop_times.txt'] })
    expect(await zipGtfsFolder(entries({ 'a.geojson': '{}', 'b.csv': 'x' }))).toBeNull()
    expect(await zipGtfsFolder(entries(feed('a/b/')))).toBeNull()
  })

  it('reads nothing but the headers of files that are not a feed', async () => {
    let reads = 0
    const spy: FolderEntry[] = [{ path: 'stops.txt', head: async () => text('x\n'), read: async () => (reads++, text('x')) }]
    expect(await zipGtfsFolder(spy)).toBeNull()
    expect(reads).toBe(0)
  })
})

describe('the feed in SQL without GDAL', () => {
  const inv = { tables: ['routes', 'trips', 'stop_times', 'stops', 'shapes'], geometry: [] as ('shapes_geom' | 'trips')[], mode: 'sql' as const }
  it('reads no FlatGeobuf at all: lines come from shapes.txt and from the stops of one trip each', () => {
    const sql = routesReaderSql(inv)
    expect(sql).not.toContain('.fgb')
    expect(sql).toContain('ST_MakeLine')
    expect(sql).toContain('shape_pt_sequence')
    expect(sql).toContain('arg_max(trip_id, n)')
  })
  it('without a shapes table, every route is drawn through its trip\'s stops', () => {
    const sql = routesReaderSql({ ...inv, tables: ['routes', 'trips', 'stop_times', 'stops'] })
    expect(sql).not.toContain('shape_pt_sequence')
  })
  it('a trips.txt with no shape_id column is read without it (both modes)', () => {
    expect(routesReaderSql({ ...inv, tripsHaveShapeId: false })).toContain("'' AS shape_id")
    expect(routesReaderSql({ tables: inv.tables, geometry: ['trips'], tripsHaveShapeId: false })).not.toContain("coalesce(shape_id, '') = ''\" GROUP")
  })
  it('stops are points made from the text coordinates, with none for a blank or impossible one', () => {
    const sql = stopsViewSql('s', inv)
    expect(sql).toContain('TRY_CAST(t.stop_lat AS DOUBLE)')
    expect(sql).toContain('BETWEEN -90 AND 90')
    expect(sql).not.toContain('ST_Read')
  })
})

describe('the notice about how a feed was drawn', () => {
  const base = { mode: 'gdal' as const, readerProblem: null, tripLines: false, routes: 86, routesDrawn: 86, stops: 10, stopsDrawn: 10 }
  it('says nothing when all is as expected', () => {
    expect(feedNotice(base)).toBeNull()
  })
  it('counts what is left out, in the right number', () => {
    expect(feedNotice({ ...base, routesDrawn: 85 })).toBe('1 route has no trips and is not drawn.')
    expect(feedNotice({ ...base, routesDrawn: 80, stopsDrawn: 7 })).toBe('6 routes have no trips and are not drawn. 3 stops have no usable coordinates and are not on the map.')
  })
  it('says when lines come from trips, and why GDAL was not used', () => {
    expect(feedNotice({ ...base, tripLines: true })).toBe('Routes whose trips have no shape are drawn through the stops of one trip.')
    expect(feedNotice({ ...base, mode: 'sql', readerProblem: 'it is offline' })).toBe("The GDAL reader could not be used (it is offline), so lines are built from the feed's own tables.")
  })
})

describe('a feed with some of its files missing', () => {
  it('findPartialGtfs names what is missing, from two files up', () => {
    expect(findPartialGtfs(['stops.txt', 'routes.txt'])).toEqual({ root: '', missing: ['trips.txt', 'stop_times.txt'] })
    expect(findPartialGtfs(['feed/stops.txt', 'feed/routes.txt', 'feed/trips.txt'])).toEqual({ root: 'feed/', missing: ['stop_times.txt'] })
  })
  it('is not a partial feed: one file, a whole feed, other data, or too deep', () => {
    expect(findPartialGtfs(['stops.txt'])).toBeNull()
    expect(findPartialGtfs(Object.keys(feed()))).toBeNull()
    expect(findPartialGtfs(['a.geojson', 'b.csv'])).toBeNull()
    expect(findPartialGtfs(['a/b/stops.txt', 'a/b/routes.txt'])).toBeNull()
  })
  it('inspectZip says which files, and still is not a feed', () => {
    const files = feed()
    delete files['stop_times.txt']
    expect(inspectZip(zip(files))).toEqual({ kind: 'empty', gtfsMissing: ['stop_times.txt'] })
    expect(inspectZip(zip({ 'notes.txt': 'x' }))).toEqual({ kind: 'empty' })
  })
  it('a folder missing some is still zipped, so opening it can say what is missing; wrong columns are not', async () => {
    const mk = (files: Record<string, string>): FolderEntry[] => Object.entries(files).map(([path, content]) => ({ path, head: async () => text(content).slice(0, 64), read: async () => text(content) }))
    const files = feed('f/')
    delete files['f/trips.txt']
    const got = await zipGtfsFolder(mk(files))
    expect(got?.name).toBe('f.zip')
    expect(inspectZip(got?.zip as Uint8Array)).toEqual({ kind: 'empty', gtfsMissing: ['trips.txt'] })
    expect(await zipGtfsFolder(mk({ 'stops.txt': 'a,b\n', 'routes.txt': ROUTES }))).toBeNull()
  })
})
