# Contract: Query panel UI (FR-001, FR-004, FR-010, FR-011, FR-015–FR-017)

## Layout

The bottom drawer from spec 001 (resizable, collapsible) is split horizontally:

```text
┌──────────────────────────── map (unchanged: controls top-right, inspector top-left) ────────────────────────────┐
│                                                                                                                │
├────────────── sash (row-resize) ───────────────────────────────────────────────────────────────────────────────┤
│ QUERY  layer · EPSG:26912 · 22,000 rows      ▶ Run  ■ Cancel  ↺ Reset  ⏱ History │ ATTRIBUTES  1,000 rows · …  │
│ ┌──────────────────────────────────────────────┐                                     │ ┌──────────────────────┐  │
│ │ SELECT * FROM layer                          │                                     │ │  #  fid  zone  acres │  │
│ │ WHERE zone = 'R1'                            │                                     │ │  …                   │  │
│ │ LIMIT 1000                                   │                                     │ │                      │  │
│ └──────────────────────────────────────────────┘                                     │ └──────────────────────┘  │
│ ✓ 312 rows · 312 mapped · 84 ms   Result CRS: EPSG:26912 (layer) ▾                    │                           │
└──────────────────────────── sash (col-resize) between query and attributes ──────────────────────────────────────┘
```

- **Placement.** The query panel sits left of the attribute table, with a
  `col-resize` sash between them (same sash styling as spec 001). It is
  **collapsed to a header strip by default**, so spec 001's view is
  unchanged until the user opens it.
- **Opening it.** The `QUERY` header, the keyboard shortcut Ctrl/Cmd+Shift+Q,
  or a "Query" map control.
- **Narrow viewers** (< 720 px wide): query and attributes stack vertically
  instead of side by side.
- **Header contents.** The table name (`layer`, plus the alias if any) with
  its CRS and total rows (FR-002, FR-014). A small "?" links to the SQL
  dialect's documentation (in VS Code it opens externally).

## Controls

| Control | Behavior | Keyboard |
|---|---|---|
| Run | Runs the selection, or the statement at the cursor (FR-004). Disabled while a query runs. | Ctrl/Cmd+Enter (in the editor) |
| Cancel | Visible only while running or fetching (FR-009). | Esc (in the editor, while running) |
| Reset | Restores the default query, its result, the extent and the layer style (FR-011). The editor text is replaced only after a confirm, if it was edited. | |
| History | Popover listing the newest 20 entries with time and outcome. Enter or click loads the entry into the editor without running it (FR-016). | Arrow keys inside the list |
| Result CRS chip | Shows the resolved CRS and its source (`layer`, `detected`, `engine`, `override`); the dropdown takes an EPSG code or "same as layer". | |

## Status line (FR-010)

| State | Shown |
|---|---|
| Running | "Running… 1.2 s" with a live timer, plus the ProgressBar, plus Cancel. |
| Fetching rows | "Fetching 12,000 / 48,000 rows…" |
| Success (query) | "✓ 312 rows · 312 mapped · 84 ms". Table-only results: "✓ 12 rows · no geometry to map · 31 ms". |
| Success (temp DDL) | "✓ Created temp table `buffers` (1,204 rows) · 210 ms" |
| Error | `Binder Error` badge, the message, and hints. The error position gets a squiggle in the editor, plus a gutter marker (FR-008). The previous result stays. |
| Refused | ⛔ followed by the policy reason (contracts/statement-policy.md). |
| Cancelled | "Cancelled after 2.3 s" |

## Large-result dialog (FR-012)

A modal over the map pane, focus-trapped:

> "This query returned **1,204,551 rows**. Showing more than 50,000 may be
> slow or run out of memory."

with three buttons:
- **Show first 50,000** (the default button);
- **Show all**;
- **Cancel**.

## Editor (CodeMirror 6)

- **Features**: line numbers, SQL highlighting, bracket matching, undo
  history, and autocomplete. Completions cover the tables, views and
  columns, with types; the `ST_*` functions first, each with its signature
  and description in the info panel; and keywords (FR-015). No minimap and
  no folding.
- **Theme tokens**:

  | Token | VS Code value | Web value |
  |---|---|---|
  | `--se-sql-bg` / `-fg` / `-selection` / `-cursor` / `-gutter` | `--vscode-editor-*` | brand |
  | `--se-sql-keyword` / `-string` / `-number` / `-function` / `-operator` / `-comment` | `--vscode-symbolIcon-*` (research §6) | brand amber/navy palette |

- **Font**: the editor font (`--vscode-editor-font-family` and its size) in
  VS Code; JetBrains Mono on the web.
- **Accessibility**: the editor has `aria-label="SQL query"`. Tab moves focus
  out of the editor (the indent action is moved to Ctrl+]), so keyboard users
  are never trapped (Constitution VII). The status line is an `aria-live`
  polite region.
