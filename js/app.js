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

// Table state
let currentRows = [];
let currentCols = [];
let currentGeomCol = null;
let selectedIds = new Set();
let filterValues = {};
let sortState = { col: null, dir: null };

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

  // Click handlers — select feature and show popup
  ['query-points', 'query-polygons', 'query-lines'].forEach(layerId => {
    map.on('click', layerId, (e) => {
      if (!e.features || !e.features.length) return;
      const props = e.features[0].properties;
      const id = props.__id;

      // Two-way selection
      selectFeatureFromMap(id);

      // Popup
      const html = Object.entries(props)
        .filter(([k]) => k !== '__id')
        .map(([k, v]) => `<div class="popup-row"><span class="popup-key">${k}</span><span class="popup-val">${v}</span></div>`)
        .join('');

      const coords = e.features[0].geometry.type === 'Point'
        ? e.features[0].geometry.coordinates.slice()
        : [e.lngLat.lng, e.lngLat.lat];

      new maplibregl.Popup({ offset: 10, className: 'geo-popup' })
        .setLngLat(coords)
        .setHTML(`<div class="popup-content">${html}</div>`)
        .addTo(map);
    });

    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
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

    // Convert Arrow proxy rows → plain objects with __id stamped in
    const rawRows = arrowResult.toArray();
    const cols = arrowResult.schema.fields.map(f => f.name);
    const rows = rawRows.map((row, i) => {
      const plain = { __id: i };
      cols.forEach(c => { plain[c] = row[c]; });
      return plain;
    });
    const rowCount = rows.length;
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);

    // Store into module state and reset interactive state
    currentRows = rows;
    currentCols = cols;
    currentGeomCol = geojsonColName;
    selectedIds = new Set();
    filterValues = {};
    sortState = { col: null, dir: null };

    // Update output header
    updateOutputHeader(rowCount, elapsed, hasGeometry);

    // Render table
    renderTable();

    // Update map if geometry present
    if (hasGeometry && geojsonColName) {
      const mappedCount = updateMap();
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
   TABLE — FILTER + SORT HELPERS
   ============================================================ */
function getFilteredSortedRows() {
  let rows = currentRows;

  // Apply per-column filters
  const active = Object.entries(filterValues).filter(([, v]) => v.trim() !== '');
  if (active.length > 0) {
    rows = rows.filter(row =>
      active.every(([col, val]) => {
        const cell = row[col];
        if (cell === null || cell === undefined) return false;
        return String(cell).toLowerCase().includes(val.toLowerCase());
      })
    );
  }

  // Apply sort
  if (sortState.col && sortState.dir) {
    const col = sortState.col;
    const dir = sortState.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if ((typeof av === 'number' || typeof av === 'bigint') &&
        (typeof bv === 'number' || typeof bv === 'bigint')) {
        return (Number(av) - Number(bv)) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  return rows;
}

/* ============================================================
   TABLE RENDERING
   ============================================================ */
function renderTable() {
  const wrapper = document.getElementById('table-wrapper');
  const empty = document.getElementById('empty-state');

  if (currentRows.length === 0) {
    wrapper.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Columns to display (skip geometry)
  const displayCols = currentCols.filter(c => c !== currentGeomCol);

  const table = document.createElement('table');
  table.id = 'results-table';

  /* ── THEAD ── */
  const thead = document.createElement('thead');

  // Row 1: checkbox + sortable column headers
  const headerRow = document.createElement('tr');

  // Checkbox header — select all
  const thCheck = document.createElement('th');
  thCheck.className = 'col-check';
  const selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAll.title = 'Select all visible rows';
  selectAll.addEventListener('change', () => {
    const visible = getFilteredSortedRows();
    if (selectAll.checked) {
      visible.forEach(r => selectedIds.add(r.__id));
    } else {
      visible.forEach(r => selectedIds.delete(r.__id));
    }
    syncSelection();
  });
  thCheck.appendChild(selectAll);
  headerRow.appendChild(thCheck);

  displayCols.forEach(col => {
    const th = document.createElement('th');
    th.className = 'col-sortable';

    const label = document.createElement('span');
    label.className = 'col-label';
    label.textContent = col;

    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    indicator.textContent =
      sortState.col === col ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';

    th.appendChild(label);
    th.appendChild(indicator);

    th.addEventListener('click', () => {
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc'
          : sortState.dir === 'desc' ? null : 'asc';
        if (sortState.dir === null) sortState.col = null;
      } else {
        sortState.col = col;
        sortState.dir = 'asc';
      }
      renderTableBody(table.querySelector('tbody'), displayCols);
      // Update sort indicators without full re-render
      table.querySelectorAll('.sort-indicator').forEach(el => el.textContent = '');
      if (sortState.col) {
        const idx = displayCols.indexOf(sortState.col);
        const indicators = table.querySelectorAll('.sort-indicator');
        // +1 offset for checkbox column
        const target = table.querySelectorAll('thead tr:first-child th.col-sortable')[idx];
        if (target) target.querySelector('.sort-indicator').textContent =
          sortState.dir === 'asc' ? ' ▲' : ' ▼';
      }
    });

    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Row 2: filter inputs
  const filterRow = document.createElement('tr');
  filterRow.className = 'filter-row';

  // Empty cell for checkbox column
  const tdFilterCheck = document.createElement('th');
  tdFilterCheck.className = 'col-check';
  filterRow.appendChild(tdFilterCheck);

  displayCols.forEach(col => {
    const th = document.createElement('th');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'filter-input';
    input.placeholder = 'filter…';
    input.value = filterValues[col] || '';
    input.addEventListener('input', () => {
      filterValues[col] = input.value;
      renderTableBody(table.querySelector('tbody'), displayCols);
    });
    th.appendChild(input);
    filterRow.appendChild(th);
  });
  thead.appendChild(filterRow);
  table.appendChild(thead);

  // TBODY
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  renderTableBody(tbody, displayCols);

  wrapper.innerHTML = '';
  wrapper.appendChild(table);
}

function renderTableBody(tbody, displayCols) {
  tbody.innerHTML = '';
  const rows = getFilteredSortedRows();

  rows.forEach((row, visIdx) => {
    const rid = row.__id;
    const tr = document.createElement('tr');
    tr.dataset.rid = rid;
    if (selectedIds.has(rid)) tr.classList.add('row-selected');

    // Checkbox cell
    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.has(rid);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(rid);
      else selectedIds.delete(rid);
      tr.classList.toggle('row-selected', cb.checked);
      syncSelection();
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    displayCols.forEach(col => {
      const td = document.createElement('td');
      const val = row[col];

      if (typeof val === 'number' || typeof val === 'bigint') {
        td.className = 'cell-number';
        td.textContent = typeof val === 'bigint' ? val.toString()
          : Number.isInteger(val) ? val : val.toFixed(4);
      } else if (val === null || val === undefined) {
        td.style.color = 'var(--text-dim)';
        td.textContent = 'null';
      } else {
        td.textContent = String(val);
      }

      tr.appendChild(td);
    });

    // Click row (not checkbox) to select too
    tr.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      const isSelected = selectedIds.has(rid);
      if (isSelected) { selectedIds.delete(rid); cb.checked = false; tr.classList.remove('row-selected'); }
      else { selectedIds.add(rid); cb.checked = true; tr.classList.add('row-selected'); }
      syncSelection();
    });

    tbody.appendChild(tr);
  });
}

/* ============================================================
   MAP LAYER MANAGEMENT
   ============================================================ */
function updateMap() {
  if (!map || !map.isStyleLoaded()) return 0;

  const features = [];

  currentRows.forEach((row, i) => {
    const geomVal = row[currentGeomCol];
    if (!geomVal) return;

    try {
      const geometry = JSON.parse(typeof geomVal === 'string' ? geomVal : String(geomVal));
      const properties = { __id: i };
      Object.keys(row).forEach(k => {
        if (k !== currentGeomCol) {
          const v = row[k];
          properties[k] = typeof v === 'bigint' ? v.toString() : v;
        }
      });
      features.push({ type: 'Feature', geometry, properties });
    } catch (e) { /* skip unparseable */ }
  });

  const geojsonFC = { type: 'FeatureCollection', features };

  const POINT_TYPES = new Set(['Point', 'MultiPoint']);
  const LINE_TYPES = new Set(['LineString', 'MultiLineString']);
  const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);

  // Flatten GeometryCollections
  const flatFeatures = [];
  features.forEach(f => {
    if (f.geometry.type === 'GeometryCollection') {
      f.geometry.geometries.forEach(g =>
        flatFeatures.push({ type: 'Feature', geometry: g, properties: f.properties })
      );
    } else {
      flatFeatures.push(f);
    }
  });

  const points = { type: 'FeatureCollection', features: flatFeatures.filter(f => POINT_TYPES.has(f.geometry.type)) };
  const lines = { type: 'FeatureCollection', features: flatFeatures.filter(f => LINE_TYPES.has(f.geometry.type)) };
  const polygons = { type: 'FeatureCollection', features: flatFeatures.filter(f => POLYGON_TYPES.has(f.geometry.type)) };
  const empty = { type: 'FeatureCollection', features: [] };

  if (map.getSource('query-result')) {
    map.getSource('query-result').setData(geojsonFC);
    map.getSource('query-points-src').setData(points);
    map.getSource('query-lines-src').setData(lines);
    map.getSource('query-polygons-src').setData(polygons);
    map.getSource('selected-src').setData(empty);
  } else {
    map.addSource('query-result', { type: 'geojson', data: geojsonFC });
    map.addSource('query-points-src', { type: 'geojson', data: points });
    map.addSource('query-lines-src', { type: 'geojson', data: lines });
    map.addSource('query-polygons-src', { type: 'geojson', data: polygons });
    map.addSource('selected-src', { type: 'geojson', data: empty });

    // ── Base layers ─────────────────────────────────────────
    map.addLayer({
      id: 'query-polygons', type: 'fill', source: 'query-polygons-src',
      paint: { 'fill-color': '#f0a500', 'fill-opacity': 0.18 }
    });

    map.addLayer({
      id: 'query-polygon-outline', type: 'line', source: 'query-polygons-src',
      paint: { 'line-color': '#f0a500', 'line-width': 1.5, 'line-opacity': 0.85 }
    });

    map.addLayer({
      id: 'query-lines', type: 'line', source: 'query-lines-src',
      paint: { 'line-color': '#3ddc84', 'line-width': 2, 'line-opacity': 0.9 }
    });

    map.addLayer({
      id: 'query-points', type: 'circle', source: 'query-points-src',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8],
        'circle-color': '#e8323c', 'circle-stroke-width': 1.2,
        'circle-stroke-color': '#fff', 'circle-opacity': 0.85
      }
    });

    // ── Highlight layers (render on top) ─────────────────────
    map.addLayer({
      id: 'selected-polygons', type: 'fill', source: 'selected-src',
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: { 'fill-color': '#f0e500', 'fill-opacity': 0.55 }
    });

    map.addLayer({
      id: 'selected-polygon-outline', type: 'line', source: 'selected-src',
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: { 'line-color': '#ffe000', 'line-width': 2.5 }
    });

    map.addLayer({
      id: 'selected-lines', type: 'line', source: 'selected-src',
      filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
      paint: { 'line-color': '#ffe000', 'line-width': 3.5 }
    });

    map.addLayer({
      id: 'selected-points', type: 'circle', source: 'selected-src',
      filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 11],
        'circle-color': '#ffe000', 'circle-stroke-width': 2,
        'circle-stroke-color': '#000', 'circle-opacity': 1
      }
    });
  }

  if (features.length > 0) fitMapToFeatures(geojsonFC);
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

