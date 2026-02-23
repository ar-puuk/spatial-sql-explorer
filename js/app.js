/* ============================================================
   SPATIAL SQL EXPLORER — app.js
   DuckDB-WASM + MapLibre GL JS + CodeMirror 6
   All processing is client-side.
   ============================================================ */

// ── ES Module imports from CDN ──────────────────────────────
import { basicSetup } from 'https://esm.sh/codemirror@6.0.1';
import { EditorView, keymap } from 'https://esm.sh/@codemirror/view@6.36.3';
import { sql, StandardSQL } from 'https://esm.sh/@codemirror/lang-sql@6.8.0';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2';
import { defaultKeymap } from 'https://esm.sh/@codemirror/commands@6.8.0';
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

/* ============================================================
   STATE
   ============================================================ */
let db = null;
let conn = null;
let editorView = null;
let map = null;
let queryHistory = [];
let loadedTables = [];

/* ============================================================
   INITIALIZATION
   ============================================================ */
async function init() {
  updateInitLog('Initializing DuckDB-WASM...');

  try {
    // Select the best available DuckDB bundle for this browser
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    // Create a worker from the bundle's worker script
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.VoidLogger();

    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    // Open a connection
    conn = await db.connect();
    updateInitLog('DuckDB ready. Loading spatial extension...');

    // Load the spatial extension (requires internet)
    try {
      await conn.query(`INSTALL spatial; LOAD spatial;`);
      updateInitLog('Spatial extension loaded.');
    } catch (e) {
      // Spatial might already be installed or fail — degrade gracefully
      console.warn('Spatial extension warning:', e.message);
      updateInitLog('Spatial extension unavailable — geometry queries may be limited.');
    }

    // Initialize MapLibre
    updateInitLog('Initializing map...');
    initMap();

    // Initialize CodeMirror editor
    initEditor();

    // Load default demo data
    updateInitLog('Loading demo data...');
    await loadDemoData();

    // Hide init overlay
    document.getElementById('init-overlay').classList.add('hidden');

    updateInitLog('Ready.');
  } catch (err) {
    updateInitLog('Error: ' + err.message);
    console.error('Init error:', err);
  }
}

function updateInitLog(msg) {
  const el = document.getElementById('init-log');
  if (el) el.textContent = msg;
  console.log('[init]', msg);
}

