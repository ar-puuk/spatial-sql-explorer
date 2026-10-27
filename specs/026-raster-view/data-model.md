# Data model: Raster view and inspect (spec 026)

Types live in `packages/core/src/raster/types.ts` unless noted.

## RasterFacts (`Layer.raster`)
What the file is. Read once at open; never edited.

| Field | Meaning | Source |
|---|---|---|
| `source` | `'file'` (as given) or `'converted'` (striped file made into a COG in memory) | open path |
| `width`, `height` | pixels of level 0 | tiler `levels[0]` |
| `bands` | `RasterBand[]` | below |
| `dataType` | `uint8`, `int16`, `uint16`, `int32`, `uint32`, `float32`, `float64` | `levels[0].sample_format` + bits |
| `crs` | `{ label, code?: number, units: 'degrees'\|'metres'\|'feet'\|'other', geographic: boolean }`, extends `CrsInfo` (adds `code?`, `units?`) | tiler `crsLabel`, GeoKeys |
| `extent` | `[minX, minY, maxX, maxY]` in the file's CRS | header |
| `extentWgs84` | `[minLon, minLat, maxLon, maxLat]`; also `Layer.extent` | tiler `boundsLonLat` |
| `pixelSize` | `[x, y]` in CRS units, positive | header |
| `nodata` | `number \| 'nan' \| null` (NaN is a string so it survives JSON) | header |
| `compression` | name, e.g. `Deflate`, `LZW`, `None` | `levels[0].compression` |
| `tiled`, `tileSize` | `[w, h]` | `levels[0]` |
| `overviews` | count of reduced levels (`levels.length - 1`) | tiler |
| `mode` | `'3857'` or `'warp'` (informational) | tiler |
| `hasPalette` | colour table present | tiler |
| `warnings` | strings shown in the card (no overviews, big file, parts of the file ignored) | open path |

Validation: a file with no georeferencing or an unplaceable CRS is refused before a `Layer` exists (FR-004). `extentWgs84` within lon -180..180 and lat -90..90 or a clamp with a warning.

## RasterBand
`{ index: number (1-based), name: string ('Band N' when the file has none), interpretation?: 'gray'|'red'|'green'|'blue'|'alpha'|'palette'|'undefined', min?, max?, mean?, std?, median?, p2?, p98?, histogram?: number[] }`. Statistics come from `cog.statistics` (decimated; see plan D5); the card says they are estimates.

## RasterStyle (`store.rasterStyle`)
How it is drawn. Remembered per file.

| Field | Values | Notes |
|---|---|---|
| `mode` | `'single'` \| `'rgb'` \| `'paletted'` | `paletted` only when `hasPalette` |
| `bands` | `[n]` or `[r, g, b]` | 1-based, within `bands.length` |
| `min`, `max` | number (single) | rescale range; per-band `rescale` for `rgb` |
| `rescale` | `[[min,max],...]` | optional, `rgb` only |
| `stretch` | `'linear'` \| `'sqrt'` \| `'log'` | single and rgb |
| `gamma` | number, default 1 | |
| `colormap` | a name from the tiler's list | single |
| `reversed` | boolean | single |
| `nodata` | `{ mode: 'file' \| 'value' \| 'none', value?: number }` | transparency of nodata |
| `opacity` | 0..1 | MapLibre `raster-opacity`; the tiler's own `opacity` stays 1 |

Derived: `toRenderOptions(style, facts) → RenderOptions` (the tiler's: `bidx`, `min`, `max`, `rescale`, `colormap`, `reversed`, `stretch`, `gamma`, `nodata`). Defaults: `defaultRasterStyle(facts)` (plan D6). Validation: bands in range; `min < max`; `colormap` known, else `viridis`; unknown fields are dropped on read (`sanitizeRasterStyle`, like `sanitizeStyle`).
State transitions: `default` → `edited` (dirty) → `saved` (sidecar written) ; a re-open reads sidecar, else saved state, else default.

## PixelReading (`store.pixel`)
`{ lon, lat, values: { band: number, name: string, value: number | null }[], outside: boolean, classLabel?: string }`; `null` value = no data. Throttled to one in flight; not stored in history.

## RasterHandle (UI, not persisted)
`{ key: string, cog: CogSource, facts: RasterFacts, stats, version: number, dispose() }`. One per open raster. `version` goes into the tile URL so a style change refetches.

## Capabilities (`store.capabilities`)
`{ kind: 'vector'|'raster', query, table, filters, search, selection, shapes, grid, time, exportRows, vectorStyle, rasterStyle, print: { tables, atlas, legend } }`, booleans. Vector layers keep today's values; PMTiles keeps `tilesOnlyReason`.

## Engine assets (`engineAssets.json` `raster`)
`{ whitebox: {url, sha256, bytes}, cogTiler: {...}, converter: {...} }`. See contracts/raster-engine.md.

## Relationships
`Layer` 1 — 0..1 `RasterFacts`; `RasterFacts` 1 — N `RasterBand`; `RasterStyle` is keyed by file (`stateKey`) and refers to bands by index; `RasterHandle` owns the tiler and is created and destroyed with the layer (replaced layer → disposed).
