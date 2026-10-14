// T034 (specs/001-quick-look/tasks.md): CRS resolution + reprojection-SQL
// correctness. Full end-to-end reprojection (openFile() against a real
// non-WGS84 fixture, inside the real DuckDB-WASM build) is covered by
// tests/vscode-ext's open-file-crs.test.ts — this is the fast, isolated unit
// test for packages/core/src/crs.ts's own logic.
import { describe, expect, it } from 'vitest'
import { reprojectToWgs84Sql, resolveCrsInfo, toWebMercatorSql, WGS84 } from '@spatial-explorer/core'

describe('resolveCrsInfo', () => {
  it('assumes WGS84 and discloses it when the source SRID is unknown (FR-015)', () => {
    const { crs, assumed } = resolveCrsInfo(null)
    expect(crs).toEqual(WGS84)
    expect(assumed).toBe(true)
  })

  it('reports WGS84 without disclosure when the source SRID is already 4326', () => {
    const { crs, assumed } = resolveCrsInfo(4326)
    expect(crs).toEqual(WGS84)
    expect(assumed).toBe(false)
  })

  it('reports the real, original source CRS — not WGS84 — for a non-WGS84 SRID (FR-007)', () => {
    const { crs, assumed } = resolveCrsInfo(26912)
    expect(crs).toEqual({ label: 'EPSG:26912', isWgs84: false })
    expect(assumed).toBe(false)
  })
})

describe('reprojectToWgs84Sql', () => {
  it('leaves the geometry expression unchanged when the source SRID is null (unknown/assumed)', () => {
    expect(reprojectToWgs84Sql('geom', null)).toBe('geom')
  })

  it('leaves the geometry expression unchanged when the source SRID is already 4326', () => {
    expect(reprojectToWgs84Sql('geom', 4326)).toBe('geom')
  })

  it('wraps a non-WGS84 source in ST_Transform with always_xy := true', () => {
    // always_xy is not optional: a real `duckdb` CLI spike confirmed that
    // without it, ST_Transform silently produces `POINT (inf inf)` for a
    // geographic source CRS like EPSG:4326, since DuckDB spatial's GEOMETRY
    // type stores [lon, lat] while ST_Transform otherwise defaults to
    // authority axis order ([lat, lon] for EPSG:4326). See crs.ts's doc
    // comment and research.md §5.
    const sql = reprojectToWgs84Sql('geom', 26912)
    expect(sql).toBe("ST_Transform(geom, 'EPSG:26912', 'EPSG:4326', always_xy := true)")
  })

  it('wraps an arbitrary geometry-producing SQL expression, not just a bare column name', () => {
    const sql = reprojectToWgs84Sql('ST_GeomFromWKB(geometry)', 32612)
    expect(sql).toBe("ST_Transform(ST_GeomFromWKB(geometry), 'EPSG:32612', 'EPSG:4326', always_xy := true)")
  })
})

describe('toWebMercatorSql (spec 010)', () => {
  it('transforms WGS84 (null or 4326) to EPSG:3857 with always_xy', () => {
    expect(toWebMercatorSql('geom', null)).toBe("ST_Transform(geom, 'EPSG:4326', 'EPSG:3857', always_xy := true)")
    expect(toWebMercatorSql('geom', 4326)).toBe("ST_Transform(geom, 'EPSG:4326', 'EPSG:3857', always_xy := true)")
  })

  it('transforms a projected source straight to EPSG:3857', () => {
    expect(toWebMercatorSql('"g"', 26912)).toBe(`ST_Transform("g", 'EPSG:26912', 'EPSG:3857', always_xy := true)`)
  })
})