/* ============================================================
   MAP INITIALIZATION (MapLibre)
   ============================================================ */
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [0, 20],
    zoom: 1.5,
    attributionControl: false
  });

  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
  });

  const geocoderApi = {
    forwardGeocode: async (config) => {
      const features = [];
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${config.query}&format=geojson&polygon_geojson=1&addressdetails=1`
        );
        const geojson = await response.json();
        for (const feature of geojson.features) {
          const center = [
            feature.bbox[0] + (feature.bbox[2] - feature.bbox[0]) / 2,
            feature.bbox[1] + (feature.bbox[3] - feature.bbox[1]) / 2
          ];
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: center },
            place_name: feature.properties.display_name,
            properties: feature.properties,
            text: feature.properties.display_name,
            place_type: ['place'],
            center
          });
        }
      } catch (e) {
        console.error('Geocoder error:', e);
      }
      return { features };
    }
  };

  map.addControl(new MaplibreGeocoder(geocoderApi, { maplibregl }), 'top-right');
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.GlobeControl(), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  // Show coordinates in status bar on mouse move
  map.on('mousemove', (e) => {
    const el = document.getElementById('map-coords');
    if (el) {
      el.textContent = `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`;
    }
  });

  // Add popup on point click
  map.on('click', 'query-points', (e) => {
    if (!e.features || !e.features.length) return;
    const props = e.features[0].properties;
    const coords = e.features[0].geometry.coordinates.slice();
    const html = Object.entries(props)
      .filter(([k]) => k !== '__id')
      .map(([k, v]) => `<div class="popup-row"><span class="popup-key">${k}</span><span class="popup-val">${v}</span></div>`)
      .join('');

    new maplibregl.Popup({ offset: 10, className: 'geo-popup' })
      .setLngLat(coords)
      .setHTML(`<div class="popup-content">${html}</div>`)
      .addTo(map);
  });

  map.on('mouseenter', 'query-points', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'query-points', () => {
    map.getCanvas().style.cursor = '';
  });

  // Similar for polygon layers
  map.on('click', 'query-polygons', (e) => {
    if (!e.features || !e.features.length) return;
    const props = e.features[0].properties;
    const center = e.lngLat;
    const html = Object.entries(props)
      .filter(([k]) => k !== '__id')
      .map(([k, v]) => `<div class="popup-row"><span class="popup-key">${k}</span><span class="popup-val">${v}</span></div>`)
      .join('');
    new maplibregl.Popup({ offset: 10, className: 'geo-popup' })
      .setLngLat(center)
      .setHTML(`<div class="popup-content">${html}</div>`)
      .addTo(map);
  });
}

/* ============================================================
   EDITOR INITIALIZATION (CodeMirror 6)
   ============================================================ */
function initEditor() {
  const defaultSQL = `SELECT * FROM demo LIMIT 100`;

  // Custom keybinding: Ctrl/Cmd+Enter to run query
  const runKeymap = keymap.of([
    {
      key: 'Ctrl-Enter',
      mac: 'Cmd-Enter',
      run: () => { runQuery(); return true; }
    }
  ]);

  editorView = new EditorView({
    doc: defaultSQL,
    extensions: [
      basicSetup,
      sql({ dialect: StandardSQL }),
      oneDark,
      runKeymap,
      EditorView.theme({
        '&': { height: '100%', background: '#0f1419' },
        '.cm-scroller': { overflow: 'auto' },
      })
    ],
    parent: document.getElementById('editor-wrapper')
  });
}

/* ============================================================
   DATA LOADING
   ============================================================ */
async function loadDemoData() {
  try {
    const response = await fetch('./data/demo.geojson');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const stats = await registerGeoJSON(text, 'demo');
    updateTableInfo('demo', stats.rowCount, stats.colCount);
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: `SELECT * FROM demo LIMIT 100` }
    });
    runQuery();
  } catch (err) {
    console.error('Failed to load demo data:', err);
    updateTableInfo();
  }
}

async function registerGeoJSON(geojsonText, tableName) {
  await db.registerFileText(`${tableName}.geojson`, geojsonText);
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);

  try {
    await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM ST_Read('${tableName}.geojson')`);
  } catch (e) {
    console.warn('ST_Read failed, falling back to JSON load:', e.message);
    await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${tableName}.geojson', format='newline_delimited')`);
  }

  if (!loadedTables.includes(tableName)) loadedTables.push(tableName);

  // Get row count and column count for display
  const countResult = await conn.query(`SELECT COUNT(*) as n FROM "${tableName}"`);
  const rows = countResult.toArray();
  const rowCount = Number(rows[0].n);
  const colResult = await conn.query(`SELECT * FROM "${tableName}" LIMIT 0`);
  const colCount = colResult.schema.fields.length;

  return { rowCount, colCount };
}

function updateTableInfo(tableName, rowCount, colCount) {
  const el = document.getElementById('table-info');
  if (!el) return;
  if (!tableName) {
    el.innerHTML = `<span style="color:var(--text-dim)">No table loaded.</span>`;
    return;
  }
  el.innerHTML = `Current table: <strong>${tableName}</strong> (${rowCount.toLocaleString()} features, ${colCount} attributes)`;
}

/* ============================================================
   QUERY EXECUTION
   ============================================================ */
