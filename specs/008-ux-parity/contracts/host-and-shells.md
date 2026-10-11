# Contract: HostAdapter and shells (spec 008)

## HostAdapter changes (`packages/core/src/hostAdapter.ts`)

- `SaveOptions.kind` gains `'image'`. VS Code: a save dialog with a PNG
  filter, defaulting to `<basename>-map.png` next to the data. Web: a
  download.
- New optional method:
  ```ts
  getPreference?(key: 'placeSearch.enabled'): boolean | undefined
  ```
  Plus `onPreferenceChange?(cb): () => void`, called when a value changes.
  VS Code reads the `spatialExplorer.placeSearch.enabled` setting and
  reports changes through the existing `onThemeChange`-style messaging,
  re-reading on configuration change. Web: undefined, meaning enabled.
- `getTheme` and `onThemeChange` are unchanged in shape. The web shell now
  derives them from the theme preference (below).
- Data exports may stream large binary output (Shapefile zip, GeoPackage).
  `saveFile` already accepts `Uint8Array`; shells must accept up to the
  format caps without base64 inflation. VS Code already streams exports
  (spec 005).

## VS Code extension

- **Setting**: `spatialExplorer.placeSearch.enabled` (boolean, default
  `true`). Description: "Show the place search on the map. Searches send
  only the typed text to OpenStreetMap Nominatim."
- **Command**: `spatialExplorer.openSample` ("Spatial Explorer: Open Sample
  Data"). Opens `sample/us-counties.parquet` from the extension folder in
  the custom editor. It works with no workspace open.
- **`.gdb` folders**: `explorer/context` "Open in Spatial Explorer" when
  `explorerResourceIsFolder && resourceExtname == .gdb`. It shows an
  information message with the conversion hint (core's
  `UnsupportedFormatError` text) and a "Copy command" button.
- **CSP** additions:
  - `img-src`/`connect-src` for `https://server.arcgisonline.com`,
    `https://*.tile.opentopomap.org` and `https://tile.openstreetmap.org`;
  - `connect-src` for `https://nominatim.openstreetmap.org`;
  - `script-src`/`connect-src` for the bundled `sql-wasm.wasm` (an
    extension resource, `asWebviewUri`).
- **VSIX** includes `sample/` and `dist-webview/sqljs/sql-wasm.wasm`.

## Web shell

- **Theme**: a control in the header with System / Light / Dark (radio
  menu), stored via `saveState('theme')`.
  - `system` follows `matchMedia('(prefers-color-scheme: dark)')` live.
  - The shell sets `data-theme` on `<html>`; `theme.css` holds both token
    sets.
- **Try sample data**: a button in the empty state that fetches
  `/sample/us-counties.parquet` (same origin, bundled) and opens it as a
  `bytes` source named `us-counties.parquet`.
- **Copy link**: a header action (enabled when a file is open). It writes
  `location.origin + location.pathname + '#' + encodeShareState(…)` to the
  clipboard.
- **Opening `#v1=…`**:
  - with `source.kind === 'sample'`, opens the sample;
  - otherwise shows a banner: "This link shows a view of `<name>`. Choose
    that file to see it." with "Choose file";
  - after the file opens, applies layer, query, style, basemap, projection
    and view, in that order;
  - reports dropped or failed parts in one message;
  - a picked file whose name or size differs gets a warning, but still
    applies.
- **Assets**: `public/sqljs/sql-wasm.wasm` (copied from `node_modules` at
  build) and `public/sample/us-counties.parquet`.
