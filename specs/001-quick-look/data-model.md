# Phase 1 Data Model: Quick Look (001)

Scope: only the entities needed for spec 001 (open → map + table, CRS/count/
geometry-type display, selection sync, default basemap on/off, click-to-inspect).
Styling, SQL, export, and multi-file session entities are explicitly deferred
to specs 002–006 and are not modeled here.

## Layer

The single opened geospatial dataset for the current viewer session (first
layer only, per the clarified multi-layer decision — FR-018, Edge Cases).

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable per viewer session; not persisted across reopens. |
| `sourceUri` | string | HostAdapter-resolved reference to the opened file (never a raw local filesystem path in `packages/core`/`packages/ui` — see HostAdapter contract). |
| `sourceFormat` | string | One of the formats confirmed by the Spike 1 follow-up task (`research.md` §1); set from detection, not from the file extension alone. |
| `geometryType` | `'Point' \| 'LineString' \| 'Polygon' \| 'Mixed'` | `'Mixed'` when more than one base geometry type is present (FR-013). |
| `sourceCrs` | `CrsInfo` | The CRS as read from the file; see below. Reprojection to EPSG:4326 happens only for rendering (FR-007) — this field always reflects the *original* source CRS. |
| `crsAssumed` | boolean | `true` when the file had no CRS information and WGS84 was assumed (FR-015); drives the disclosure UI. |
| `featureCount` | number | Total count of valid features in the source, excluding skipped invalid geometries — this is the number shown in metadata/status displays (FR-006), independent of how many are actually rendered. |
| `invalidGeometryCount` | number | Count of geometries skipped during rendering (FR-014); `0` when none were skipped. |
| `truncated` | boolean | `true` when `featureCount > 1000` and only the first 1000 were loaded into `features` (FR-019). |
| `extent` | `BBox` (`[minX, minY, maxX, maxY]`, EPSG:4326) | Used to fit the map view on open (FR-003). Computed from the *full* source extent (query-level, e.g. `ST_Extent`), not just the loaded/rendered subset, so the fit is correct even when `truncated` is `true`. `null` for a zero-feature layer (Edge Cases). |
| `features` | `Feature[]` | The loaded/rendered subset actually held in memory — at most 1000 entries (FR-019; `features.length <= 1000`, and `features.length === featureCount` only when `!truncated`). Ordered collection; order defines the table's default row order and is stable for the session (the table can re-sort its *view* of these rows). Attributes exclude the source geometry column and GDAL's synthetic `OGC_FID` (research.md §8). |
| `styleSidecar` | `{ fileName: string; text: string } \| null` | The QGIS-convention style sidecar (`<basename>.qml`) found next to the data file, as raw text, or `null`. Parsed and applied by the UI on open (design-plan.md §8.5). |

### LayerStyle (UI state, not persisted in the session)

Single-symbol style applied to the layer (design-plan.md §8.5): `fillColor`,
`fillOpacity`, `strokeColor`, `strokeOpacity`, `strokeWidth` (px),
`pointRadius` (px). Fixed, theme-independent data colors (CLAUDE.md). It is
saved and exchanged only as files: the QML sidecar, plus QML/SLD/Mapbox GL
export and import. It is never stored in webview storage.

### CrsInfo

| Field | Type | Notes |
|---|---|---|
| `label` | string | Human-readable identifier for display (e.g. an EPSG code or WKT-derived name). |
| `isWgs84` | boolean | Convenience flag; when `true`, no reprojection is needed for display. |

### BBox

Plain 4-tuple `[minX, minY, maxX, maxY]` in EPSG:4326. Not a class — kept as a
tuple type since no behavior attaches to it in this spec.

## Feature

One record within a `Layer`. Identity is shared between its map representation
and its table row (FR-005).

| Field | Type | Notes |
|---|---|---|
| `id` | string \| number | Stable within the layer; used to correlate map ↔ table selection. Falls back to row index if the source has no natural identifier. |
| `geometry` | geometry (EPSG:4326, reprojected for display) \| `null` | `null` only for the (invalid-geometry-skipped) case is not applicable here — invalid geometries are excluded from `Layer.features` entirely and only counted in `invalidGeometryCount`. A feature with genuinely empty geometry (valid-but-empty) renders in the table only. |
| `attributes` | `Record<string, string \| number \| boolean \| null>` | Flat attribute map; nested/complex attribute values are stringified for this spec (no nested-table UI in scope). |

## ViewerSession

The open instance of the viewer bound to one file, for the lifetime the file
is open (one per custom-editor webview or one per web-app tab).

| Field | Type | Notes |
|---|---|---|
| `layer` | `Layer \| null` | `null` while loading or if the open failed (FR-011). |
| `loadState` | `'idle' \| 'loading' \| 'ready' \| 'error'` | Drives empty/loading/error UI states (Edge Cases). |
| `loadError` | `{ message: string } \| null` | Set only when `loadState === 'error'`; message must be specific per FR-011, not generic. |
| `basemapEnabled` | boolean | User toggle (FR-009); default `true`. |
| `basemapAppearance` | `'light' \| 'dark'` | Derived from `HostAdapter.getTheme()` at open and updated on theme change (FR-017); drives which default basemap style loads. |
| `selectedFeatureId` | `Feature['id'] \| null` | Shared selection state driving map↔table highlight sync (FR-005, FR-010). |
| `cursorCoordinates` | `{ lon: number; lat: number } \| null` | Live cursor position over the map (FR-008); `null` when the cursor is not over the map. |

## State transitions (ViewerSession.loadState)

```text
idle → loading → ready
                 ↘ error
```

- `idle → loading`: a file is chosen (VS Code open, or web picker/drag-drop).
- `loading → ready`: the layer parsed successfully (even if `featureCount === 0`
  — a zero-feature layer is still "ready", per Edge Cases, not an error).
- `loading → error`: the file could not be opened (unsupported, corrupt, or
  unreadable) — FR-011. There is no `error → ready` transition within one
  session; the user must reopen.
- No transition leaves `ready` except closing/reopening the viewer (out of
  scope for this spec — no live file-watch reload, per Edge Cases).

## Validation rules carried from Requirements

- A `Layer` with `featureCount === 0` is valid and renders an empty map +
  table with a visible indicator (FR-012) — this is distinct from
  `loadState === 'error'`.
- `invalidGeometryCount > 0` must be surfaced visibly alongside the layer
  metadata (FR-014); it never blocks reaching `ready`.
- `crsAssumed === true` must be disclosed in the same UI surface as
  `sourceCrs.label` (FR-015) — never shown as if it were read from the file.
- `truncated === true` must be disclosed visibly alongside `featureCount`
  (FR-019) — e.g. "Showing 1,000 of 4,213 features" — never silently; a user
  must never mistake a truncated view for the complete dataset.