async function runQuery() {
  if (!conn) return;

  const rawSql = editorView.state.doc.toString().trim();
  if (!rawSql) return;

  // Apply safety cap — append LIMIT if not present
  const safetyCap = parseInt(document.getElementById('safety-cap-input').value) || 50000;
  const sql = applySafetyCap(rawSql, safetyCap);

  // UI: show loading
  setLoading(true);
  hideError();

  const startTime = performance.now();

  try {
    // Run the query
    let arrowResult = await conn.query(sql);

    // Detect geometry columns (Binary type = WKB from DuckDB spatial)
    const schema = arrowResult.schema;
    const geomCols = schema.fields.filter(f =>
      f.type && (f.type.toString().toLowerCase().includes('binary') || f.typeId === 12 || f.type.typeId === 12)
    );

    let hasGeometry = false;
    let geojsonColName = null;

    if (geomCols.length > 0) {
      hasGeometry = true;
      const colName = geomCols[0].name;
      // Re-run with ST_AsGeoJSON to convert WKB → GeoJSON string
      try {
        const wrappedSql = `
          SELECT * EXCLUDE ("${colName}"), ST_AsGeoJSON("${colName}") AS "${colName}"
          FROM (${sql})
        `;
        arrowResult = await conn.query(wrappedSql);
        geojsonColName = colName;
      } catch (e) {
        console.warn('ST_AsGeoJSON wrapping failed:', e.message);
        hasGeometry = false;
      }
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);
    const rows = arrowResult.toArray();
    const cols = arrowResult.schema.fields.map(f => f.name);
    const rowCount = rows.length;

    // Update output header
    updateOutputHeader(rowCount, elapsed, hasGeometry);

    // Render table
    renderTable(cols, rows, geojsonColName);

    // Update map if geometry present
    if (hasGeometry && geojsonColName) {
      const mappedCount = updateMap(rows, geojsonColName);
      updateOutputHeader(rowCount, elapsed, hasGeometry, mappedCount);
    } else {
      clearMapLayers();
    }

    // Add to history
    addToHistory(rawSql, true, rowCount, elapsed);

  } catch (err) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);
    showError(err.message);
    addToHistory(rawSql, false, 0, elapsed);
    console.error('Query error:', err);
  } finally {
    setLoading(false);
  }
}

function applySafetyCap(sql, cap) {
  // Only add LIMIT if there's no LIMIT clause already (simple heuristic)
  const hasLimit = /\bLIMIT\b/i.test(sql);
  if (hasLimit) return sql;
  return `${sql}\nLIMIT ${cap}`;
}

/* ============================================================
   TABLE RENDERING
   ============================================================ */
function renderTable(cols, rows, geomColName) {
  const wrapper = document.getElementById('table-wrapper');
  const empty = document.getElementById('empty-state');

  if (rows.length === 0) {
    wrapper.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';

  const table = document.createElement('table');
  table.id = 'results-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  cols.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    cols.forEach(col => {
      const td = document.createElement('td');
      const val = row[col];

      if (col === geomColName) {
        td.className = 'cell-geo';
        td.textContent = '[geometry]';
        td.title = typeof val === 'string' ? val.substring(0, 200) : '';
      } else if (typeof val === 'number' || (typeof val === 'bigint')) {
        td.className = 'cell-number';
        td.textContent = typeof val === 'bigint' ? val.toString() :
          Number.isInteger(val) ? val : val.toFixed(4);
      } else if (val === null || val === undefined) {
        td.style.color = 'var(--text-dim)';
        td.textContent = 'null';
      } else {
        td.textContent = String(val);
      }

      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  wrapper.innerHTML = '';
  wrapper.appendChild(table);
}

/* ============================================================
   MAP LAYER MANAGEMENT
   ============================================================ */
function updateMap(rows, geomColName) {
  if (!map || !map.isStyleLoaded()) return 0;

  const features = [];

  rows.forEach((row, i) => {
    const geomVal = row[geomColName];
    if (!geomVal) return;

    try {
      const geojsonStr = typeof geomVal === 'string' ? geomVal : String(geomVal);
      const geometry = JSON.parse(geojsonStr);

      // Build properties (exclude geometry column)
      const properties = { __id: i };
      Object.keys(row).forEach(k => {
        if (k !== geomColName) {
          const v = row[k];
          properties[k] = typeof v === 'bigint' ? v.toString() : v;
        }
      });

      features.push({
        type: 'Feature',
        geometry,
        properties
      });
    } catch (e) {
      // Skip unparseable geometry
    }
  });

  const geojsonFC = { type: 'FeatureCollection', features };

  // Separate features by render type
  const POINT_TYPES = new Set(['Point', 'MultiPoint']);
  const LINE_TYPES = new Set(['LineString', 'MultiLineString']);
  const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);

  // GeometryCollection: flatten into individual features
  const flatFeatures = [];
  features.forEach(f => {
    if (f.geometry.type === 'GeometryCollection') {
      f.geometry.geometries.forEach(g => {
        flatFeatures.push({ type: 'Feature', geometry: g, properties: f.properties });
      });
    } else {
      flatFeatures.push(f);
    }
  });

  const points = {
    type: 'FeatureCollection',
    features: flatFeatures.filter(f => POINT_TYPES.has(f.geometry.type))
  };
  const lines = {
    type: 'FeatureCollection',
    features: flatFeatures.filter(f => LINE_TYPES.has(f.geometry.type))
  };
  const polygons = {
    type: 'FeatureCollection',
    features: flatFeatures.filter(f => POLYGON_TYPES.has(f.geometry.type))
  };

  // Update or create map sources
  if (map.getSource('query-result')) {
    map.getSource('query-result').setData(geojsonFC);
    map.getSource('query-points-src').setData(points);
    map.getSource('query-lines-src').setData(lines);
    map.getSource('query-polygons-src').setData(polygons);
  } else {
    map.addSource('query-result', { type: 'geojson', data: geojsonFC });
    map.addSource('query-points-src', { type: 'geojson', data: points });
    map.addSource('query-lines-src', { type: 'geojson', data: lines });
    map.addSource('query-polygons-src', { type: 'geojson', data: polygons });

    // Polygon fill
    map.addLayer({
      id: 'query-polygons',
      type: 'fill',
      source: 'query-polygons-src',
      paint: {
        'fill-color': '#f0a500',
        'fill-opacity': 0.18
      }
    });

    // Polygon outline
    map.addLayer({
      id: 'query-polygon-outline',
      type: 'line',
      source: 'query-polygons-src',
      paint: {
        'line-color': '#f0a500',
        'line-width': 1.5,
        'line-opacity': 0.85
      }
    });

    // Lines
    map.addLayer({
      id: 'query-lines',
      type: 'line',
      source: 'query-lines-src',
      paint: {
        'line-color': '#3ddc84',
        'line-width': 2,
        'line-opacity': 0.9
      }
    });

    // Points
    map.addLayer({
      id: 'query-points',
      type: 'circle',
      source: 'query-points-src',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          8, 4,
          14, 8
        ],
        'circle-color': '#e8323c',
        'circle-stroke-width': 1.2,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.85
      }
    });
  }

  // Fit map bounds to features
  if (features.length > 0) {
    fitMapToFeatures(geojsonFC);
  }

  return features.length;
}

