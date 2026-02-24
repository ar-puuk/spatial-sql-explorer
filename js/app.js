/* ============================================================
   SPATIAL SQL EXPLORER — app.js
   DuckDB-WASM + MapLibre GL JS + CodeMirror 6
   All processing is client-side. GitHub Pages compatible.
   ============================================================

   Features:
   - Multi-format file loading: GeoJSON, CSV, TSV, Parquet
   - IndexedDB session persistence (tables + history + last query)
   - SQL autocomplete aware of loaded table schemas
   - Result export: CSV + GeoJSON
   - Attribute-driven map styling (choropleth + categorical)
   ============================================================ */

// ── ES Module imports from CDN ──────────────────────────────
import { basicSetup } from 'https://esm.sh/codemirror@6.0.1';
import { EditorView, keymap } from 'https://esm.sh/@codemirror/view@6.36.3';
import { sql as cmSql, StandardSQL } from 'https://esm.sh/@codemirror/lang-sql@6.8.0';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2';
import { syntaxHighlighting, defaultHighlightStyle } from 'https://esm.sh/@codemirror/language@6.10.8';
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

/* ============================================================
   STATE
   ============================================================ */
let db = null;
let conn = null;
let editorView = null;
let map = null;
let idb = null;

// Table registry: [{ name, rowCount, colCount, columns: [] }]
let loadedTablesMeta = [];
let queryHistory = [];

// Current result set
let currentRows = [];
let currentCols = [];
let currentGeomCol = null;

// Table interaction state
let selectedIds = new Set();
let filterValues = {};
let sortState = { col: null, dir: null };

// Basemap state
let currentBasemap = 'light';

// Theme state ('dark' | 'light')
let currentTheme = 'dark';

// Last rendered map data — needed to re-add layers after basemap switch
let lastMapData = null; // { points, lines, polygons, geojsonFC }

// Whether a style has been applied (so we can re-apply after basemap switch)
let styleApplied = false;

/* ============================================================
   BASEMAP DEFINITIONS
   ============================================================ */
const BASEMAPS = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  satellite: {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri © DigitalGlobe © GeoEye'
      }
    },
    layers: [{ id: 'esri-satellite', type: 'raster', source: 'esri', minzoom: 0, maxzoom: 19 }]
  },
  topo: {
    version: 8,
    sources: {
      otm: {
        type: 'raster',
        tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenTopoMap © OpenStreetMap contributors'
      }
    },
    layers: [{ id: 'otm-topo', type: 'raster', source: 'otm', minzoom: 0, maxzoom: 17 }]
  }
};

/* ============================================================
   INDEXEDDB — Persistence layer
   ============================================================ */
