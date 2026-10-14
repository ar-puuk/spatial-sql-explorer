# Spatial Explorer

Open a geospatial file and see it on a map and in a table, query it with
spatial SQL, style it, and export it, without opening a desktop GIS. One
codebase ships as:

- **A VS Code extension**, "Spatial Explorer: Spatial SQL & Map Viewer", on the
  VS Code Marketplace and Open VSX. See the [extension README](apps/vscode-ext/README.md).
- **A web app**: https://ar-puuk.github.io/spatial-sql-explorer/

Everything runs locally, in WebAssembly: your files are never uploaded.

## Features

- **Look**: GeoJSON, GeoPackage (several layers), SQLite/SpatiaLite (e.g.
  Cube 7 networks), FlatGeobuf, Shapefile, GeoParquet, Parquet, GML, CSV and
  PMTiles and Excel, on a map and in an attribute table kept in sync. Small
  results are drawn once from memory; big ones (millions of rows, several GB)
  from vector tiles the engine builds as you pan, with a "Load all" option.
  129 basemaps from 26 providers (keyed ones with your own key), a globe view,
  one search box for layer values, coordinates and places, and any source CRS.
- **Query**: DuckDB spatial SQL against the file as the table `layer`, with
  autocomplete and inline errors; results replace the map and the table. A
  query can read other files too: workspace files by relative path in VS Code
  (`ST_Read('data/links.shp')`), added files on the web.
- **Style**: single, categorized, graduated (by a column or a SQL expression),
  bivariate, rule-based (SQL conditions, first match wins) and heatmap
  styles, ramps previewed on the map, and, under **Vary by attribute**, more
  properties each by their own column (size or width, outline color and
  width, shape, pattern, opacity, rotation), so one map can show several
  variables at once (say, roads colored by level of service and widened by
  traffic). A legend group per property, layer opacity, 3D polygon
  extrusion. Saved as a QGIS `.qml` sidecar; imports and exports QML, SLD and
  Mapbox GL style JSON.
- **Export**: GeoParquet, GeoPackage, GeoJSON, newline-delimited GeoJSON,
  FlatGeobuf, Shapefile, KML, CSV, Parquet, Excel and JSON, in any EPSG CRS;
  all, filtered or selected rows. The map exports as a PNG with its legend.
  The web app can also copy a share link (the view, never the data).

See [CHANGELOG.md](CHANGELOG.md) for everything in each release.

## Network use

Data stays on your machine. The network is used for the SQL engine's code
(DuckDB-WASM, its extensions and sql.js, downloaded once from pinned jsDelivr
and extensions.duckdb.org URLs, checked against SHA-256 hashes, then kept
locally so later starts work offline), for basemap tiles, and for the opt-out
place search, which sends only the text you type.

## Development

```bash
npm install
npm run dev                 # web app at http://localhost:5173
npm run build               # web app build (apps/web/dist)
npm run build --workspace=apps/vscode-ext   # extension (then F5 in VS Code, or `npm run package` there)
npm run test:core           # unit tests (Vitest)
npm run test:web            # browser tests (Playwright)
npm run test:vscode-ext     # extension tests (@vscode/test-electron)
npm run lint
```

After upgrading `@duckdb/duckdb-wasm` or `sql.js`, run
`node scripts/engine-assets.mjs` to record the new engine hashes; browser tests
serve a local mirror of the engine (`node scripts/engine-assets.mjs --mirror`).

### Project structure

```
apps/web          web app shell (Vite + Svelte)
apps/vscode-ext   VS Code extension (custom editor + webview)
packages/core     engine: DuckDB-WASM, sources, queries, styles, export
packages/ui       shared Svelte UI (map, table, panels)
tests/            core, web and extension test suites
specs/            feature specs, plans and research (Spec Kit)
```

The single-page app this project replaces is preserved at the `legacy-v1` tag.

## Acknowledgements

- Inspired by [Kyle Walker's Spatial SQL Explorer](https://personal.tcu.edu/kylewalker/urbangis/sql-explorer/)
- [DuckDB](https://duckdb.org/) and its spatial extension
- [MapLibre GL JS](https://maplibre.org/) for map rendering
- [OpenFreeMap](https://openfreemap.org/) for free, open map tiles
- [Nominatim](https://nominatim.org/) / [OpenStreetMap](https://www.openstreetmap.org/) contributors for geocoding

Third-party licenses: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## License

MIT. See [LICENSE](LICENSE).
