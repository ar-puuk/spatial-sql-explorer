# Quickstart: validating Bin into cells

Prerequisites: `npm install`; the engine mirror filled (`node scripts/engine-assets.mjs --mirror`); Chrome installed.
Build from Git Bash with `MSYS_NO_PATHCONV=1 ENGINE_MIRROR=1 VITE_ENGINE_MIRROR=/engine-mirror npm run build --workspace=apps/web`.

1. **Core**: `npm run test:core` - the SQL builder, size tables, estimates and the default style.
2. **Browser**: start `npm run preview --workspace=apps/web -- --port <port>` (port 4173 may be held by another app), then from `tests/web`:
   `SE_BASE_URL=http://localhost:<port> npx playwright test -c playwright.chrome.config.ts specs/grid-cells-017.spec.ts`.
3. **By hand (web)**: open `apps/vscode-ext/fixtures/sample.geojson` or any point layer, choose Bin into cells, keep H3 and count, and move the
   resolution: the map redraws below 5,000 cells; the legend title reads "Number of features".
4. **Checks that prove the spec**: counts sum to the rows with a location (SC-2); A5 cells at 10 and 60 degrees north have equal area (SC-3);
   export GeoParquet and reopen it (SC-4); a layer across the date line draws without a world-wide polygon.
5. **VS Code**: `npm run test:vscode-ext` for the dialog smoke test; confirm no request reaches the a5 telemetry host.

See [contracts/bin-cells.md](./contracts/bin-cells.md) and [data-model.md](./data-model.md).
