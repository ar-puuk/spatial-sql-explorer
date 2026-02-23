# Spatial SQL Explorer

A client-side spatial data analysis tool that lets you load GeoJSON, run SQL queries with DuckDB, and explore results interactively on a map — all in the browser with no backend required.

![Spatial SQL Explorer](https://img.shields.io/badge/built%20with-DuckDB%20WASM-f0a500?style=flat-square) ![MapLibre GL](https://img.shields.io/badge/map-MapLibre%20GL%20v5-3ddc84?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## Overview

Spatial SQL Explorer brings together a SQL engine, an interactive map, and a live results table in a single-page application. Every computation runs in your browser using WebAssembly — your data never leaves your machine.

It was inspired by [Kyle Walker's Spatial SQL Explorer](https://personal.tcu.edu/kylewalker/urbangis/sql-explorer/) and built to be fully open, self-hostable, and extensible.

---

## Features

- **Client-side SQL** — Full DuckDB WASM engine with the spatial extension loaded in-browser. Supports spatial functions like `ST_Within`, `ST_Intersects`, `ST_Area`, and more.
- **GeoJSON support** — Load any valid GeoJSON file (Points, Lines, Polygons, MultiGeometries, GeometryCollections) via drag-and-drop or file picker. Demo data included.
- **Live map rendering** — Query results with geometry render instantly on a MapLibre GL globe. Points, lines, and polygons each get dedicated styled layers.
- **Two-way selection** — Click a feature on the map to highlight its row in the table. Check a row in the table to highlight its feature on the map. Multi-select supported.
- **Client-side filtering and sorting** — Filter any column with a live text input. Sort any column ascending or descending. Both operate on the current result set without re-running SQL.
- **Globe projection** — Starts in globe mode with a toggle to switch to flat Mercator. Powered by MapLibre GL v5.
- **Geocoder** — Search any location worldwide via Nominatim (OpenStreetMap) to navigate the map.
- **Auto-zoom** — After each query, the map flies smoothly to the extent of the result features.
- **Query history** — Past queries are stored in the session with row counts and execution times. Click any history entry to restore it to the editor.
- **Safety cap** — Configurable row limit automatically appended to queries that don't include one, preventing accidental rendering of huge datasets.
- **No backend, no build step** — Pure HTML, CSS, and JavaScript. All dependencies loaded from CDN. Deploy anywhere static files are served.

---

## Tech Stack

| Component | Library | Notes |
|---|---|---|
| SQL engine | [DuckDB WASM](https://duckdb.org/docs/api/wasm/overview) v1.29 | Runs entirely in-browser via WebAssembly |
| Spatial extension | DuckDB spatial | `ST_Read`, `ST_AsGeoJSON`, spatial predicates |
| Map | [MapLibre GL JS](https://maplibre.org/) v5 | Globe projection, GeoJSON layers |
| Map tiles | [OpenFreeMap](https://openfreemap.org/) | Free, no API key required |
| SQL editor | [CodeMirror 6](https://codemirror.net/) | SQL syntax highlighting, `Ctrl+Enter` to run |
| Geocoder | [maplibre-gl-geocoder](https://github.com/maplibre/maplibre-gl-geocoder) + [Nominatim](https://nominatim.org/) | Free, no API key required |
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

**Demo data** — Click **Use Demo Data** to load the included sample dataset of 30 points of interest in the Dallas–Fort Worth metro area. A default query runs automatically.

**Your own data** — Drag and drop any `.geojson` file onto the drop zone, or click **Choose GeoJSON** to browse. The file is registered as a DuckDB table named after the file (e.g. `my_file.geojson` becomes table `my_file`). A `SELECT * FROM "my_file" LIMIT 50` query runs immediately.

### Writing queries

Use the SQL editor on the left. The current table name and its feature/attribute counts are shown above the editor. Press **Ctrl+Enter** (or **Cmd+Enter** on Mac) or click **Run Query** to execute.

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

### Interacting with results

**Table filtering** — Type in the filter input below any column header to filter rows in real time. Multiple column filters apply simultaneously.

**Table sorting** — Click any column header to sort ascending. Click again to sort descending. Click a third time to clear the sort.

**Selecting features** — Check the checkbox on any row to highlight the corresponding feature on the map in yellow. Click a feature on the map to check its row and scroll the table to it. Check the header checkbox to select all currently visible rows.

### Navigating the map

- **Geocoder** — Search any place name or address using the search bar in the top-right corner.
- **Globe toggle** — Switch between globe and flat Mercator projection using the globe button.
- **Zoom controls** — Standard zoom in/out buttons.
- **Auto-zoom** — The map automatically flies to the extent of each query result.

---

## Project Structure

```
spatial-sql-explorer/
├── index.html                 # App shell, CDN imports, three-column layout
├── coi-serviceworker.min.js   # Cross-origin isolation for SharedArrayBuffer
├── css/
│   └── style.css              # All styles — layout, panels, table, map
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

- **File format** — Only `.geojson` and `.json` files are supported for upload. Support for Shapefile, GeoPackage, or CSV with coordinates could be added using DuckDB's additional readers.
- **Large files** — Very large GeoJSON files (100MB+) may be slow to load or exceed browser memory. Consider filtering or simplifying large datasets before loading.
- **Spatial extension** — Installation of the DuckDB spatial extension requires an internet connection on first load, as it downloads the extension WASM binary from the DuckDB CDN.
- **No persistence** — Loaded tables and query history are not saved between sessions.

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
