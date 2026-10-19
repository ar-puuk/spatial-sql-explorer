// Spec 024: a tiny GTFS feed for tests (folder + zip). Run: node scripts/fixtures-024.mjs
import fs from 'node:fs'
import path from 'node:path'
import { zipSync } from 'fflate'

const dir = path.resolve('tests/vscode-ext/fixtures/gtfs-mini')
const files = {
  'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\nA,Mini Transit,https://example.org,America/Denver\n',
  'stops.txt': [
    'stop_id,stop_name,stop_lat,stop_lon',
    'S1,Central,39.7392,-104.9903',
    'S2,Union,39.7527,-105.0003',
    'S3,Park,39.7600,-104.9800',
    'S4,Lake,39.7300,-105.0200',
    'S5,Orphan,39.7000,-104.9000',
  ].join('\n') + '\n',
  'routes.txt': [
    'route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color',
    'R1,A,1,Central–Union,3,E4572E,FFFFFF',
    'R2,A,2,Park–Lake,3,,',
    'R3,A,L,Light rail,0,17BEBB,000000',
  ].join('\n') + '\n',
  'trips.txt': [
    'route_id,service_id,trip_id,shape_id',
    'R1,WK,T1,SH1',
    'R1,WK,T2,SH1',
    'R2,WK,T3,',
    'R3,WK,T4,',
  ].join('\n') + '\n',
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'T1,08:00:00,08:00:00,S1,1', 'T1,08:10:00,08:10:00,S2,2',
    'T2,09:00:00,09:00:00,S1,1', 'T2,09:10:00,09:10:00,S2,2',
    'T3,08:00:00,08:00:00,S3,1', 'T3,08:20:00,08:20:00,S4,2',
    'T4,08:00:00,08:00:00,S2,1', 'T4,08:05:00,08:05:00,S3,2',
  ].join('\n') + '\n',
  'shapes.txt': [
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence',
    'SH1,39.7392,-104.9903,1', 'SH1,39.7450,-104.9950,2', 'SH1,39.7527,-105.0003,3',
  ].join('\n') + '\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20261231\n',
}
fs.mkdirSync(dir, { recursive: true })
for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t)
const enc = new TextEncoder()
fs.writeFileSync(path.join(dir, '..', 'gtfs-mini.zip'), zipSync(Object.fromEntries(Object.entries(files).map(([n, t]) => [n, enc.encode(t)]))))
// The same feed one folder down, a shape agencies ship.
fs.writeFileSync(path.join(dir, '..', 'gtfs-mini-nested.zip'), zipSync(Object.fromEntries(Object.entries(files).map(([n, t]) => ['feed/' + n, enc.encode(t)]))))
console.log('written', dir)