async function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('SpatialSQLExplorer', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tables'))
        d.createObjectStore('tables', { keyPath: 'name' });
      if (!d.objectStoreNames.contains('state'))
        d.createObjectStore('state', { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbPut(store, value) {
  if (!idb) return;
  return new Promise((res, rej) => {
    const tx = idb.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(value);
    r.onsuccess = () => res();
    r.onerror = e => rej(e.target.error);
  });
}

async function idbGet(store, key) {
  if (!idb) return null;
  return new Promise((res, rej) => {
    const tx = idb.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}

async function idbGetAll(store) {
  if (!idb) return [];
  return new Promise((res, rej) => {
    const tx = idb.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}

async function idbDelete(store, key) {
  if (!idb) return;
  return new Promise((res, rej) => {
    const tx = idb.transaction(store, 'readwrite');
    const r = tx.objectStore(store).delete(key);
    r.onsuccess = () => res();
    r.onerror = e => rej(e.target.error);
  });
}

/* ============================================================
   INITIALIZATION
   ============================================================ */
async function init() {
  updateInitLog('Opening session store…');
  try { idb = await openIDB(); } catch (e) { console.warn('IDB unavailable:', e); }

  updateInitLog('Initializing DuckDB-WASM…');
  try {
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    conn = await db.connect();
    updateInitLog('DuckDB ready. Loading spatial extension…');

    try {
      await conn.query(`INSTALL spatial; LOAD spatial;`);
      updateInitLog('Spatial extension loaded.');
    } catch (e) {
      console.warn('Spatial extension warning:', e.message);
      updateInitLog('Spatial extension unavailable — geometry queries limited.');
    }

    updateInitLog('Initializing map…');
    initMap();

    updateInitLog('Initializing editor…');
    initEditor();
    setupBasemapSwitcher();

    // Read URL state early (applies styleSettings), get SQL if present
    const urlSql = peekURLSql();

    // Restore session tables first — tables must exist before any query runs
    const { restored, lastSql } = await restoreSession();
    if (!restored) {
      updateInitLog('Loading demo data…');
      await loadDemoData();
    }

    // Decide which SQL to run: URL > lastSql > first table > demo default
    const sqlToRun = urlSql || lastSql
      || (loadedTablesMeta.length ? `SELECT * FROM "${loadedTablesMeta[0].name}" LIMIT 50` : null);

    if (sqlToRun) {
      editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: sqlToRun } });
      await runQuery();
    }

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
   SESSION RESTORE
   ============================================================ */
async function restoreSession() {
  if (!idb) return { restored: false, lastSql: null };
  const tables = await idbGetAll('tables');
  if (!tables?.length) return { restored: false, lastSql: null };

  updateInitLog(`Restoring ${tables.length} table(s) from last session…`);

  for (const t of tables) {
    try {
      if (t.format === 'parquet') await registerParquet(t.data, t.name, false);
      else if (t.format === 'csv' || t.format === 'tsv') await registerCSV(t.data, t.name, t.format, false);
      else await registerGeoJSON(t.data, t.name, false);
    } catch (e) { console.warn(`Failed to restore "${t.name}":`, e); }
  }

  const histRec = await idbGet('state', 'history');
  if (histRec?.value) {
    queryHistory = histRec.value.map(h => ({ ...h, timestamp: new Date(h.timestamp) }));
    renderHistory();
  }

  const lastRec = await idbGet('state', 'lastQuery');
  return { restored: true, lastSql: lastRec?.value || null };
}

/* ============================================================
   MAP INITIALIZATION
   ============================================================ */
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: BASEMAPS.light,
    center: [0, 20], zoom: 1.5,
    attributionControl: false,
    preserveDrawingBuffer: true   // required for PNG export
  });

  map.on('style.load', () => map.setProjection({ type: 'globe' }));

  const geocoderApi = {
    forwardGeocode: async (config) => {
      const features = [];
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${config.query}&format=geojson&polygon_geojson=1&addressdetails=1`);
        const data = await res.json();
        for (const f of data.features) {
          const center = [f.bbox[0] + (f.bbox[2] - f.bbox[0]) / 2, f.bbox[1] + (f.bbox[3] - f.bbox[1]) / 2];
          features.push({
            type: 'Feature', geometry: { type: 'Point', coordinates: center },
            place_name: f.properties.display_name, properties: f.properties,
            text: f.properties.display_name, place_type: ['place'], center
          });
        }
      } catch (e) { console.error('Geocoder error:', e); }
      return { features };
    }
  };

  map.addControl(new MaplibreGeocoder(geocoderApi, { maplibregl }), 'top-right');
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.GlobeControl(), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  map.on('mousemove', e => {
    const el = document.getElementById('map-coords');
    if (el) el.textContent = `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`;
  });

  ['query-points', 'query-polygons', 'query-lines'].forEach(layerId => {
    map.on('click', layerId, e => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      selectFeatureFromMap(props.__id);
      const html = Object.entries(props)
        .filter(([k]) => k !== '__id')
        .map(([k, v]) => `<div class="popup-row"><span class="popup-key">${k}</span><span class="popup-val">${v}</span></div>`)
        .join('');
      const coords = e.features[0].geometry.type === 'Point'
        ? e.features[0].geometry.coordinates.slice()
        : [e.lngLat.lng, e.lngLat.lat];
      new maplibregl.Popup({ offset: 10, className: 'geo-popup' })
        .setLngLat(coords).setHTML(`<div class="popup-content">${html}</div>`).addTo(map);
    });
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  });
}

/* ============================================================
   EDITOR INITIALIZATION (CodeMirror 6)
   ============================================================ */
function buildEditorExtensions(schema = {}) {
  const exts = [
    basicSetup,
    cmSql({ dialect: StandardSQL, schema }),
    keymap.of([{ key: 'Ctrl-Enter', mac: 'Cmd-Enter', run: () => { runQuery(); return true; } }]),
    EditorView.theme({
      '&': { height: '100%', background: currentTheme === 'dark' ? '#0f1419' : '#ffffff' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { caretColor: currentTheme === 'dark' ? '#c9d4e0' : '#1a2535' },
    })
  ];
  if (currentTheme === 'dark') {
    exts.push(oneDark);
  } else {
    // Explicit light-mode highlight style — must come AFTER basicSetup
    // to override its fallback and ensure token colours are applied
    exts.push(syntaxHighlighting(defaultHighlightStyle));
  }
  return exts;
}

function initEditor() {
  editorView = new EditorView({
    doc: `SELECT * FROM demo LIMIT 50`,
    extensions: buildEditorExtensions(),
    parent: document.getElementById('editor-wrapper')
  });
}

function updateEditorSchema() {
  if (!editorView) return;
  // Preserve current text, then rebuild editor with new schema
  const currentDoc = editorView.state.doc.toString();
  const schema = {};
  loadedTablesMeta.forEach(t => { schema[t.name] = t.columns; });

  editorView.destroy();
  editorView = new EditorView({
    doc: currentDoc,
    extensions: buildEditorExtensions(schema),
    parent: document.getElementById('editor-wrapper')
  });
}

/* ============================================================
   DATA LOADING — DEMO
   ============================================================ */
async function loadDemoData() {
  try {
    const res = await fetch('./data/demo.geojson');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await registerGeoJSON(text, 'demo', true);
    setEditorAndRun('demo');
  } catch (err) {
    console.error('Failed to load demo data:', err);
  }
}

function setEditorAndRun(tableName) {
  const q = `SELECT * FROM "${tableName}" LIMIT 50`;
  editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: q } });
  runQuery();
}

/* ============================================================
   DATA REGISTRATION — GeoJSON
   ============================================================ */
async function registerGeoJSON(text, tableName, persist = true) {
  await db.registerFileText(`${tableName}.geojson`, text);
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
  try {
    await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM ST_Read('${tableName}.geojson')`);
  } catch (e) {
    console.warn('ST_Read fallback:', e.message);
    await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${tableName}.geojson')`);
  }
  await finaliseRegistration(tableName);
  if (persist) await idbPut('tables', { name: tableName, data: text, format: 'geojson' });
}

/* ============================================================
   DATA REGISTRATION — CSV / TSV
   ============================================================ */
async function registerCSV(text, tableName, ext = 'csv', persist = true) {
  const fname = `${tableName}.${ext}`;
  await db.registerFileText(fname, text);
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
  const sep = ext === 'tsv' ? `sep='\\t', ` : '';
  await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${fname}', ${sep}header=true)`);
  await finaliseRegistration(tableName);
  if (persist) await idbPut('tables', { name: tableName, data: text, format: ext });
}

/* ============================================================
   DATA REGISTRATION — Parquet
   ============================================================ */
async function registerParquet(buffer, tableName, persist = true) {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  await db.registerFileBuffer(`${tableName}.parquet`, uint8);
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
  await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_parquet('${tableName}.parquet')`);
  await finaliseRegistration(tableName);
  if (persist) await idbPut('tables', { name: tableName, data: uint8, format: 'parquet' });
}

/* ============================================================
   REGISTRATION — Shared finalisation
   ============================================================ */
async function finaliseRegistration(tableName) {
  const countRes = await conn.query(`SELECT COUNT(*) AS n FROM "${tableName}"`);
  const rowCount = Number(countRes.toArray()[0].n);
  const schemaRes = await conn.query(`SELECT * FROM "${tableName}" LIMIT 0`);
  const columns = schemaRes.schema.fields.map(f => f.name);
  const meta = { name: tableName, rowCount, colCount: columns.length, columns };
  const idx = loadedTablesMeta.findIndex(t => t.name === tableName);
  if (idx >= 0) loadedTablesMeta[idx] = meta; else loadedTablesMeta.push(meta);
  renderTableRegistry();
  updateEditorSchema();
}

/* ============================================================
   TABLE REGISTRY UI
   ============================================================ */
function renderTableRegistry() {
  const el = document.getElementById('table-registry');
  if (!el) return;
  el.innerHTML = '';

  if (!loadedTablesMeta.length) {
    el.innerHTML = `<div class="registry-empty">No tables loaded.</div>`;
    return;
  }

  loadedTablesMeta.forEach(t => {
    const row = document.createElement('div');
    row.className = 'registry-row';
    row.innerHTML = `
      <div class="registry-info">
        <span class="registry-name">${t.name}</span>
        <span class="registry-meta">${t.rowCount.toLocaleString()} rows · ${t.colCount} cols</span>
      </div>
      <div class="registry-actions">
        <button class="reg-btn reg-query" title="Query this table">▶</button>
        <button class="reg-btn reg-delete" title="Remove table">✕</button>
      </div>`;
    row.querySelector('.reg-query').addEventListener('click', () => setEditorAndRun(t.name));
    row.querySelector('.reg-delete').addEventListener('click', async () => {
      try {
        await conn.query(`DROP TABLE IF EXISTS "${t.name}"`);
        loadedTablesMeta = loadedTablesMeta.filter(m => m.name !== t.name);
        await idbDelete('tables', t.name);
        renderTableRegistry();
        updateEditorSchema();
      } catch (e) { showError(`Could not remove table: ${e.message}`); }
    });
    el.appendChild(row);
  });
}

/* ============================================================
   FILE UPLOAD — multi-format router
   ============================================================ */
function setupFileUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    Array.from(e.target.files).forEach(handleFile);
    fileInput.value = '';
  });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    Array.from(e.dataTransfer.files).forEach(handleFile);
  });
}

async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const supported = ['geojson', 'json', 'csv', 'tsv', 'parquet'];
  if (!supported.includes(ext)) {
    showError(`Unsupported: .${ext}  —  Supported: ${supported.join(', ')}`);
    return;
  }
  const tableName = file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1');

  try {
    updateInitLog(`Loading ${file.name}…`);
    if (ext === 'parquet') {
      await registerParquet(await file.arrayBuffer(), tableName);
    } else if (ext === 'csv' || ext === 'tsv') {
      await registerCSV(await file.text(), tableName, ext);
    } else {
      const text = await file.text();
      JSON.parse(text);
      await registerGeoJSON(text, tableName);
    }
    setEditorAndRun(tableName);
    updateInitLog('Ready.');
  } catch (err) {
    showError(`Failed to load ${file.name}: ${err.message}`);
    updateInitLog('Ready.');
  }
}

/* ============================================================
   QUERY EXECUTION
   ============================================================ */
async function runQuery() {
  if (!conn) return;
  const rawSql = editorView.state.doc.toString().trim();
  if (!rawSql) return;

  const cap = parseInt(document.getElementById('safety-cap-input').value) || 50000;
  const cappedSql = /\bLIMIT\b/i.test(rawSql) ? rawSql : `${rawSql}\nLIMIT ${cap}`;

  setLoading(true);
  hideError();
  const t0 = performance.now();

  try {
    let result = await conn.query(cappedSql);

    // Detect geometry (WKB binary) columns
    const geomCols = result.schema.fields.filter(f =>
      f.type && (f.type.toString().toLowerCase().includes('binary') || f.typeId === 12 || f.type.typeId === 12)
    );

    let hasGeometry = false;
    let geojsonColName = null;

    if (geomCols.length > 0) {
      hasGeometry = true;
      const col = geomCols[0].name;
      try {
        result = await conn.query(`SELECT * EXCLUDE ("${col}"), ST_AsGeoJSON("${col}") AS "${col}" FROM (${cappedSql})`);
        geojsonColName = col;
      } catch (e) { console.warn('ST_AsGeoJSON failed:', e.message); hasGeometry = false; }
    }

    // Materialise Arrow rows → plain JS objects (Arrow rows are frozen proxies)
    const rawRows = result.toArray();
    const cols = result.schema.fields.map(f => f.name);
    const rows = rawRows.map((row, i) => {
      const o = { __id: i };
      cols.forEach(c => { o[c] = row[c]; });
      return o;
    });

    const elapsed = ((performance.now() - t0) / 1000).toFixed(3);
    const rowCount = rows.length;

    currentRows = rows;
    currentCols = cols;
    currentGeomCol = geojsonColName;
    selectedIds = new Set();
    filterValues = {};
    sortState = { col: null, dir: null };
    styleSettings = { ...DEFAULT_STYLE };
    styleApplied = false;
    hiddenCategories = new Set();
    legendFilterRange = null;
    legendAllValues = [];
    legendBreaks = [];
    const ml = document.getElementById('map-legend');
    if (ml) ml.style.display = 'none';

    updateOutputHeader(rowCount, elapsed, hasGeometry);
    renderTable();
    updateStylePanel(hasGeometry);

    if (hasGeometry && geojsonColName) {
      const mapped = updateMap();
      updateOutputHeader(rowCount, elapsed, hasGeometry, mapped);
    } else {
      clearMapLayers();
    }

    addToHistory(rawSql, true, rowCount, elapsed);
    await idbPut('state', { key: 'lastQuery', value: rawSql });
    updateURL();

  } catch (err) {
    showError(err.message);
    addToHistory(rawSql, false, 0, ((performance.now() - t0) / 1000).toFixed(3));
    console.error('Query error:', err);
  } finally {
    setLoading(false);
  }
}

/* ============================================================
   EXPORT — CSV
   ============================================================ */
function exportCSV() {
  if (!currentRows.length) return;
  const cols = currentCols.filter(c => c !== currentGeomCol && c !== '__id');
  const rows = getFilteredSortedRows();
  const esc = v => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.map(esc).join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  downloadBlob(csv, 'query_result.csv', 'text/csv');
}

/* ============================================================
   EXPORT — GeoJSON
   ============================================================ */
function exportGeoJSON() {
  const rows = getFilteredSortedRows();
  if (!currentGeomCol) {
    const data = rows.map(r => {
      const o = {};
      currentCols.filter(c => c !== '__id').forEach(c => { o[c] = r[c]; });
      return o;
    });
    downloadBlob(JSON.stringify(data, null, 2), 'query_result.json', 'application/json');
    return;
  }
  const features = rows.map(r => {
    let geometry = null;
    try { geometry = r[currentGeomCol] ? JSON.parse(String(r[currentGeomCol])) : null; } catch { }
    const props = {};
    currentCols.filter(c => c !== currentGeomCol && c !== '__id').forEach(c => {
      const v = r[c];
      props[c] = typeof v === 'bigint' ? v.toString() : v;
    });
    return { type: 'Feature', geometry, properties: props };
  });
  downloadBlob(
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
    'query_result.geojson', 'application/geo+json'
  );
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ============================================================
   TABLE FILTER + SORT
   ============================================================ */
function getFilteredSortedRows() {
  let rows = currentRows;
  const active = Object.entries(filterValues).filter(([, v]) => v.trim() !== '');
  if (active.length) {
    rows = rows.filter(row =>
      active.every(([col, val]) => {
        const cell = row[col];
        if (cell === null || cell === undefined) return false;
        return String(cell).toLowerCase().includes(val.toLowerCase());
      })
    );
  }
  if (sortState.col && sortState.dir) {
    const col = sortState.col;
    const dir = sortState.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av == null) return 1;
      if (bv == null) return -1;
      if ((typeof av === 'number' || typeof av === 'bigint') &&
        (typeof bv === 'number' || typeof bv === 'bigint'))
        return (Number(av) - Number(bv)) * dir;
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

  const displayCols = currentCols.filter(c => c !== currentGeomCol && c !== '__id');
  const table = document.createElement('table');
  table.id = 'results-table';

  /* thead */
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  // Select-all
  const thCk = document.createElement('th');
  thCk.className = 'col-check';
  const selAll = document.createElement('input');
  selAll.type = 'checkbox';
  selAll.title = 'Select all visible rows';
  selAll.addEventListener('change', () => {
    getFilteredSortedRows().forEach(r => selAll.checked ? selectedIds.add(r.__id) : selectedIds.delete(r.__id));
    syncSelection();
  });
  thCk.appendChild(selAll);
  headerRow.appendChild(thCk);

  displayCols.forEach(col => {
    const th = document.createElement('th');
    th.className = 'col-sortable';
    const lbl = document.createElement('span'); lbl.className = 'col-label'; lbl.textContent = col;
    const ind = document.createElement('span'); ind.className = 'sort-indicator';
    ind.textContent = sortState.col === col ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
    th.append(lbl, ind);
    th.addEventListener('click', () => {
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : sortState.dir === 'desc' ? null : 'asc';
        if (!sortState.dir) sortState.col = null;
      } else { sortState.col = col; sortState.dir = 'asc'; }
      renderTableBody(table.querySelector('tbody'), displayCols);
      table.querySelectorAll('.sort-indicator').forEach(e => e.textContent = '');
      if (sortState.col) {
        const i = displayCols.indexOf(sortState.col);
        const ths = table.querySelectorAll('thead tr:first-child th.col-sortable');
        if (ths[i]) ths[i].querySelector('.sort-indicator').textContent = sortState.dir === 'asc' ? ' ▲' : ' ▼';
      }
    });
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Filter row
  const filterRow = document.createElement('tr');
  filterRow.className = 'filter-row';
  const tfCk = document.createElement('th'); tfCk.className = 'col-check';
  filterRow.appendChild(tfCk);
  displayCols.forEach(col => {
    const th = document.createElement('th');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'filter-input'; inp.placeholder = 'filter…';
    inp.value = filterValues[col] || '';
    inp.addEventListener('input', () => { filterValues[col] = inp.value; renderTableBody(table.querySelector('tbody'), displayCols); });
    th.appendChild(inp);
    filterRow.appendChild(th);
  });
  thead.appendChild(filterRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  renderTableBody(tbody, displayCols);
  wrapper.innerHTML = '';
  wrapper.appendChild(table);
}

function renderTableBody(tbody, displayCols) {
  tbody.innerHTML = '';
  getFilteredSortedRows().forEach(row => {
    const rid = row.__id;
    const tr = document.createElement('tr');
    tr.dataset.rid = rid;
    if (selectedIds.has(rid)) tr.classList.add('row-selected');

    const tdCk = document.createElement('td'); tdCk.className = 'col-check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selectedIds.has(rid);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(rid); else selectedIds.delete(rid);
      tr.classList.toggle('row-selected', cb.checked);
      syncSelection();
    });
    tdCk.appendChild(cb); tr.appendChild(tdCk);

    displayCols.forEach(col => {
      const td = document.createElement('td');
      const val = row[col];
      if (typeof val === 'number' || typeof val === 'bigint') {
        td.className = 'cell-number';
        td.textContent = typeof val === 'bigint' ? val.toString() : Number.isInteger(val) ? val : val.toFixed(4);
      } else if (val === null || val === undefined) {
        td.style.color = 'var(--text-dim)'; td.textContent = 'null';
      } else { td.textContent = String(val); }
      tr.appendChild(td);
    });

    tr.addEventListener('click', e => {
      if (e.target.type === 'checkbox') return;
      if (selectedIds.has(rid)) { selectedIds.delete(rid); cb.checked = false; tr.classList.remove('row-selected'); }
      else { selectedIds.add(rid); cb.checked = true; tr.classList.add('row-selected'); }
      syncSelection();
    });
    tbody.appendChild(tr);
  });
}

/* ============================================================
   MAP LAYER MANAGEMENT
   ============================================================ */
function updateMap(skipFit = false) {
  if (!map || !map.isStyleLoaded()) return 0;

  const features = [];
  currentRows.forEach((row, i) => {
    const gv = row[currentGeomCol];
    if (!gv) return;
    try {
      const geometry = JSON.parse(typeof gv === 'string' ? gv : String(gv));
      const properties = { __id: i };
      Object.keys(row).forEach(k => {
        if (k !== currentGeomCol) { const v = row[k]; properties[k] = typeof v === 'bigint' ? v.toString() : v; }
      });
      features.push({ type: 'Feature', geometry, properties });
    } catch { }
  });

  const geojsonFC = { type: 'FeatureCollection', features };
  const POINT_T = new Set(['Point', 'MultiPoint']);
  const LINE_T = new Set(['LineString', 'MultiLineString']);
  const POLY_T = new Set(['Polygon', 'MultiPolygon']);

  const flat = [];
  features.forEach(f => {
    if (f.geometry.type === 'GeometryCollection')
      f.geometry.geometries.forEach(g => flat.push({ type: 'Feature', geometry: g, properties: f.properties }));
    else flat.push(f);
  });

  const pts = { type: 'FeatureCollection', features: flat.filter(f => POINT_T.has(f.geometry.type)) };
  const lns = { type: 'FeatureCollection', features: flat.filter(f => LINE_T.has(f.geometry.type)) };
  const pols = { type: 'FeatureCollection', features: flat.filter(f => POLY_T.has(f.geometry.type)) };
  const empty = { type: 'FeatureCollection', features: [] };

  // Store for basemap re-hydration
  lastMapData = { geojsonFC, pts, lns, pols };

  if (map.getSource('query-result')) {
    map.getSource('query-result').setData(geojsonFC);
    map.getSource('query-points-src').setData(pts);
    map.getSource('query-lines-src').setData(lns);
    map.getSource('query-polygons-src').setData(pols);
    map.getSource('selected-src').setData(empty);
  } else {
    map.addSource('query-result', { type: 'geojson', data: geojsonFC });
    map.addSource('query-points-src', { type: 'geojson', data: pts });
    map.addSource('query-lines-src', { type: 'geojson', data: lns });
    map.addSource('query-polygons-src', { type: 'geojson', data: pols });
    map.addSource('selected-src', { type: 'geojson', data: empty });

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

    // Selection highlight layers
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

  if (features.length > 0 && !skipFit) fitMapToFeatures(geojsonFC);
  return features.length;
}

function fitMapToFeatures(geojson) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  function walkCoords(coords) {
    const stack = [coords];
    while (stack.length) {
      const item = stack.pop();
      if (!Array.isArray(item)) continue;
      if (typeof item[0] === 'number') {
        if (item[0] < minLng) minLng = item[0]; if (item[0] > maxLng) maxLng = item[0];
        if (item[1] < minLat) minLat = item[1]; if (item[1] > maxLat) maxLat = item[1];
      } else { for (let i = 0; i < item.length; i++) stack.push(item[i]); }
    }
  }
  geojson.features.forEach(f => { if (f.geometry?.coordinates) walkCoords(f.geometry.coordinates); });
  if (!isFinite(minLng)) return;
  const camera = map.cameraForBounds([[minLng, minLat], [maxLng, maxLat]], {
    padding: { top: 60, bottom: 60, left: 60, right: 60 }, maxZoom: 14
  });
  if (camera) map.flyTo({ ...camera, duration: 1200, essential: true });
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
   ATTRIBUTE STYLING — State
   ============================================================ */
const DEFAULT_STYLE = {
  mode: 'single',   // 'single' | 'graduated' | 'categorical'
  col: null,
  singleColor: '#f0a500',
  ramp: 'oranges',
  rampInverted: false,
  method: 'quantile', // 'quantile' | 'equal' | 'jenks'
  nClasses: 5,
  opacity: 85,         // 0–100
};
let styleSettings = { ...DEFAULT_STYLE };

// Built-in color ramps (5-stop, low→high)
const COLOR_RAMPS = {
  oranges: ['#fff3e0', '#ffcc80', '#ffa726', '#f57c00', '#bf360c'],
  reds: ['#ffebee', '#ef9a9a', '#e53935', '#c62828', '#7f0000'],
  blues: ['#e3f2fd', '#90caf9', '#1e88e5', '#1565c0', '#0d2d6b'],
  greens: ['#e8f5e9', '#a5d6a7', '#43a047', '#2e7d32', '#0a3d0a'],
  purples: ['#f3e5f5', '#ce93d8', '#8e24aa', '#6a1b9a', '#2e0040'],
  plasma: ['#0d0887', '#7201a8', '#bd3786', '#ed7953', '#f0f921'],
  viridis: ['#440154', '#31688e', '#21918c', '#35b779', '#fde725'],
  greys: ['#f5f5f5', '#bdbdbd', '#757575', '#424242', '#212121'],
  rdylgn: ['#d73027', '#fc8d59', '#ffffbf', '#91cf60', '#1a9850'],
  spectral: ['#9e0142', '#f46d43', '#ffffbf', '#66c2a5', '#5e4fa2'],
};

const CATEGORICAL_PALETTE = [
  '#e8323c', '#f0a500', '#3ddc84', '#42a5f5', '#ab47bc',
  '#ff7043', '#26c6da', '#d4e157', '#ec407a', '#8d6e63',
  '#607d8b', '#66bb6a', '#ffa726', '#26a69a', '#7e57c2',
];

/* ============================================================
   CLASSIFICATION ALGORITHMS
   ============================================================ */
function classifyEqualInterval(values, n) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / n;
  const breaks = [];
  for (let i = 0; i <= n; i++) breaks.push(min + step * i);
  breaks[breaks.length - 1] = max; // clamp
  return breaks;
}

function classifyQuantile(values, n) {
  const sorted = [...values].sort((a, b) => a - b);
  const breaks = [sorted[0]];
  for (let i = 1; i < n; i++) {
    const idx = Math.floor((i / n) * sorted.length);
    breaks.push(sorted[idx]);
  }
  breaks.push(sorted[sorted.length - 1]);
  return breaks;
}

function classifyJenks(values, n) {
  // Jenks Natural Breaks (Fisher-Jenks exact algorithm)
  const sorted = [...values].sort((a, b) => a - b);
  const len = sorted.length;
  if (len <= n) return [sorted[0], ...sorted, sorted[len - 1]];

  // Lower matrix (1-indexed via offset)
  const mat1 = Array.from({ length: len + 1 }, () => new Array(n + 1).fill(0));
  const mat2 = Array.from({ length: len + 1 }, () => new Array(n + 1).fill(Infinity));

  for (let i = 1; i <= n; i++) { mat1[1][i] = 1; mat2[1][i] = 0; }
  for (let j = 2; j <= len; j++) mat2[j][1] = Infinity;

  for (let j = 2; j <= len; j++) {
    let ssd = 0, sumX = 0, sumX2 = 0, w = 0;
    for (let m = j; m >= 2; m--) {
      w++;
      const val = sorted[m - 1];
      sumX += val; sumX2 += val * val;
      ssd = sumX2 - (sumX * sumX) / w;
      for (let k = 2; k <= n; k++) {
        if (mat2[j][k] >= ssd + mat2[m - 1][k - 1]) {
          mat1[j][k] = m;
          mat2[j][k] = ssd + mat2[m - 1][k - 1];
        }
      }
    }
    mat1[j][1] = 1;
    mat2[j][1] = ssd;
  }

  const breaks = new Array(n + 1);
  breaks[n] = sorted[len - 1];
  breaks[0] = sorted[0];
  let k = len;
  for (let i = n; i >= 2; i--) {
    const id = mat1[k][i] - 1;
    breaks[i - 1] = sorted[id];
    k = mat1[k][i] - 1;
  }
  return breaks;
}

function getBreaks(values, method, n) {
  if (method === 'jenks') return classifyJenks(values, n);
  if (method === 'equal') return classifyEqualInterval(values, n);
  return classifyQuantile(values, n);
}

function getRamp() {
  const ramp = [...(COLOR_RAMPS[styleSettings.ramp] || COLOR_RAMPS.oranges)];
  return styleSettings.rampInverted ? ramp.reverse() : ramp;
}

function interpolateRampToN(ramp, n) {
  // Stretch or compress a base ramp to exactly n stops
  if (ramp.length === n) return ramp;
  const result = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const idx = t * (ramp.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(Math.ceil(idx), ramp.length - 1);
    const f = idx - lo;
    result.push(lerpColor(ramp[lo], ramp[hi], f));
  }
  return result;
}

function lerpColor(a, b, t) {
  const ah = a.replace('#', '');
  const bh = b.replace('#', '');
  const ar = parseInt(ah.slice(0, 2), 16), ag = parseInt(ah.slice(2, 4), 16), ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16), bg = parseInt(bh.slice(2, 4), 16), bb = parseInt(bh.slice(4, 6), 16);
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `#${rr.toString(16).padStart(2, '0')}${rg.toString(16).padStart(2, '0')}${rb.toString(16).padStart(2, '0')}`;
}

function fmtNum(v) {
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  if (!Number.isInteger(v)) return v.toFixed(2);
  return v.toString();
}

// Interactive legend filter state
let hiddenCategories = new Set();      // for categorical toggle
let legendFilterRange = null;          // [min, max] or null = no range filter
let legendAllValues = [];            // sorted numeric values for current grad col
let legendBreaks = [];            // class breaks for current grad style

/* ============================================================
   STYLE PANEL — Setup & Wiring
   ============================================================ */
function updateStylePanel(hasGeometry) {
  const panel = document.getElementById('style-panel');
  if (!panel) return;
  panel.style.display = hasGeometry ? 'block' : 'none';
  if (!hasGeometry) return;

  // Reset to default each time new results arrive
  styleSettings = { ...DEFAULT_STYLE };

  // Mode pills
  document.querySelectorAll('.mode-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === styleSettings.mode);
    btn.onclick = () => {
      styleSettings.mode = btn.dataset.mode;
      document.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      syncStylePanelVisibility();
      renderLegendPreview();
    };
  });

  // Column select — only non-geometry, non-id cols
  const colSelect = document.getElementById('style-col-select');
  colSelect.innerHTML = '';
  currentCols.filter(c => c !== currentGeomCol && c !== '__id').forEach(col => {
    const opt = document.createElement('option');
    opt.value = col; opt.textContent = col;
    colSelect.appendChild(opt);
  });
  if (colSelect.options.length) styleSettings.col = colSelect.options[0].value;
  colSelect.onchange = () => {
    styleSettings.col = colSelect.value;
    renderLegendPreview();
  };

  // Single color picker
  const colorInput = document.getElementById('style-single-color');
  const hexLabel = document.getElementById('style-single-hex');
  colorInput.value = styleSettings.singleColor;
  colorInput.oninput = () => {
    styleSettings.singleColor = colorInput.value;
    hexLabel.textContent = colorInput.value;
    renderLegendPreview();
  };

  // Classification method pills
  document.querySelectorAll('.classify-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.method === styleSettings.method);
    btn.onclick = () => {
      styleSettings.method = btn.dataset.method;
      document.querySelectorAll('.classify-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLegendPreview();
    };
  });

  // Class count buttons
  document.querySelectorAll('.class-count-btn').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.n === styleSettings.nClasses);
    btn.onclick = () => {
      styleSettings.nClasses = +btn.dataset.n;
      document.querySelectorAll('.class-count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLegendPreview();
    };
  });

  // Ramp swatches
  renderRampSwatches();

  // Invert ramp
  const invertBtn = document.getElementById('invert-ramp-btn');
  if (invertBtn) {
    invertBtn.onclick = () => {
      styleSettings.rampInverted = !styleSettings.rampInverted;
      invertBtn.style.color = styleSettings.rampInverted ? 'var(--accent)' : '';
      renderRampSwatches();
      renderLegendPreview();
    };
  }

  // Opacity slider
  const opSlider = document.getElementById('style-opacity');
  const opVal = document.getElementById('style-opacity-val');
  opSlider.value = styleSettings.opacity;
  opSlider.oninput = () => {
    styleSettings.opacity = +opSlider.value;
    opVal.textContent = opSlider.value + '%';
  };

  // Apply button
  document.getElementById('apply-style-btn').onclick = applyStyle;

  syncStylePanelVisibility();
  renderLegendPreview();
}

