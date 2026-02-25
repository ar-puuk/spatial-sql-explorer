# Spatial SQL Explorer

A client-side spatial data analysis tool that lets you load GeoJSON, CSV, TSV, and Parquet files, run SQL queries with DuckDB, and explore results interactively on a map — all in the browser with no backend required.

![Spatial SQL Explorer](https://img.shields.io/badge/built%20with-DuckDB%20WASM-f0a500?style=flat-square) ![MapLibre GL](https://img.shields.io/badge/map-MapLibre%20GL%20v5-3ddc84?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## Overview

Spatial SQL Explorer brings together a SQL engine, an interactive map, and a live results table in a single-page application. Every computation runs in your browser using WebAssembly — your data never leaves your machine.

It was inspired by [Kyle Walker's Spatial SQL Explorer](https://personal.tcu.edu/kylewalker/urbangis/sql-explorer/) and built to be fully open, self-hostable, and extensible.

---

## Features

- **Client-side SQL** — Full DuckDB WASM engine with the spatial extension loaded in-browser. Supports spatial functions like `ST_Within`, `ST_Intersects`, `ST_Area`, and more.
- **Multi-format file loading** — Load GeoJSON, CSV, TSV, and Parquet files via drag-and-drop or file picker. Each file is registered as a named DuckDB table. Multiple tables can be loaded and queried simultaneously.
- **Live map rendering** — Query results with geometry render instantly on a MapLibre GL globe. Points, lines, and polygons each get dedicated styled layers.
- **Map styling** — Style query results using Single color, Graduated (choropleth), or Categorical modes. Graduated mode supports Quantile, Equal Interval, and Natural Breaks classification with 3–9 classes and multiple color ramps. Categorical mode auto-assigns colors to up to 20 unique values.
- **Interactive legend** — An on-map legend updates live after applying a style. Graduated legends include a draggable range-filter slider to subset visible features without re-running SQL. Categorical legends support toggling individual categories on and off.
- **Two-way selection** — Click a feature on the map to highlight its row in the table. Check a row in the table to highlight its feature on the map. Multi-select supported.
- **Client-side filtering and sorting** — Filter any column with a live text input. Sort any column ascending or descending. Both operate on the current result set without re-running SQL.
- **Session persistence** — Loaded tables, query history, and your last query are saved to IndexedDB and restored automatically on next visit. No data leaves your machine.
- **Shareable links** — The ⬡ Share button encodes the current SQL query and map style into a URL hash. Paste the link anywhere to share an exact view with others.
- **Export** — Download results as CSV or GeoJSON. Export the current map view as a PNG (with legend burned in).
- **Multiple basemaps** — Switch between Light, Dark, Satellite (Esri), and Topo (OpenTopoMap) basemaps. The basemap auto-switches to match the app theme when on Light or Dark.
- **Light / dark theme** — Toggle between themes with the ☾/☀ button. Follows your OS preference by default; manual selection is remembered.
- **Globe projection** — Starts in globe mode. Powered by MapLibre GL v5.
- **Geocoder** — Search any location worldwide via Nominatim (OpenStreetMap) to navigate the map.
- **Auto-zoom** — After each query, the map flies smoothly to the extent of the result features.
- **SQL autocomplete** — The editor is schema-aware: table names and column names from all loaded tables are available as autocomplete suggestions.
- **Query history** — Past queries are stored in the session with row counts and execution times. Click any history entry to restore it to the editor.
- **Safety cap** — Configurable row limit automatically appended to queries that don't include one, preventing accidental rendering of huge datasets.
- **Resizable panels** — Drag the handles between panels to resize the left, map, and right columns. Double-click a handle to reset to default.
- **No backend, no build step** — Pure HTML, CSS, and JavaScript. All dependencies loaded from CDN. Deploy anywhere static files are served.

---

## Tech Stack

| Component | Library | Notes |
|---|---|---|
| SQL engine | [DuckDB WASM](https://duckdb.org/docs/api/wasm/overview) v1.29 | Runs entirely in-browser via WebAssembly |
| Spatial extension | [DuckDB spatial](https://duckdb.org/docs/stable/core_extensions/spatial/overview) | `ST_Read`, `ST_AsGeoJSON`, spatial predicates |
| Map | [MapLibre GL JS](https://maplibre.org/) v5 | Globe projection, GeoJSON layers |
| Map tiles | [OpenFreeMap](https://openfreemap.org/) | Free, no API key required (Light + Dark) |
| SQL editor | [CodeMirror 6](https://codemirror.net/) | SQL syntax highlighting, schema-aware autocomplete, `Ctrl+Enter` to run |
| Geocoder | [maplibre-gl-geocoder](https://github.com/maplibre/maplibre-gl-geocoder) + [Nominatim](https://nominatim.org/) | Free, no API key required |
| Persistence | IndexedDB (browser-native) | Tables, history, and last query survive page reload |
| SharedArrayBuffer | [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) | Enables DuckDB multithreading on GitHub Pages |

---

## Getting Started

### Run locally

Clone the repo and serve it with any static file server. A simple option using Python:

```bash
git clone https://github.com/your-username/spatial-sql-explorer.git
cd spatial-sql-explorer
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

> **Important:** DuckDB WASM requires `SharedArrayBuffer`, which requires the page to be served over HTTP (not opened directly as a `file://` URL) and needs cross-origin isolation headers. The included `coi-serviceworker.min.js` handles this automatically.

### Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages** in your repository.
3. Set the source to the `main` branch, root folder.
4. GitHub Pages will serve the app at `https://your-username.github.io/spatial-sql-explorer/`.

The `coi-serviceworker.min.js` file in the project root handles the `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` headers that GitHub Pages doesn't set natively — no server configuration needed.

---

## Usage

### Loading data

**Demo data** — Click **Demo Data** to load the included sample dataset of points of interest in the Dallas–Fort Worth metro area. A default query runs automatically.

**Your own data** — Drag and drop one or more files onto the drop zone, or click to browse. Supported formats:

| Format | Extension | Notes |
|---|---|---|
| GeoJSON | `.geojson`, `.json` | Points, lines, polygons, multi-geometries, GeometryCollections |
| CSV | `.csv` | Auto-detected delimiter and types |
| TSV | `.tsv` | Tab-separated |
| Parquet | `.parquet` | Column-oriented binary format |

Each file is registered as a DuckDB table named after the file (e.g. `my_data.geojson` → table `my_data`). All loaded tables appear in the **Loaded Tables** registry at the top of the left panel, where you can query or remove them individually. Tables persist across page reloads via IndexedDB.

### Writing queries

Use the SQL editor on the left. Press **Ctrl+Enter** (or **Cmd+Enter** on Mac) or click **▶ Run Query** to execute. The editor provides autocomplete for table names and column names from all loaded tables.

Any valid DuckDB SQL works. Some examples:

```sql
-- Basic select
SELECT * FROM places LIMIT 100

-- Filter by attribute
SELECT * FROM places WHERE category = 'restaurant'

-- Spatial filter: features within a bounding box
SELECT * FROM places
WHERE ST_Within(geometry, ST_MakeEnvelope(-97.0, 32.7, -96.7, 33.0))

-- Aggregate
SELECT category, COUNT(*) AS count, AVG(confidence) AS avg_conf
FROM places
GROUP BY category
ORDER BY count DESC

-- Spatial join: features within a polygon from another table
SELECT a.*
FROM points a, districts b
WHERE ST_Within(a.geometry, b.geometry)
AND b.name = 'Downtown'
```

If your query doesn't include a `LIMIT` clause, the safety cap (default 50,000 rows) is appended automatically. You can adjust this in the **LIMIT** input next to the Run button.

### Styling the map

After a query returns geometry results, the **Map Style** panel appears in the right column. Choose a mode with the pill toggle:

- **Single** — Apply one color to all features.
- **Graduated** — Choropleth by a numeric column. Choose a classification method (Quantile, Equal Interval, Natural Breaks), number of classes (3–9), and a color ramp. Click ⇅ to invert the ramp.
- **Categorical** — Color features by a string or numeric column. Up to 20 unique categories are colored automatically.

Use the **Opacity** slider to control transparency, then click **Apply** to render the style on the map.

### Using the interactive legend

After clicking Apply, an interactive legend appears on the map:

- **Graduated** — A draggable range-filter slider lets you narrow the visible features to a value range without re-running SQL. Drag the handles or slide the selection window.
- **Categorical** — Click any category row to toggle its visibility on the map.
- Click **✕** to dismiss the legend and clear any active filter.

### Interacting with results

**Table filtering** — Type in the filter input below any column header to filter rows in real time. Multiple column filters apply simultaneously.

**Table sorting** — Click any column header to sort ascending. Click again to sort descending. Click a third time to clear the sort.

**Selecting features** — Check the checkbox on any row to highlight the corresponding feature on the map in yellow. Click a feature on the map to check its row and scroll the table to it. Check the header checkbox to select all currently visible rows.

### Exporting

| Button | Output |
|---|---|
| **CSV** | Current filtered result (non-geometry columns) as a `.csv` file |
| **GeoJSON** | Current filtered result as a `.geojson` FeatureCollection |
| **⬡ Share** | Copies a URL to the clipboard encoding the current SQL query and map style |
| **⬇ PNG** | Exports the current map view as a PNG with the legend burned in |

> **Note:** PNG export works best with the Light or Dark basemap. Satellite and Topo tiles are CORS-restricted; if they block the canvas read, only the legend is exported.

### Navigating the map

- **Basemap switcher** — Toggle between Light, Dark, Satellite, and Topo basemaps using the pill buttons in the top-left corner of the map.
- **Theme toggle** — Click ☾/☀ in the app header to switch between dark and light themes. Switching between Light/Dark themes also switches the basemap automatically.
- **Geocoder** — Search any place name or address using the search bar in the top-right corner.
- **Globe toggle** — Switch between globe and flat Mercator projection using the globe button.
- **Zoom controls** — Standard zoom in/out buttons.
- **Auto-zoom** — The map automatically flies to the extent of each query result.
- **Resize panels** — Drag the vertical handles between panels to adjust the width of the left, map, and right columns. Double-click a handle to reset it.

---

## Project Structure

```
spatial-sql-explorer/
├── index.html                 # App shell, CDN imports, three-column layout
├── coi-serviceworker.min.js   # Cross-origin isolation for SharedArrayBuffer
├── css/
│   └── style.css              # All styles — layout, panels, table, map, themes
├── js/
│   └── app.js                 # All application logic (ES module)
└── data/
    └── demo.geojson           # Sample DFW points of interest
```

All logic lives in `app.js` as a single ES module. There is no bundler, no `node_modules`, and no build step. Dependencies are loaded via CDN at runtime.

---

## Browser Compatibility

Requires a modern browser with WebAssembly and ES module support. Tested in:

- Chrome / Edge 90+
- Firefox 90+
- Safari 15+

Not supported in Internet Explorer.

---

## Known Limitations

- **Large files** — Very large files (100MB+) may be slow to load or exceed browser memory. Consider filtering or simplifying large datasets before loading.
- **Spatial extension** — Installation of the DuckDB spatial extension requires an internet connection on first load, as it downloads the extension WASM binary from the DuckDB CDN.
- **PNG export** — Satellite and Topo basemaps use CORS-restricted tiles. If the map canvas is tainted, only the legend is exported. Switch to the Light basemap for a full map PNG.
- **Share links and uploaded files** — The ⬡ Share URL encodes SQL and style, but not the uploaded file data itself. Recipients need to load the same file(s) before the shared query will run.

---

## Acknowledgements

- Inspired by [Kyle Walker's Spatial SQL Explorer](https://personal.tcu.edu/kylewalker/urbangis/sql-explorer/)
- [DuckDB](https://duckdb.org/) for the incredible in-process analytical SQL engine
- [MapLibre GL JS](https://maplibre.org/) for open-source WebGL map rendering
- [OpenFreeMap](https://openfreemap.org/) for free, open map tiles
- [Nominatim](https://nominatim.org/) / [OpenStreetMap](https://www.openstreetmap.org/) contributors for geocoding

---

## License

MIT — see [LICENSE](LICENSE) for details.
