<script lang="ts">
  import { ViewerLayout, createViewerStore } from '@spatial-explorer/ui'
  import { createWebHostAdapter, provideFiles } from './hostAdapter.js'

  // Served from public/duckdb/ — see scripts/copy-duckdb-wasm.js.
  const duckdbAssets = { workerUrl: '/duckdb/duckdb-browser-eh.worker.js', wasmUrl: '/duckdb/duckdb-eh.wasm' }
  const hostAdapter = createWebHostAdapter()
  const store = createViewerStore(hostAdapter, duckdbAssets)

  let isDragOver = $state(false)

  function handleFiles(fileList: FileList): void {
    // Order matters: store.load() must run first so its internal
    // hostAdapter.openFiles() call registers its pending-resolve callback
    // (synchronously, inside the Promise executor, before load()'s first
    // `await` yields control back here) BEFORE provideFiles() tries to
    // resolve it. Calling provideFiles() first resolves nothing (no pending
    // callback registered yet) and load() then awaits a promise that never
    // resolves — a real bug caught via Playwright testing, not a platform
    // issue (see tasks.md T029/T030's notes).
    void store.load()
    provideFiles(Array.from(fileList))
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    isDragOver = false
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault()
    isDragOver = true
  }

  function handleDragLeave(): void {
    isDragOver = false
  }

  function handlePickerChange(e: Event): void {
    const input = e.target as HTMLInputElement
    if (input.files && input.files.length > 0) handleFiles(input.files)
  }
</script>

{#if store.session.loadState === 'idle'}
  <!-- Empty state (no file loaded yet) — distinct from a loaded zero-feature
       file, which reaches 'ready' and is rendered by ViewerLayout instead. -->
  <div
    class="empty-state"
    class:drag-over={isDragOver}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="region"
    aria-label="Drop a geospatial file here"
  >
    <p>Drag a geospatial file here</p>
    <p class="or">or</p>
    <label class="picker-button">
      Choose a file
      <input type="file" multiple onchange={handlePickerChange} style="display: none" />
    </label>
  </div>
{:else}
  <ViewerLayout session={store.session} onSelectFeature={(id) => store.selectFeature(id)} onCursorMove={(c) => store.setCursor(c)} />
{/if}

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 8px;
    border: 2px dashed #ccc;
    margin: 16px;
    border-radius: 8px;
    font-family: system-ui, sans-serif;
    color: #555;
    transition: background-color 0.15s;
  }
  .empty-state.drag-over {
    background-color: #eef6ff;
    border-color: #3388ff;
  }
  .or {
    font-size: 0.85em;
    color: #999;
  }
  .picker-button {
    padding: 8px 16px;
    background: #3388ff;
    color: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.95em;
  }
</style>
