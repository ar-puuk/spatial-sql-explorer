/*
 * spatial-sql-explorer/js/app.js
 *
 * Professional client-side spatial SQL query application
 * - MapLibre GL for mapping
 * - CodeMirror 6 for SQL editing with syntax highlighting
 * - DuckDB WASM for query execution
 * - GeoJSON output visualization
 *
 * Inspired by geojson.io aesthetics and Kyle Walker's urbangis SQL explorer
 */

(function () {
  "use strict";

  // App namespace
  window._spatialSqlExplorer = window._spatialSqlExplorer || {};

  const app = window._spatialSqlExplorer;
  const log = (...args) => console.log("[spatial-sql-explorer]", ...args);
  const warn = (...args) => console.warn("[spatial-sql-explorer]", ...args);
  const error = (...args) => console.error("[spatial-sql-explorer]", ...args);

  // ========================================================================
  // UTILITIES
  // ========================================================================

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debounce(func, wait) {
    let timeout;
    const later = () => {
      clearTimeout(timeout);
      func();
    };
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function getFirstCoordinate(coords) {
    if (Array.isArray(coords[0])) {
      return getFirstCoordinate(coords[0]);
    }
    return coords; // [lng, lat]
  }

  function getPopupCoordinate(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    return getFirstCoordinate(geometry.coordinates);
  }

  function calculateGeoJSONBounds(geoJSON) {
    const bounds = {
      minLng: Infinity,
      minLat: Infinity,
      maxLng: -Infinity,
      maxLat: -Infinity,
    };

    function processCoordinates(coords) {
      if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
        // Nested array, recurse
        coords.forEach((c) => processCoordinates(c));
      } else if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
        // Array of coordinate pairs
        coords.forEach(([lng, lat]) => {
          if (isFinite(lng) && isFinite(lat)) {
            bounds.minLng = Math.min(bounds.minLng, lng);
            bounds.minLat = Math.min(bounds.minLat, lat);
            bounds.maxLng = Math.max(bounds.maxLng, lng);
            bounds.maxLat = Math.max(bounds.maxLat, lat);
          }
        });
      } else if (typeof coords[0] === "number") {
        // Single coordinate pair [lng, lat]
        if (isFinite(coords[0]) && isFinite(coords[1])) {
          bounds.minLng = Math.min(bounds.minLng, coords[0]);
          bounds.minLat = Math.min(bounds.minLat, coords[1]);
          bounds.maxLng = Math.max(bounds.maxLng, coords[0]);
          bounds.maxLat = Math.max(bounds.maxLat, coords[1]);
        }
      }
    }

    if (geoJSON.type === "FeatureCollection") {
      geoJSON.features.forEach((feature) => {
        if (feature.geometry && feature.geometry.coordinates) {
          processCoordinates(feature.geometry.coordinates);
        }
      });
    } else if (
      geoJSON.type === "Feature" &&
      geoJSON.geometry &&
      geoJSON.geometry.coordinates
    ) {
      processCoordinates(geoJSON.geometry.coordinates);
    } else if (geoJSON.coordinates) {
      processCoordinates(geoJSON.coordinates);
    }

    return bounds;
  }

  function createLayersForGeoJSON(map, sourceId, layerId, isDemoLayer = false) {
    const polygonColor = isDemoLayer ? "#3bb2d0" : "#0366d6";
    const lineColor = isDemoLayer ? "#3bb2d0" : "#0366d6";
    const pointColor = isDemoLayer ? "#3bb2d0" : "#0366d6";
    const pointRadius = isDemoLayer ? 8 : 6;
    const fillOpacity = isDemoLayer ? 0.3 : 0.2;

    const layerIds = [];

    // Polygon/MultiPolygon layers
    const fillLayerId = `${layerId}-fill`;
    const strokeLayerId = `${layerId}-stroke`;

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: "fill",
        source: sourceId,
        filter: [
          "in",
          ["geometry-type"],
          ["literal", ["Polygon", "MultiPolygon"]],
        ],
        paint: {
          "fill-color": polygonColor,
          "fill-opacity": fillOpacity,
        },
      });
      layerIds.push(fillLayerId);
    }

    if (!map.getLayer(strokeLayerId)) {
      map.addLayer({
        id: strokeLayerId,
        type: "line",
        source: sourceId,
        filter: [
          "in",
          ["geometry-type"],
          ["literal", ["Polygon", "MultiPolygon"]],
        ],
        paint: {
          "line-color": polygonColor,
          "line-width": 2,
        },
      });
      layerIds.push(strokeLayerId);
    }

    // LineString/MultiLineString layer
    const lineLayerId = `${layerId}-line`;
    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: "line",
        source: sourceId,
        filter: [
          "in",
          ["geometry-type"],
          ["literal", ["LineString", "MultiLineString"]],
        ],
        paint: {
          "line-color": lineColor,
          "line-width": 2,
        },
      });
      layerIds.push(lineLayerId);
    }

    // Point/MultiPoint layer
    const pointLayerId = `${layerId}-point`;
    if (!map.getLayer(pointLayerId)) {
      map.addLayer({
        id: pointLayerId,
        type: "circle",
        source: sourceId,
        filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
        paint: {
          "circle-radius": pointRadius,
          "circle-color": pointColor,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.85,
        },
      });
      layerIds.push(pointLayerId);
    }

    return layerIds;
  }

  // ========================================================================
  // DATABASE INITIALIZATION
  // ========================================================================

  async function initDuckDB() {
    try {
      if (app.db) {
        log("DuckDB already initialized");
        return app.db;
      }

      log("Initializing DuckDB...");

      // Get platform features
      const features = await window.duckdb_wasm.getPlatformFeatures();
      const logger = new window.duckdb_wasm.ConsoleLogger();

      // Create database instance
      const db = new window.duckdb_wasm.Database({
        logger,
      });

      // Get connection
      const conn = await db.connect();

      app.db = db;
      app.conn = conn;

      // Register demo GeoJSON data
      await registerDemoGeoJSON();

      log("DuckDB initialized successfully");
      return db;
    } catch (e) {
      error("Failed to initialize DuckDB:", e);
      throw e;
    }
  }

  async function registerDemoGeoJSON() {
    if (!app.conn) {
      warn("DuckDB connection not available");
      return;
    }

    try {
      log("Registering demo GeoJSON data...");

      const url = "data/demo.geojson";
      const resp = await fetch(url, { cache: "no-cache" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const geojson = await resp.json();

      if (!geojson.features || !Array.isArray(geojson.features)) {
        warn("Invalid GeoJSON structure");
        return;
      }

      // Convert GeoJSON features to table structure
      const features = geojson.features.map((feature, idx) => ({
        id: feature.properties?.id || idx,
        name: feature.properties?.name || null,
        confidence: feature.properties?.confidence || 0,
        longitude: feature.geometry?.coordinates?.[0] || null,
        latitude: feature.geometry?.coordinates?.[1] || null,
        geometry_type: feature.geometry?.type || null,
      }));

      // Create table and insert data
      const conn = app.conn;

      // Drop table if exists
      try {
        await conn.query("DROP TABLE IF EXISTS demo_features");
      } catch (e) {
        // Ignore error if table doesn't exist
      }

      // Create table
      await conn.query(`
        CREATE TABLE demo_features (
          id INTEGER,
          name VARCHAR,
          confidence DOUBLE,
          longitude DOUBLE,
          latitude DOUBLE,
          geometry_type VARCHAR
        )
      `);

      // Insert data using parameterized inserts
      for (const feature of features) {
        await conn.query(
          `INSERT INTO demo_features VALUES (?, ?, ?, ?, ?, ?)`,
          [
            feature.id,
            feature.name,
            feature.confidence,
            feature.longitude,
            feature.latitude,
            feature.geometry_type,
          ],
        );
      }

      log(`Registered ${features.length} demo features in DuckDB`);
    } catch (e) {
      error("Failed to register demo GeoJSON:", e);
    }
  }

  // ========================================================================
  // EDITOR INITIALIZATION
  // ========================================================================

  let editorView = null;

  async function initEditor() {
    const editorContainer = document.getElementById("cm-editor");
    if (!editorContainer) {
      warn("Editor container not found");
      return null;
    }

    if (!window.CodeMirrorModules) {
      warn("CodeMirror modules not loaded");
      return null;
    }

    const {
      EditorState,
      EditorView,
      keymap,
      lineNumbers,
      highlightActiveLineGutter,
      foldGutter,
      indentOnInput,
      defaultKeymap,
      history,
      historyKeymap,
      indentWithTab,
      searchKeymap,
      sql,
      syntaxHighlighting,
      defaultHighlightStyle,
      bracketMatching,
      foldKeymap,
      autocompletion,
      completionKeymap,
    } = window.CodeMirrorModules;

    // Initial SQL query (example)
    const initialSQL = `-- Welcome to Spatial SQL Explorer
-- Write SQL queries to explore spatial data

SELECT * FROM demo_features LIMIT 10;`;

    // Custom keyboard shortcut to run query (Ctrl+Enter)
    const runQueryKeymap = [
      {
        key: "Ctrl-Enter",
        run: () => {
          runQuery();
          return true;
        },
      },
      {
        key: "Cmd-Enter",
        run: () => {
          runQuery();
          return true;
        },
      },
    ];

    // Create editor state with extensions
    const editorState = EditorState.create({
      doc: initialSQL,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle),
        sql(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...searchKeymap,
          indentWithTab,
          ...runQueryKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            updateEditorStatus(update.view);
          }
        }),
      ],
    });

    // Create editor view
    editorView = new EditorView({
      state: editorState,
      parent: editorContainer,
    });

    app.editor = editorView;
    updateEditorStatus(editorView);
    log("CodeMirror editor initialized");
    return editorView;
  }

  function updateEditorStatus(editor) {
    const doc = editor.state.doc;
    const charCount = doc.length;
    const lineCount = doc.lines;

    const charEl = document.getElementById("char-count");
    const lineEl = document.getElementById("line-count");

    if (charEl) charEl.textContent = `${charCount} chars`;
    if (lineEl)
      lineEl.textContent = `${lineCount} line${lineCount !== 1 ? "s" : ""}`;
  }

  function getEditorContent() {
    if (!editorView) return "";
    return editorView.state.doc.toString();
  }

  function setEditorContent(content) {
    if (!editorView) return;
    const view = editorView;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    });
    view.focus();
  }

  // ========================================================================
  // QUERY HISTORY MANAGEMENT
  // ========================================================================

  const QueryHistory = {
    items: [],
    maxItems: 20,

    add(query) {
      if (!query.trim()) return;
      const trimmed = query.trim();
      // Remove duplicate if exists
      this.items = this.items.filter((q) => q !== trimmed);
      // Add to front
      this.items.unshift(trimmed);
      // Trim to max
      if (this.items.length > this.maxItems) {
        this.items = this.items.slice(0, this.maxItems);
      }
      this.save();
      this.render();
    },

    save() {
      try {
        localStorage.setItem(
          "spatial-sql-explorer-history",
          JSON.stringify(this.items),
        );
      } catch (e) {
        warn("Failed to save history:", e);
      }
    },

    load() {
      try {
        const saved = localStorage.getItem("spatial-sql-explorer-history");
        if (saved) {
          this.items = JSON.parse(saved);
        }
      } catch (e) {
        warn("Failed to load history:", e);
      }
    },

    render() {
      const historyList = document.getElementById("editor-history");
      if (!historyList) return;

      historyList.innerHTML = "";

      if (this.items.length === 0) {
        historyList.innerHTML =
          '<div style="padding: 12px; color: #999; text-align: center; font-size: 11px;">No history</div>';
        return;
      }

      this.items.forEach((query) => {
        const div = document.createElement("div");
        div.title = query;
        div.textContent = query.substring(0, 60);
        if (query.length > 60) div.textContent += "…";
        div.onclick = () => {
          setEditorContent(query);
        };
        historyList.appendChild(div);
      });
    },
  };

  QueryHistory.load();

  // ========================================================================
  // RESULTS DISPLAY
  // ========================================================================

  function displayResults(data, rowCount, executionTime) {
    const resultsContainer = document.getElementById("results-container");
    const outputPlaceholder = document.getElementById("output-placeholder");
    const resultCount = document.getElementById("result-count");
    const queryTime = document.getElementById("query-time");

    if (!resultsContainer) return;

    // Update status
    if (resultCount)
      resultCount.textContent = `${rowCount} result${rowCount !== 1 ? "s" : ""}`;
    if (queryTime) queryTime.textContent = `${executionTime.toFixed(2)}ms`;

    if (!data || data.length === 0) {
      resultsContainer.innerHTML =
        '<div class="output-placeholder"><p>No results</p></div>';
      if (outputPlaceholder) outputPlaceholder.style.display = "none";
      return;
    }

    // Hide placeholder and show results
    if (outputPlaceholder) outputPlaceholder.style.display = "none";

    // Create results table
    const table = document.createElement("table");
    table.className = "results-table";

    // Header row
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    const columns = Object.keys(data[0]);
    columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Data rows
    const tbody = document.createElement("tbody");
    data.slice(0, 100).forEach((row) => {
      const tr = document.createElement("tr");
      columns.forEach((col) => {
        const td = document.createElement("td");
        const value = row[col];
        if (value === null || value === undefined) {
          td.textContent = "null";
          td.style.color = "#999";
        } else if (typeof value === "object") {
          td.textContent = JSON.stringify(value).substring(0, 50);
        } else {
          td.textContent = String(value).substring(0, 100);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    resultsContainer.innerHTML = "";
    resultsContainer.appendChild(table);
  }

  function displayError(errorMessage) {
    const resultsContainer = document.getElementById("results-container");
    const outputPlaceholder = document.getElementById("output-placeholder");

    if (!resultsContainer) return;

    if (outputPlaceholder) outputPlaceholder.style.display = "none";

    const errorDiv = document.createElement("div");
    errorDiv.className = "error-message";
    errorDiv.textContent = errorMessage;

    resultsContainer.innerHTML = "";
    resultsContainer.appendChild(errorDiv);
  }

  // ========================================================================
  // QUERY EXECUTION WITH DUCKDB
  // ========================================================================

  async function runQuery() {
    if (!editorView) {
      warn("Editor not initialized");
      return;
    }

    const query = getEditorContent();
    if (!query.trim()) {
      displayError("Please enter a query");
      return;
    }

    log("Running query:", query);

    // Add to history
    QueryHistory.add(query);

    // Disable run button
    const runBtn = document.getElementById("run-query-btn");
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = "⏳ Running...";
    }

    try {
      const startTime = performance.now();

      // Initialize DuckDB if not already done
      if (!app.db) {
        await initDuckDB();
      }

      // Get connection
      const conn = app.conn;

      // Execute query
      const result = await conn.query(query);

      // Convert result to array of objects
      const rows = [];
      for (const row of result) {
        rows.push(Object.fromEntries(row));
      }

      const endTime = performance.now();
      const executionTime = endTime - startTime;

      displayResults(rows, rows.length, executionTime);
      log(
        `Query executed successfully: ${rows.length} rows (${executionTime.toFixed(2)}ms)`,
      );

      // Visualize results on map if they have geographic coordinates
      visualizeQueryResults(rows);
    } catch (e) {
      const errorMsg = e.message || String(e);
      error("Query execution failed:", e);
      displayError(`Error: ${errorMsg}`);
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.innerHTML = '<span class="btn-icon">▶</span> Run Query';
      }
    }
  }

  // ========================================================================
  // MAP VISUALIZATION
  // ========================================================================

  function visualizeQueryResults(rows) {
    if (!app.map || !rows || rows.length === 0) return;

    try {
      // Check if rows have geometry column or lat/lng coordinates
      const hasGeometry = rows.some((row) => {
        return (
          row.geometry ||
          row.geom ||
          row.wkb_geometry ||
          row.latitude ||
          row.lat ||
          row.longitude ||
          row.lon ||
          row.lng
        );
      });

      if (!hasGeometry) {
        log("Query results do not contain geographic data");
        return;
      }

      // Convert rows to GeoJSON features
      const features = rows
        .filter((row) => {
          // Check for geometry column
          if (row.geometry || row.geom || row.wkb_geometry) {
            return true;
          }
          // Check for lat/lng coordinates
          const lat = row.latitude || row.lat;
          const lon = row.longitude || row.lon || row.lng;
          return lat !== null && lon !== null && isFinite(lat) && isFinite(lon);
        })
        .map((row) => {
          // If row has a geometry column, use it
          if (row.geometry) {
            return {
              type: "Feature",
              geometry: row.geometry,
              properties: row,
            };
          }

          // If row has alternative geometry column names
          if (row.geom) {
            return {
              type: "Feature",
              geometry: row.geom,
              properties: row,
            };
          }

          if (row.wkb_geometry) {
            return {
              type: "Feature",
              geometry: row.wkb_geometry,
              properties: row,
            };
          }

          // Otherwise, construct from lat/lng coordinates
          const lat = row.latitude || row.lat;
          const lon = row.longitude || row.lon || row.lng;
          return {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [lon, lat],
            },
            properties: row,
          };
        });

      if (features.length === 0) {
        warn("No valid geographic data found in results");
        return;
      }

      // Create GeoJSON feature collection
      const geojson = {
        type: "FeatureCollection",
        features,
      };

      // Update or create source and layer
      const sourceId = "query-results-source";
      const layerId = "query-results-layer";

      if (app.map.getSource(sourceId)) {
        app.map.getSource(sourceId).setData(geojson);
      } else {
        app.map.addSource(sourceId, { type: "geojson", data: geojson });

        // Create layers for all geometry types
        const layerIds = createLayersForGeoJSON(
          app.map,
          sourceId,
          layerId,
          false,
        );

        // Add popup on click
        const popup = new window.maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
        });

        layerIds.forEach((lid) => {
          // Add hover effect
          app.map.on("mouseenter", lid, () => {
            app.map.getCanvas().style.cursor = "pointer";
          });
          app.map.on("mouseleave", lid, () => {
            app.map.getCanvas().style.cursor = "";
          });

          app.map.on("click", lid, (evt) => {
            const queriedFeatures = app.map.queryRenderedFeatures(evt.point, {
              layers: [lid],
            });
            if (!queriedFeatures || !queriedFeatures.length) return;

            const f = queriedFeatures[0];
            const props = f.properties || {};
            const lnglat = getPopupCoordinate(f.geometry) || evt.lngLat;

            let popupHtml = '<div style="font-size:12px">';
            Object.entries(props).forEach(([key, value]) => {
              // Skip coordinate fields
              if (
                !["latitude", "lat", "longitude", "lon", "lng"].includes(key)
              ) {
                const displayValue =
                  value === null ? "null" : escapeHtml(String(value));
                popupHtml += `<strong>${escapeHtml(key)}:</strong> ${displayValue}<br/>`;
              }
            });
            popupHtml += "</div>";

            popup.setLngLat(lnglat).setHTML(popupHtml).addTo(app.map);
          });
        });
      }

      // Fit map bounds to query results
      const bounds = calculateGeoJSONBounds(geojson);

      if (
        isFinite(bounds.minLng) &&
        isFinite(bounds.minLat) &&
        isFinite(bounds.maxLng) &&
        isFinite(bounds.maxLat)
      ) {
        app.map.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          { padding: 50, animate: true },
        );
      }

      log(`Visualized ${features.length} query results on map`);
    } catch (e) {
      warn("Failed to visualize query results on map:", e);
    }
  }

  // ========================================================================
  // MAP INITIALIZATION
  // ========================================================================

  async function initMap() {
    log("initMap: Checking for maplibregl...");

    if (typeof window.maplibregl === "undefined") {
      error("maplibregl is not defined - library may not have loaded");
      displayError("MapLibre GL library failed to load");
      return;
    }

    log("initMap: maplibregl found");

    const mapEl = document.getElementById("map");
    if (!mapEl) {
      error("#map element not found in DOM");
      displayError("Map container element not found");
      return;
    }

    // Wait for map container to have proper dimensions
    let attempts = 0;
    while (
      (mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0) &&
      attempts < 50
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
    }

    if (mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0) {
      error(
        `Map container has invalid dimensions: ${mapEl.offsetWidth}x${mapEl.offsetHeight}`,
      );
      displayError("Map container is not properly sized");
      return;
    }

    log(
      `initMap: Map element ready, size: ${mapEl.offsetWidth}x${mapEl.offsetHeight}px`,
    );

    try {
      const styleUrl =
        "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

      log("initMap: Creating MapLibre instance with Carto Voyager...");

      const map = new window.maplibregl.Map({
        container: "map",
        style: styleUrl,
        center: [0, 0],
        zoom: 1,
        attributionControl: true,
      });

      app.map = map;
      log("initMap: Map instance stored in app.map");

      // Add navigation control
      const nav = new window.maplibregl.NavigationControl({
        visualizePitch: true,
      });
      map.addControl(nav, "top-right");
      log("initMap: Navigation control added");

      map.on("load", () => {
        log("initMap: Map load event fired");
        loadDemoGeoJSON(map).catch((e) => {
          error("Failed to load demo GeoJSON:", e);
          warn("Demo GeoJSON load error:", e);
        });
      });

      map.on("error", (e) => {
        error("Map error event:", e);
        warn("Map error:", e);
      });

      map.on("style.load", () => {
        log("initMap: Style loaded, applying globe projection and sky...");

        try {
          map.setProjection("globe");
          log("initMap: Globe projection applied");
        } catch (e) {
          warn("initMap: Could not set globe projection:", e);
        }

        try {
          map.setSky({
            "sky-type": "atmosphere",
            "sky-atmosphere-sun": [0, 0],
            "sky-atmosphere-sun-intensity": 0.5,
          });
          log("initMap: Neutral sky applied");
        } catch (e) {
          warn("initMap: Could not set sky:", e);
        }
      });

      log("Map initialized successfully");
      return map;
    } catch (e) {
      error("Failed to initialize map:", e);
      displayError(`Map initialization failed: ${e.message}`);
      return;
    }
  }

  async function loadDemoGeoJSON(map) {
    const url = "data/demo.geojson";
    try {
      const resp = await fetch(url, { cache: "no-cache" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const geojson = await resp.json();

      const srcId = "demo-src";
      if (map.getSource(srcId)) {
        map.getSource(srcId).setData(geojson);
      } else {
        map.addSource(srcId, { type: "geojson", data: geojson });
      }

      const layerId = "demo-layer";
      const layerIds = createLayersForGeoJSON(map, srcId, layerId, true);

      // Fit map to GeoJSON bounds
      const bounds = calculateGeoJSONBounds(geojson);
      if (bounds) {
        map.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          { padding: 50, animate: true },
        );
        log(
          `Map fitted to GeoJSON bounds: ${bounds.minLng.toFixed(4)}, ${bounds.minLat.toFixed(4)}, ${bounds.maxLng.toFixed(4)}, ${bounds.maxLat.toFixed(4)}`,
        );
      }

      // Popup handler
      const popup = new window.maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
      });

      // Add popup handler to all layer types
      layerIds.forEach((lid) => {
        map.on("click", lid, (evt) => {
          const feats = map.queryRenderedFeatures(evt.point, {
            layers: [lid],
          });
          if (!feats || !feats.length) return;

          const f = feats[0];
          const props = f.properties || {};
          const lnglat = getPopupCoordinate(f.geometry) || evt.lngLat;

          let popupHtml = '<div style="font-size:12px">';
          popupHtml += `<strong>${escapeHtml(props.name || "Feature")}</strong><br/>`;
          Object.entries(props).forEach(([key, value]) => {
            const displayValue =
              value === null ? "null" : escapeHtml(String(value));
            popupHtml += `<strong>${escapeHtml(key)}:</strong> ${displayValue}<br/>`;
          });
          popupHtml += "</div>";

          popup.setLngLat(lnglat).setHTML(popupHtml).addTo(map);
        });

        map.on(
          "mouseenter",
          lid,
          () => (map.getCanvas().style.cursor = "pointer"),
        );
        map.on("mouseleave", lid, () => (map.getCanvas().style.cursor = ""));
      });

      log("Demo GeoJSON loaded successfully");
    } catch (e) {
      warn("Failed to load demo GeoJSON:", e);
      throw e;
    }
  }

  // ========================================================================
  // UI EVENT HANDLERS
  // ========================================================================

  function setupEventHandlers() {
    // Run query button
    const runBtn = document.getElementById("run-query-btn");
    if (runBtn) {
      runBtn.addEventListener("click", runQuery);
    }

    // Clear editor button
    const clearBtn = document.getElementById("clear-editor-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        setEditorContent("");
      });
    }

    // Export GeoJSON button
    const exportBtn = document.getElementById("export-geojson-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        alert("Export functionality coming soon");
      });
    }
  }

  // ========================================================================
  // BOOTSTRAP
  // ========================================================================

  async function bootstrap() {
    log("========== Spatial SQL Explorer Bootstrap Started ==========");

    // Wait for CodeMirror modules to load
    log("bootstrap: Waiting for CodeMirror modules...");
    let attempts = 0;
    const maxAttempts = 60; // 6 seconds total
    while (!window.CodeMirrorModules && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (!window.CodeMirrorModules) {
      const errMsg = window.CodeMirrorModulesError
        ? `CodeMirror error: ${window.CodeMirrorModulesError.message}`
        : "CodeMirror modules failed to load after 6 seconds";
      error(`❌ ${errMsg}`);
      displayError(`Failed to load editor: ${errMsg}`);
      return;
    }

    log(`✓ CodeMirror modules loaded after ${attempts * 100}ms`);

    // Wait for MapLibre GL to load
    log("bootstrap: Waiting for MapLibre GL...");
    attempts = 0;
    while (!window.maplibregl && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (!window.maplibregl) {
      error("❌ MapLibre GL failed to load after 6 seconds");
      displayError(
        "Failed to load mapping library. Check browser console for details.",
      );
      return;
    }

    log(`✓ MapLibre GL loaded after ${attempts * 100}ms`);

    log("bootstrap: All dependencies loaded. Starting initialization...");

    try {
      // Initialize map first (before editor) since map doesn't depend on CodeMirror
      log("→ Initializing map...");
      await initMap();
      log("✓ Map initialized");

      // Initialize editor
      log("→ Initializing editor...");
      await initEditor();
      log("✓ Editor initialized");

      // Setup event handlers
      log("→ Setting up event handlers...");
      setupEventHandlers();
      log("✓ Event handlers ready");

      // Initialize DuckDB (non-blocking - app works without it)
      log("→ Initializing database...");
      (async () => {
        try {
          await initDuckDB();
          log("✓ Database initialized");
        } catch (e) {
          error(`⚠ Database initialization failed: ${e.message}`);
          warn("App will continue without database functionality");
        }
      })();

      log("========== ✓ Application Ready ==========");
    } catch (e) {
      error(`❌ Bootstrap failed: ${e.message}`);
      error("Error stack:", e.stack);
      displayError(`Application failed to initialize: ${e.message}`);
    }
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      // Use requestAnimationFrame to ensure layout has been computed
      requestAnimationFrame(() => {
        bootstrap();
      });
    });
  } else {
    // Use requestAnimationFrame to ensure layout has been computed
    requestAnimationFrame(() => {
      bootstrap();
    });
  }
})();