function syncStylePanelVisibility() {
  const isSingle = styleSettings.mode === 'single';
  const isGraduated = styleSettings.mode === 'graduated';

  document.getElementById('style-row-single').style.display = isSingle ? 'flex' : 'none';
  document.getElementById('style-row-col').style.display = isSingle ? 'none' : 'flex';
  document.getElementById('style-graduated-controls').style.display = isGraduated ? 'block' : 'none';
}

function renderRampSwatches() {
  const container = document.getElementById('ramp-swatches');
  if (!container) return;
  container.innerHTML = '';
  Object.entries(COLOR_RAMPS).forEach(([name, colors]) => {
    const palette = styleSettings.rampInverted ? [...colors].reverse() : colors;
    const sw = document.createElement('div');
    sw.className = `ramp-swatch${styleSettings.ramp === name ? ' active' : ''}`;
    sw.title = name;
    sw.style.background = `linear-gradient(to right, ${palette.join(',')})`;
    sw.onclick = () => {
      styleSettings.ramp = name;
      renderRampSwatches();
      renderLegendPreview();
    };
    container.appendChild(sw);
  });
}

/* ============================================================
   LEGEND PREVIEW (live, before Apply)
   ============================================================ */
function renderLegendPreview() {
  const container = document.getElementById('style-legend');
  if (!container) return;
  container.innerHTML = '';

  const mode = styleSettings.mode;

  if (mode === 'single') {
    const title = document.createElement('div');
    title.className = 'legend-title';
    title.textContent = 'Preview';
    const row = document.createElement('div');
    row.className = 'legend-break-row';
    row.innerHTML = `
      <div class="legend-break-swatch" style="background:${styleSettings.singleColor}"></div>
      <span class="legend-break-label">All features</span>`;
    container.append(title, row);
    return;
  }

  const col = styleSettings.col;
  if (!col) return;

  if (mode === 'graduated') {
    renderGraduatedLegend(container, col);
  } else {
    renderCategoricalLegend(container, col);
  }
}

