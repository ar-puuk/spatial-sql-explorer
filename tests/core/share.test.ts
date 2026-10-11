// T078 (spec 008 US7, FR-031): the web share link.
import { describe, expect, it } from 'vitest'
import { deflateSync, strToU8 } from 'fflate'
import { DEFAULT_LAYER_STYLE, decodeShareState, encodeShareState, sanitizeStyle, type ShareState } from '@spatial-explorer/core'

const typical: ShareState = {
  v: 1,
  source: { kind: 'file', name: 'parcels.parquet', size: 1_234_567 },
  layer: 'parcels',
  query: "SELECT * FROM layer WHERE zone = 'R1' AND value > 250000 ORDER BY value DESC",
  style: sanitizeStyle({
    ...DEFAULT_LAYER_STYLE,
    renderer: { kind: 'graduated', column: 'value', method: 'quantile', classCount: 7, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} },
    extrusion: { enabled: true, source: { kind: 'column', column: 'height_m' }, scale: 1.5 },
  }),
  basemap: 'esri-imagery',
  projection: 'globe',
  view: { center: [-111.89, 40.76], zoom: 12.5, pitch: 45, bearing: -17 },
}

/** A hand-made link with any JSON in it. */
const linkOf = (json: unknown): string => {
  const b = deflateSync(strToU8(JSON.stringify(json)))
  return 'v1=' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('share link', () => {
  it('round-trips a typical state, URL-safe, under 2 KB', () => {
    const link = encodeShareState(typical)
    expect(link).toMatch(/^v1=[A-Za-z0-9_-]+$/)
    expect(link.length).toBeLessThan(2048)
    expect(decodeShareState('#' + link)).toEqual({ state: typical, dropped: [] })
    expect(decodeShareState(encodeShareState({ ...typical, source: { kind: 'sample' }, layer: undefined, style: undefined }))?.state.source).toEqual({ kind: 'sample' })
  })

  it('drops and names invalid fields, keeping the rest', () => {
    const r = decodeShareState(
      linkOf({ ...typical, basemap: 'no-such-basemap', projection: 'cylinder', view: { center: [500, 0], zoom: 3, pitch: 0, bearing: 0 }, source: { kind: 'file', name: 'C:\\secret\\a.gpkg', size: 1 } })
    )
    expect(r?.dropped.sort()).toEqual(['basemap', 'file', 'projection', 'view'])
    expect(r?.state.query).toBe(typical.query)
    expect(r?.state.style?.extrusion).toEqual(typical.style?.extrusion)
  })

  it('a style is sanitized on the way in', () => {
    const r = decodeShareState(linkOf({ ...typical, style: { fillColor: 'not a color', fillOpacity: 9 } }))
    expect(r?.state.style?.fillColor).toBe(DEFAULT_LAYER_STYLE.fillColor)
    expect(r?.state.style?.fillOpacity).toBe(1)
  })

  it('garbage is not a link', () => {
    expect(decodeShareState('')).toBeNull()
    expect(decodeShareState('#v1=!!!not-base64')).toBeNull()
    expect(decodeShareState('#v1=' + 'A'.repeat(40))).toBeNull()
    expect(decodeShareState('#v2=abc')).toBeNull()
    expect(decodeShareState(linkOf({ v: 2 }))).toBeNull()
  })

  it('holds only what the type allows: no rows, no extra fields', () => {
    const r = decodeShareState(linkOf({ ...typical, rows: [{ secret: 1 }], path: 'C:/data' }))
    expect(Object.keys(r!.state).sort()).toEqual(['basemap', 'layer', 'projection', 'query', 'source', 'style', 'v', 'view'])
    const encoded = encodeShareState({ ...typical, rows: [1, 2, 3] } as unknown as ShareState)
    expect(JSON.stringify(decodeShareState(encoded)?.state)).not.toContain('rows')
  })
})