/* ============================================================
   SELECTION SYNC (map ↔ table)
   ============================================================ */
function syncSelection() {
  // Update map highlight source
  if (map && map.getSource('selected-src')) {
    const selectedFeatures = currentRows
      .filter(r => selectedIds.has(r.__id))
      .map(r => {
        const geomVal = r[currentGeomCol];
        if (!geomVal) return null;
        try {
          return {
            type: 'Feature',
            geometry: JSON.parse(typeof geomVal === 'string' ? geomVal : String(geomVal)),
            properties: { __id: r.__id }
          };
        } catch { return null; }
      })
      .filter(Boolean);

    map.getSource('selected-src').setData({
      type: 'FeatureCollection',
      features: selectedFeatures
    });
  }

  // Sync table row classes and checkboxes
  const tbody = document.querySelector('#results-table tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach(tr => {
    const rid = Number(tr.dataset.rid);
    const selected = selectedIds.has(rid);
    tr.classList.toggle('row-selected', selected);
    const cb = tr.querySelector('input[type=checkbox]');
    if (cb) cb.checked = selected;
  });
}

function selectFeatureFromMap(id) {
  // Toggle selection
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);

  syncSelection();

  // Scroll table row into view
  const tr = document.querySelector(`#results-table tbody tr[data-rid="${id}"]`);
  if (tr) {
    tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function clearMapLayers() {
  if (!map) return;
  ['selected-points', 'selected-lines', 'selected-polygons', 'selected-polygon-outline',
    'query-points', 'query-lines', 'query-polygons', 'query-polygon-outline'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
  ['selected-src', 'query-result', 'query-points-src', 'query-lines-src', 'query-polygons-src'].forEach(id => {
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