function renderGraduatedLegend(container, col) {
  const values = currentRows.map(r => Number(r[col])).filter(v => isFinite(v));
  if (!values.length) return;

  const n = styleSettings.nClasses;
  const breaks = getBreaks(values, styleSettings.method, n);
  const ramp = interpolateRampToN(getRamp(), n);

  // Gradient bar
  const gradBar = document.createElement('div');
  gradBar.className = 'legend-gradient-bar';
  gradBar.style.background = `linear-gradient(to right, ${ramp.join(',')})`;

  // Min / max labels
  const gradLabels = document.createElement('div');
  gradLabels.className = 'legend-gradient-labels';
  gradLabels.innerHTML = `<span>${fmtNum(breaks[0])}</span><span>${fmtNum(breaks[n])}</span>`;

  // Per-class breaks
  const breakList = document.createElement('div');
  breakList.className = 'legend-breaks';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'legend-break-row';
    const lo = fmtNum(breaks[i]);
    const hi = fmtNum(breaks[i + 1]);
    const label = i === n - 1 ? `${lo} – ${hi}` : `${lo} – < ${hi}`;
    row.innerHTML = `
      <div class="legend-break-swatch" style="background:${ramp[i]}"></div>
      <span class="legend-break-label">${label}</span>`;
    breakList.appendChild(row);
  }

  const title = document.createElement('div');
  title.className = 'legend-title';
  title.textContent = `${col} · ${styleSettings.method} · ${n} classes`;

  container.append(title, gradBar, gradLabels, breakList);
}