function fitMapToFeatures(geojson) {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  // Iterative coordinate walker — avoids call stack overflow on large multipolygons
  function walkCoords(coords) {
    const stack = [coords];
    while (stack.length > 0) {
      const item = stack.pop();
      if (!Array.isArray(item)) continue;
      if (typeof item[0] === 'number') {
        // This is a [lng, lat] position
        if (item[0] < minLng) minLng = item[0];
        if (item[0] > maxLng) maxLng = item[0];
        if (item[1] < minLat) minLat = item[1];
        if (item[1] > maxLat) maxLat = item[1];
      } else {
        for (let i = 0; i < item.length; i++) stack.push(item[i]);
      }
    }
  }

  geojson.features.forEach(f => {
    if (f.geometry && f.geometry.coordinates) {
      walkCoords(f.geometry.coordinates);
    }
  });

  if (!isFinite(minLng)) return;

  const bounds = [[minLng, minLat], [maxLng, maxLat]];

  const camera = map.cameraForBounds(bounds, {
    padding: { top: 60, bottom: 60, left: 60, right: 60 },
    maxZoom: 14
  });
  if (camera) {
    map.flyTo({ ...camera, duration: 1200, essential: true });
  }
}

function clearMapLayers() {
  if (!map) return;
  ['query-points', 'query-lines', 'query-polygons', 'query-polygon-outline'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  ['query-result', 'query-points-src', 'query-lines-src', 'query-polygons-src'].forEach(id => {
    if (map.getSource(id)) map.removeSource(id);
  });
}

/* ============================================================
   QUERY HISTORY
   ============================================================ */
function addToHistory(sql, success, rowCount, elapsed) {
  const entry = {
    sql,
    success,
    rowCount,
    elapsed,
    timestamp: new Date()
  };
  queryHistory.unshift(entry);
  if (queryHistory.length > 20) queryHistory.pop();
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('query-history');
  const label = container.querySelector('.section-label');
  // Remove old items, keep label
  Array.from(container.children).forEach(c => {
    if (!c.classList.contains('section-label')) c.remove();
  });

  queryHistory.forEach((entry, i) => {
    const item = document.createElement('div');
    item.className = `history-item ${entry.success ? 'success' : 'error'}`;

    const timeStr = entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const preview = entry.sql.replace(/\s+/g, ' ').substring(0, 60);

    item.innerHTML = `
      <div class="history-status">
        <div class="history-dot ${entry.success ? 'success' : 'error'}"></div>
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-secondary)">
          ${entry.success ? `${entry.rowCount} rows · ${entry.elapsed}s` : 'ERROR'}
        </span>
        <span class="history-timestamp">${timeStr}</span>
      </div>
      <div class="history-preview">${preview}${entry.sql.length > 60 ? '…' : ''}</div>
    `;

    // Click to restore query
    item.addEventListener('click', () => {
      const transaction = editorView.state.update({
        changes: { from: 0, to: editorView.state.doc.length, insert: entry.sql }
      });
      editorView.dispatch(transaction);
    });

    container.appendChild(item);
  });
}

/* ============================================================
   UI HELPERS
   ============================================================ */
function setLoading(on) {
  const btn = document.getElementById('run-btn');
  const spinner = document.getElementById('query-loading');
  if (btn) btn.disabled = on;
  if (spinner) spinner.classList.toggle('visible', on);
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (el) {
    el.textContent = '⚠ ' + msg;
    el.classList.add('visible');
  }
}

function hideError() {
  const el = document.getElementById('error-banner');
  if (el) el.classList.remove('visible');
}

function updateOutputHeader(rowCount, elapsed, hasGeo, mappedCount) {
  const title = document.getElementById('output-title');
  const meta = document.getElementById('output-meta');
  if (title) title.textContent = 'Query Output';
  if (meta) {
    meta.textContent = `${rowCount.toLocaleString()} rows`;
    if (mappedCount !== undefined && hasGeo) {
      meta.textContent += `, ${mappedCount.toLocaleString()} mapped in ${elapsed}s`;
    } else {
      meta.textContent += ` in ${elapsed}s`;
    }
    meta.className = hasGeo ? 'has-geo' : '';
  }
}

/* ============================================================
   FILE UPLOAD
   ============================================================ */
function setupFileUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

async function handleFile(file) {
  if (!file.name.endsWith('.geojson') && !file.name.endsWith('.json')) {
    showError('Please upload a .geojson or .json file.');
    return;
  }

  const tableName = file.name.replace(/\.(geo)?json$/i, '').replace(/[^a-zA-Z0-9_]/g, '_');

  try {
    const text = await file.text();
    // Validate it's valid JSON
    JSON.parse(text);

    const stats = await registerGeoJSON(text, tableName);
    updateTableInfo(tableName, stats.rowCount, stats.colCount);

    const newQuery = `SELECT * FROM "${tableName}" LIMIT 100`;
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: newQuery }
    });
    runQuery();
  } catch (err) {
    showError(`Failed to load file: ${err.message}`);
  }
}