function renderCategoricalLegend(container, col) {
  const unique = [...new Set(currentRows.map(r => r[col]).filter(v => v != null))].slice(0, 20);
  const title = document.createElement('div');
  title.className = 'legend-title';
  title.textContent = `${col} · ${unique.length} categories${unique.length >= 20 ? ' (top 20)' : ''}`;

  const list = document.createElement('div');
  list.className = 'legend-cat-list';

  unique.forEach((val, i) => {
    const color = CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length];
    const row = document.createElement('div');
    row.className = 'legend-cat-row';
    row.innerHTML = `
      <div class="legend-cat-swatch" style="background:${color}" title="Click to change color"></div>
      <span class="legend-cat-label" title="${val}">${val}</span>`;
    list.appendChild(row);
  });

  container.append(title, list);
  if (unique.length >= 20) {
    const note = document.createElement('div');
    note.style.cssText = 'font-family:var(--font-mono);font-size:9px;color:var(--text-dim);margin-top:4px';
    note.textContent = `+ ${currentRows.length} rows, showing first 20 categories`;
    container.appendChild(note);
  }
}

/* ============================================================
   APPLY STYLE TO MAP
   ============================================================ */
function applyStyle(silent = false) {
  if (!map) return;
  styleApplied = true;
  hiddenCategories = new Set();
  legendFilterRange = null;

  const opacity = styleSettings.opacity / 100;
  const mode = styleSettings.mode;

  // Clear any previous filters
  setLayerFilter(null);

  if (mode === 'single') {
    applySingleStyle(styleSettings.singleColor, opacity);
    renderInteractiveLegend();
    if (!silent) updateURL();
    return;
  }

  const col = styleSettings.col;
  if (!col) return;

  const sample = currentRows.find(r => r[col] !== null && r[col] !== undefined);
  const isNumeric = sample && (typeof sample[col] === 'number' || typeof sample[col] === 'bigint');

  if (mode === 'graduated' && isNumeric) {
    applyGraduatedStyle(col, opacity);
  } else {
    applyCategoricalStyle(col, opacity);
  }
  renderInteractiveLegend();
  if (!silent) updateURL();
}

// Apply or clear a MapLibre filter on all query layers
function setLayerFilter(filter) {
  ['query-polygons', 'query-polygon-outline', 'query-points', 'query-lines'].forEach(id => {
    if (map.getLayer(id)) map.setFilter(id, filter);
  });
}

function applySingleStyle(color, opacity) {
  if (map.getLayer('query-polygons')) {
    map.setPaintProperty('query-polygons', 'fill-color', color);
    map.setPaintProperty('query-polygons', 'fill-opacity', opacity * 0.8);
    map.setPaintProperty('query-polygon-outline', 'line-color', color);
  }
  if (map.getLayer('query-points')) {
    map.setPaintProperty('query-points', 'circle-color', color);
    map.setPaintProperty('query-points', 'circle-opacity', opacity);
  }
  if (map.getLayer('query-lines')) {
    map.setPaintProperty('query-lines', 'line-color', color);
    map.setPaintProperty('query-lines', 'line-opacity', opacity);
  }
}

function applyGraduatedStyle(col, opacity) {
  const values = currentRows.map(r => Number(r[col])).filter(v => isFinite(v));
  if (!values.length) return;

  const n = styleSettings.nClasses;
  const breaks = getBreaks(values, styleSettings.method, n);
  const ramp = interpolateRampToN(getRamp(), n);

  // Store for interactive legend
  legendAllValues = [...values].sort((a, b) => a - b);
  legendBreaks = breaks;

  const stepExpr = ['step', ['get', col], ramp[0]];
  for (let i = 1; i < n; i++) {
    stepExpr.push(breaks[i]);
    stepExpr.push(ramp[i]);
  }

  if (map.getLayer('query-polygons')) {
    map.setPaintProperty('query-polygons', 'fill-color', stepExpr);
    map.setPaintProperty('query-polygons', 'fill-opacity', opacity * 0.85);
    map.setPaintProperty('query-polygon-outline', 'line-color', stepExpr);
  }
  if (map.getLayer('query-points')) {
    map.setPaintProperty('query-points', 'circle-color', stepExpr);
    map.setPaintProperty('query-points', 'circle-opacity', opacity);
  }
  if (map.getLayer('query-lines')) {
    map.setPaintProperty('query-lines', 'line-color', stepExpr);
    map.setPaintProperty('query-lines', 'line-opacity', opacity);
  }
}

function applyCategoricalStyle(col, opacity) {
  const unique = [...new Set(currentRows.map(r => r[col]).filter(v => v != null))];
  const match = ['match', ['get', col]];
  unique.forEach((v, i) => {
    match.push(String(v));
    match.push(CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]);
  });
  match.push('#aaaaaa');

  if (map.getLayer('query-polygons')) {
    map.setPaintProperty('query-polygons', 'fill-color', match);
    map.setPaintProperty('query-polygons', 'fill-opacity', opacity * 0.85);
    map.setPaintProperty('query-polygon-outline', 'line-color', match);
  }
  if (map.getLayer('query-points')) {
    map.setPaintProperty('query-points', 'circle-color', match);
    map.setPaintProperty('query-points', 'circle-opacity', opacity);
  }
  if (map.getLayer('query-lines')) {
    map.setPaintProperty('query-lines', 'line-color', match);
    map.setPaintProperty('query-lines', 'line-opacity', opacity);
  }
}

/* ============================================================
   INTERACTIVE LEGEND (rendered after Apply)
   ============================================================ */
function renderInteractiveLegend() {
  const card = document.getElementById('map-legend');
  const inner = document.getElementById('map-legend-inner');
  if (!card || !inner) return;

  inner.innerHTML = '';
  card.style.display = 'block';

  const mode = styleSettings.mode;

  // Dismiss button
  const dismiss = document.createElement('button');
  dismiss.className = 'map-legend-dismiss';
  dismiss.title = 'Close legend';
  dismiss.textContent = '×';
  dismiss.onclick = () => { card.style.display = 'none'; };
  inner.appendChild(dismiss);

  if (mode === 'single') {
    const title = document.createElement('div');
    title.className = 'ml-title';
    title.textContent = 'Features';
    const row = document.createElement('div');
    row.className = 'ml-cat-row';
    row.innerHTML = `<div class="ml-swatch" style="background:${styleSettings.singleColor}"></div>
                     <span class="ml-label">All features</span>`;
    inner.appendChild(title);
    inner.appendChild(row);
    return;
  }

  const col = styleSettings.col;
  if (!col) { card.style.display = 'none'; return; }

  if (mode === 'graduated') {
    renderGraduatedInteractiveLegend(inner, col);
  } else {
    renderCategoricalInteractiveLegend(inner, col);
  }
}

/* ── Categorical: click-to-toggle rows ─────────────────────── */
function renderCategoricalInteractiveLegend(container, col) {
  const unique = [...new Set(currentRows.map(r => r[col]).filter(v => v != null))];

  const header = document.createElement('div');
  header.className = 'ml-header';
  header.innerHTML = `<span class="ml-title">${col}</span>
    <button class="ml-reset" title="Show all categories">Reset</button>`;
  header.querySelector('.ml-reset').onclick = () => {
    hiddenCategories.clear();
    setLayerFilter(null);
    renderCategoricalInteractiveLegend(container, col);
  };

  const list = document.createElement('div');
  list.className = 'ml-cat-list';

  unique.forEach((val, i) => {
    const color = CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length];
    const hidden = hiddenCategories.has(val);
    const row = document.createElement('div');
    row.className = `ml-cat-row${hidden ? ' ml-hidden' : ''}`;
    row.title = hidden ? 'Click to show' : 'Click to hide';
    row.innerHTML = `
      <div class="ml-swatch" style="background:${hidden ? '#555' : color}"></div>
      <span class="ml-label">${String(val)}</span>
      <span class="ml-count">${currentRows.filter(r => r[col] == val).length}</span>`;
    row.addEventListener('click', () => {
      if (hiddenCategories.has(val)) hiddenCategories.delete(val);
      else hiddenCategories.add(val);
      applyCategoricalFilter(col, unique);
      renderCategoricalInteractiveLegend(container, col);
    });
    list.appendChild(row);
  });

  // Replace everything after dismiss button
  while (container.children.length > 1) container.removeChild(container.lastChild);
  container.appendChild(header);
  container.appendChild(list);

  if (unique.length > 12) {
    const note = document.createElement('div');
    note.className = 'ml-note';
    note.textContent = `${unique.length} categories · scroll for more`;
    container.appendChild(note);
  }
}

function applyCategoricalFilter(col, unique) {
  const visible = unique.filter(v => !hiddenCategories.has(v));
  if (visible.length === unique.length) setLayerFilter(null);
  else if (visible.length === 0) setLayerFilter(['boolean', false]);
  else setLayerFilter(['match', ['get', col], visible.map(String), true, false]);
}