/* ============================================================
   DEMO DATA BUTTON
   ============================================================ */
function setupDemoButton() {
  document.getElementById('btn-demo').addEventListener('click', async () => {
    await loadDemoData();
  });
}

/* ============================================================
   RUN BUTTON
   ============================================================ */
function setupRunButton() {
  document.getElementById('run-btn').addEventListener('click', runQuery);
}

/* ============================================================
   POPUP STYLES (injected into head)
   ============================================================ */
function injectPopupStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .geo-popup .maplibregl-popup-content {
      background: #161d26;
      border: 1px solid #2a3f57;
      border-radius: 6px;
      padding: 0;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      min-width: 180px;
      max-width: 280px;
    }
    .geo-popup .maplibregl-popup-tip { border-top-color: #161d26; }
    .popup-content { padding: 10px 12px; }
    .popup-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 3px 0;
      border-bottom: 1px solid #1f2d3d;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
    }
    .popup-row:last-child { border-bottom: none; }
    .popup-key { color: #6b8099; }
    .popup-val { color: #c9d4e0; font-weight: 500; text-align: right; word-break: break-all; }
  `;
  document.head.appendChild(style);
}

/* ============================================================
   ENTRY POINT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  injectPopupStyles();
  setupFileUpload();
  setupDemoButton();
  setupRunButton();
  init();
});