/* ── Graduated: draggable range + ghost overlays ───────────── */
function renderGraduatedInteractiveLegend(container, col) {
  const values = legendAllValues.length ? legendAllValues
    : currentRows.map(r => Number(r[col])).filter(v => isFinite(v)).sort((a, b) => a - b);
  if (!values.length) return;

  const absMin = values[0];
  const absMax = values[values.length - 1];
  const n = styleSettings.nClasses;
  const breaks = legendBreaks.length ? legendBreaks : getBreaks(values, styleSettings.method, n);
  const ramp = interpolateRampToN(getRamp(), n);

  if (!legendFilterRange) legendFilterRange = [absMin, absMax];
  let [selMin, selMax] = legendFilterRange;

  const header = document.createElement('div');
  header.className = 'ml-header';
  header.innerHTML = `<span class="ml-title">${col}</span>
    <span class="ml-subtitle">${styleSettings.method} · ${n} classes</span>
    <button class="ml-reset" title="Reset filter">Reset Filter</button>`;
  header.querySelector('.ml-reset').onclick = () => {
    legendFilterRange = [absMin, absMax];
    selMin = absMin; selMax = absMax;
    setLayerFilter(null);
    renderGraduatedInteractiveLegend(container, col);
  };

  /* ── Gradient bar with ghost overlays + dual handles ── */
  const barWrap = document.createElement('div');
  barWrap.className = 'ml-bar-wrap';

  // Base gradient
  const gradBar = document.createElement('div');
  gradBar.className = 'ml-grad-bar';
  gradBar.style.background = `linear-gradient(to right, ${ramp.join(',')})`;

  // Left ghost (unselected)
  const ghostL = document.createElement('div');
  ghostL.className = 'ml-ghost ml-ghost-left';
  ghostL.style.width = valueToPercent(selMin, absMin, absMax) + '%';

  // Right ghost (unselected)
  const ghostR = document.createElement('div');
  ghostR.className = 'ml-ghost ml-ghost-right';
  ghostR.style.width = (100 - valueToPercent(selMax, absMin, absMax)) + '%';

  // Middle draggable selection window
  const selWindow = document.createElement('div');
  selWindow.className = 'ml-sel-window';
  selWindow.style.left = valueToPercent(selMin, absMin, absMax) + '%';
  selWindow.style.width = (valueToPercent(selMax, absMin, absMax) - valueToPercent(selMin, absMin, absMax)) + '%';
  selWindow.title = 'Drag to pan selection';

  // Handles
  const handleMin = document.createElement('div');
  handleMin.className = 'ml-handle ml-handle-l';
  handleMin.style.left = valueToPercent(selMin, absMin, absMax) + '%';

  const handleMax = document.createElement('div');
  handleMax.className = 'ml-handle ml-handle-r';
  handleMax.style.left = valueToPercent(selMax, absMin, absMax) + '%';

  barWrap.appendChild(gradBar);
  barWrap.appendChild(ghostL);
  barWrap.appendChild(ghostR);
  barWrap.appendChild(selWindow);
  barWrap.appendChild(handleMin);
  barWrap.appendChild(handleMax);

  // Readout
  const readout = document.createElement('div');
  readout.className = 'ml-readout';
  readout.innerHTML = `<span class="ml-val ml-val-min">${fmtNum(selMin)}</span>
                       <span class="ml-val-sep">to</span>
                       <span class="ml-val ml-val-max">${fmtNum(selMax)}</span>`;

  function updateUI() {
    const minPct = valueToPercent(selMin, absMin, absMax);
    const maxPct = valueToPercent(selMax, absMin, absMax);
    handleMin.style.left = minPct + '%';
    handleMax.style.left = maxPct + '%';
    ghostL.style.width = minPct + '%';
    ghostR.style.width = (100 - maxPct) + '%';
    selWindow.style.left = minPct + '%';
    selWindow.style.width = (maxPct - minPct) + '%';
    readout.querySelector('.ml-val-min').textContent = fmtNum(selMin);
    readout.querySelector('.ml-val-max').textContent = fmtNum(selMax);
  }

  // Drag individual handles
  function makeDragHandler(isMin) {
    return function (e) {
      e.preventDefault(); e.stopPropagation();
      const rect = gradBar.getBoundingClientRect();
      const range = absMax - absMin;
      function onMove(ev) {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const val = absMin + pct * range;
        if (isMin) selMin = Math.min(val, selMax - range * 0.01);
        else selMax = Math.max(val, selMin + range * 0.01);
        legendFilterRange = [selMin, selMax];
        updateUI();
        applyRangeFilter(col, selMin, selMax);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }

  // Drag middle window to pan
  selWindow.addEventListener('mousedown', e => {
    e.preventDefault();
    const rect = gradBar.getBoundingClientRect();
    const range = absMax - absMin;
    const width = selMax - selMin;
    const startX = e.clientX;
    const startMin = selMin;
    const startMax = selMax;
    function onMove(ev) {
      const dx = (ev.clientX - startX) / rect.width * range;
      let nMin = startMin + dx;
      let nMax = startMax + dx;
      if (nMin < absMin) { nMin = absMin; nMax = absMin + width; }
      if (nMax > absMax) { nMax = absMax; nMin = absMax - width; }
      selMin = nMin; selMax = nMax;
      legendFilterRange = [selMin, selMax];
      updateUI();
      applyRangeFilter(col, selMin, selMax);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  handleMin.addEventListener('mousedown', makeDragHandler(true));
  handleMax.addEventListener('mousedown', makeDragHandler(false));

  // Per-class break rows
  const breakList = document.createElement('div');
  breakList.className = 'ml-breaks';
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'ml-cat-row';
    row.innerHTML = `<div class="ml-swatch" style="background:${ramp[i]}"></div>
                     <span class="ml-label">${fmtNum(breaks[i])} – ${i < n - 1 ? '< ' : ''}${fmtNum(breaks[i + 1])}</span>`;
    breakList.appendChild(row);
  }

  // Replace everything after dismiss button
  while (container.children.length > 1) container.removeChild(container.lastChild);
  container.appendChild(header);
  container.appendChild(barWrap);
  container.appendChild(readout);
  container.appendChild(breakList);
}

function valueToPercent(val, min, max) {
  if (max === min) return 0;
  return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
}

function applyRangeFilter(col, min, max) {
  const filter = ['all', ['>=', ['get', col], min], ['<=', ['get', col], max]];
  setLayerFilter(filter);
}

/* ============================================================
   SELECTION SYNC (map ↔ table)
   ============================================================ */
function syncSelection() {
  if (map?.getSource('selected-src')) {
    const selFeats = currentRows.filter(r => selectedIds.has(r.__id)).map(r => {
      const gv = r[currentGeomCol];
      if (!gv) return null;
      try { return { type: 'Feature', geometry: JSON.parse(typeof gv === 'string' ? gv : String(gv)), properties: { __id: r.__id } }; }
      catch { return null; }
    }).filter(Boolean);
    map.getSource('selected-src').setData({ type: 'FeatureCollection', features: selFeats });
  }
  document.querySelectorAll('#results-table tbody tr').forEach(tr => {
    const rid = Number(tr.dataset.rid);
    const sel = selectedIds.has(rid);
    tr.classList.toggle('row-selected', sel);
    const cb = tr.querySelector('input[type=checkbox]');
    if (cb) cb.checked = sel;
  });
}

function selectFeatureFromMap(id) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  syncSelection();
  const tr = document.querySelector(`#results-table tbody tr[data-rid="${id}"]`);
  if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ============================================================
   QUERY HISTORY
   ============================================================ */
function addToHistory(sql, success, rowCount, elapsed) {
  queryHistory.unshift({ sql, success, rowCount, elapsed, timestamp: new Date() });
  if (queryHistory.length > 20) queryHistory.pop();
  renderHistory();
  idbPut('state', { key: 'history', value: queryHistory });
}

function renderHistory() {
  const container = document.getElementById('query-history');
  if (!container) return;
  Array.from(container.children).forEach(c => { if (!c.classList.contains('section-label')) c.remove(); });
  queryHistory.forEach(entry => {
    const item = document.createElement('div');
    item.className = `history-item ${entry.success ? 'success' : 'error'}`;
    const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const preview = entry.sql.replace(/\s+/g, ' ').substring(0, 60);
    item.innerHTML = `
      <div class="history-status">
        <div class="history-dot ${entry.success ? 'success' : 'error'}"></div>
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-secondary)">
          ${entry.success ? `${entry.rowCount} rows · ${entry.elapsed}s` : 'ERROR'}
        </span>
        <span class="history-timestamp">${timeStr}</span>
      </div>
      <div class="history-preview">${preview}${entry.sql.length > 60 ? '…' : ''}</div>`;
    item.addEventListener('click', () => {
      editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: entry.sql } });
    });
    container.appendChild(item);
  });
}

/* ============================================================
   UI HELPERS
   ============================================================ */
function setLoading(on) {
  const btn = document.getElementById('run-btn');
  const sp = document.getElementById('query-loading');
  if (btn) btn.disabled = on;
  if (sp) sp.classList.toggle('visible', on);
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (el) { el.textContent = '⚠ ' + msg; el.classList.add('visible'); }
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
    meta.textContent += (mappedCount !== undefined && hasGeo)
      ? `, ${mappedCount.toLocaleString()} mapped in ${elapsed}s`
      : ` in ${elapsed}s`;
    meta.className = hasGeo ? 'has-geo' : '';
  }
}

/* ============================================================
   POPUP STYLES
   ============================================================ */
function injectPopupStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .geo-popup .maplibregl-popup-content {
      background:#161d26;border:1px solid #2a3f57;border-radius:6px;
      padding:0;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:180px;max-width:280px;
    }
    .geo-popup .maplibregl-popup-tip { border-top-color:#161d26; }
    .popup-content { padding:10px 12px; }
    .popup-row {
      display:flex;justify-content:space-between;gap:12px;padding:3px 0;
      border-bottom:1px solid #1f2d3d;font-family:'JetBrains Mono',monospace;font-size:10px;
    }
    .popup-row:last-child { border-bottom:none; }
    .popup-key { color:#6b8099; }
    .popup-val { color:#c9d4e0;font-weight:500;text-align:right;word-break:break-all; }
  `;
  document.head.appendChild(s);
}

/* ============================================================
   BASEMAP SWITCHER
   ============================================================ */
function setupBasemapSwitcher() {
  document.querySelectorAll('.basemap-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.basemap;
      if (name === currentBasemap) return;
      currentBasemap = name;
      document.querySelectorAll('.basemap-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchBasemap(name);
    });
  });
}

function switchBasemap(name) {
  map.setStyle(BASEMAPS[name]);
  map.once('style.load', () => {
    map.setProjection({ type: 'globe' });
    if (lastMapData && currentGeomCol) {
      rehydrateMapLayers();
      if (styleApplied) applyStyle(true); // re-apply style silently
    }
  });
}

function rehydrateMapLayers() {
  if (!lastMapData) return;
  const { geojsonFC, pts, lns, pols } = lastMapData;
  const empty = { type: 'FeatureCollection', features: [] };

  map.addSource('query-result', { type: 'geojson', data: geojsonFC });
  map.addSource('query-points-src', { type: 'geojson', data: pts });
  map.addSource('query-lines-src', { type: 'geojson', data: lns });
  map.addSource('query-polygons-src', { type: 'geojson', data: pols });
  map.addSource('selected-src', { type: 'geojson', data: empty });

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

/* ============================================================
   URL STATE SHARING
   ============================================================ */
function encodeStateToURL() {
  try {
    const state = {
      sql: editorView ? editorView.state.doc.toString() : '',
      style: { ...styleSettings }
    };
    const json = JSON.stringify(state);
    const encoded = btoa(unescape(encodeURIComponent(json)));
    return `${location.origin}${location.pathname}#state=${encoded}`;
  } catch (e) {
    console.warn('encodeStateToURL failed:', e);
    return location.href;
  }
}

function updateURL() {
  try {
    const state = {
      sql: editorView ? editorView.state.doc.toString() : '',
      style: { ...styleSettings }
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    history.replaceState(null, '', `#state=${encoded}`);
  } catch (e) { /* silently skip */ }
}

function peekURLSql() {
  // Parse URL hash, apply style settings, return the SQL string (or null)
  try {
    const hash = location.hash;
    if (!hash.startsWith('#state=')) return null;
    const encoded = hash.slice(7);
    const json = decodeURIComponent(escape(atob(encoded)));
    const state = JSON.parse(json);
    if (state.style) Object.assign(styleSettings, state.style);
    return state.sql || null;
  } catch (e) {
    console.warn('peekURLSql failed:', e);
    return null;
  }
}

function copyShareURL() {
  const url = encodeStateToURL();
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied to clipboard!');
  }).catch(() => {
    // Fallback for browsers without clipboard API
    prompt('Copy this link:', url);
  });
}

function showToast(msg) {
  const existing = document.querySelector('.share-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'share-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  // Trigger reflow then animate in
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* ============================================================
   MAP EXPORT — PNG
   ============================================================ */
function exportMapPNG() {
  showToast('Capturing map…');
  // rAF ensures we read the canvas after the current frame is painted.
  // preserveDrawingBuffer:true guarantees pixels survive between frames.
  requestAnimationFrame(() => {
    try {
      _captureMapPNG();
    } catch (e) {
      console.warn('Canvas tainted by CORS tiles:', e.message);
      _exportLegendOnlyPNG();
    }
  });
}

function _captureMapPNG() {
  const mapCanvas = map.getCanvas();
  const W = mapCanvas.width;
  const H = mapCanvas.height;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');

  // Draw map pixels (requires preserveDrawingBuffer:true + CORS-clean tiles)
  ctx.drawImage(mapCanvas, 0, 0);

  // Burn legend into composite canvas
  drawLegendOnCanvas(ctx, W, H);

  out.toBlob(blob => {
    if (!blob) { showToast('Export failed — try the Light basemap'); return; }
    _downloadBlob(blob, `map-${Date.now()}.png`);
    showToast('✓ Map exported as PNG');
  }, 'image/png');
}

function _exportLegendOnlyPNG() {
  // Fallback: dark background + legend only
  const W = 400, H = 300;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#6b8099';
  ctx.font = '10px monospace';
  ctx.fillText('MAP EXPORT — satellite/topo tiles blocked CORS', 12, 20);
  drawLegendOnCanvas(ctx, W, H);
  out.toBlob(blob => {
    _downloadBlob(blob, `legend-${Date.now()}.png`);
    showToast('Exported legend (switch to Light for full map PNG)');
  }, 'image/png');
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function drawLegendOnCanvas(ctx, W, H) {
  const mode = styleSettings.mode;
  if (!styleApplied) return;

  const PAD = 12;
  const ITEM_H = 20;
  const SWATCH = 14;
  const FONT = '11px JetBrains Mono, monospace';
  const FONT_S = '9px JetBrains Mono, monospace';

  let items = [];
  let title = '';

  if (mode === 'single') {
    title = 'All features';
    items = [{ color: styleSettings.singleColor, label: 'All features' }];
  } else if (mode === 'graduated' && styleSettings.col) {
    const values = currentRows.map(r => Number(r[styleSettings.col])).filter(v => isFinite(v));
    if (!values.length) return;
    const n = styleSettings.nClasses;
    const breaks = getBreaks(values, styleSettings.method, n);
    const ramp = interpolateRampToN(getRamp(), n);
    title = `${styleSettings.col} (${styleSettings.method})`;
    items = ramp.map((color, i) => ({
      color,
      label: `${fmtNum(breaks[i])} – ${i === n - 1 ? '' : '< '}${fmtNum(breaks[i + 1])}`
    }));
  } else if (mode === 'categorical' && styleSettings.col) {
    const unique = [...new Set(currentRows.map(r => r[styleSettings.col]).filter(v => v != null))].slice(0, 12);
    title = styleSettings.col;
    items = unique.map((val, i) => ({
      color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length],
      label: String(val).slice(0, 24)
    }));
  }

  if (!items.length) return;

  // Box dimensions
  ctx.font = FONT;
  const maxLabelW = Math.max(...items.map(it => ctx.measureText(it.label).width), ctx.measureText(title).width);
  const boxW = PAD * 2 + SWATCH + 8 + maxLabelW + 4;
  const boxH = PAD + 16 + items.length * ITEM_H + PAD;
  const bx = PAD;
  const by = H - boxH - 36; // above attribution bar

  // Background
  ctx.fillStyle = 'rgba(11,15,20,0.88)';
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fill();

  // Title
  ctx.fillStyle = '#6b8099';
  ctx.font = FONT_S;
  ctx.fillText(title.toUpperCase(), bx + PAD, by + PAD + 9);

  // Items
  items.forEach((item, i) => {
    const iy = by + PAD + 16 + i * ITEM_H;
    ctx.fillStyle = item.color;
    ctx.fillRect(bx + PAD, iy, SWATCH, SWATCH);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + PAD, iy, SWATCH, SWATCH);
    ctx.fillStyle = '#c9d4e0';
    ctx.font = FONT;
    ctx.fillText(item.label, bx + PAD + SWATCH + 8, iy + 11);
  });
}

/* ============================================================
   THEME MANAGEMENT
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('sse-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  // Saved preference wins; otherwise follow system
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme, false); // false = don't rebuild editor yet (not init'd)

  // Follow system changes only when user hasn't manually overridden
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('sse-theme')) {
      applyTheme(e.matches ? 'dark' : 'light', true);
    }
  });
}

function applyTheme(theme, rebuildEditor = true) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  // Update toggle button icon
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀' : '☾';
    btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  // Persist manual choice
  localStorage.setItem('sse-theme', theme);

  // Auto-switch basemap to match theme (only if on a light/dark basemap)
  if (map && (currentBasemap === 'light' || currentBasemap === 'dark')) {
    const targetBasemap = theme === 'dark' ? 'dark' : 'light';
    if (targetBasemap !== currentBasemap) {
      currentBasemap = targetBasemap;
      document.querySelectorAll('.basemap-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.basemap === currentBasemap);
      });
      switchBasemap(currentBasemap);
    }
  }

  // Rebuild editor with correct theme (preserves SQL text)
  if (rebuildEditor && editorView) updateEditorSchema();
}

/* ============================================================
   PANEL RESIZE
   ============================================================ */
function setupResizeHandles() {
  const app = document.getElementById('app');
  const leftHandle = document.getElementById('resize-left');
  const rightHandle = document.getElementById('resize-right');

  const MIN_WIDTH = 180;   // px — minimum panel width
  const MAX_WIDTH = 700;   // px — maximum panel width
  const HANDLE_W = 4;     // px — each handle column

  function getWidths() {
    const cols = getComputedStyle(app).gridTemplateColumns.split(' ');
    return {
      left: parseFloat(cols[0]),
      right: parseFloat(cols[4]),
    };
  }

  function setWidths(left, right) {
    app.style.gridTemplateColumns = `${left}px ${HANDLE_W}px 1fr ${HANDLE_W}px ${right}px`;
  }

  function makeDragger(handle, side) {
    let startX, startWidth;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      handle.classList.add('dragging');
      startX = e.clientX;
      startWidth = getWidths()[side];
      document.body.style.cursor = 'col-resize';
      // Prevent text selection during drag
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const delta = side === 'left'
          ? e.clientX - startX
          : startX - e.clientX;
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        const widths = getWidths();
        if (side === 'left') setWidths(newWidth, widths.right);
        else setWidths(widths.left, newWidth);
      }

      function onUp() {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Let MapLibre know the container size changed
        if (map) map.resize();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Double-click to reset to default
    handle.addEventListener('dblclick', () => {
      const widths = getWidths();
      if (side === 'left') setWidths(300, widths.right);
      else setWidths(widths.left, 400);
      if (map) map.resize();
    });
  }

  makeDragger(leftHandle, 'left');
  makeDragger(rightHandle, 'right');
}

/* ============================================================
   ENTRY POINT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();   // must run first — sets data-theme before anything renders
  injectPopupStyles();
  setupFileUpload();
  setupResizeHandles();
  document.getElementById('btn-demo').addEventListener('click', loadDemoData);
  document.getElementById('run-btn').addEventListener('click', runQuery);
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('export-geojson-btn').addEventListener('click', exportGeoJSON);
  document.getElementById('apply-style-btn').addEventListener('click', () => applyStyle(false));
  document.getElementById('share-url-btn').addEventListener('click', copyShareURL);
  document.getElementById('export-png-btn').addEventListener('click', exportMapPNG);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark', true);
  });
  document.getElementById('clear-session-btn').addEventListener('click', async () => {
    if (!confirm('Clear all saved tables and history from this browser?')) return;
    const tables = await idbGetAll('tables');
    for (const t of tables) await idbDelete('tables', t.name);
    await idbDelete('state', 'history');
    await idbDelete('state', 'lastQuery');
    location.hash = '';
    location.reload();
  });
  init();
});
