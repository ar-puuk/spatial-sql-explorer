<script lang="ts">
  // Spec 010 phase 9 (T063): the files a query can name, beside the SQL
  // editor, as a folder tree. VS Code: the data files under the workspace
  // root; web: the open file and the files the user added. A click inserts
  // the file at the cursor, as a reader call (or `layer` for the open file).
  import type { WorkspaceFile } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    files: ReadonlyArray<WorkspaceFile>
    onInsert: (text: string) => void
    /** Web: files can be added (a picker, or dropped here). */
    onAdd?: (files?: File[]) => void
  }
  let { files, onInsert, onAdd }: Props = $props()

  const FILTER_FROM = 30
  const VIRTUAL_FROM = 200
  const ROW = 22
  let filter = $state('')
  let scrollTop = $state(0)
  let viewport = $state(0)
  let dragOver = $state(false)

  /** What a click inserts: the open file is `layer`; others are read by their format's reader. */
  function insertion(f: WorkspaceFile): string {
    if (f.open) return 'layer'
    const literal = `'${f.path.replace(/'/g, "''")}'`
    if (/\.(geo)?parquet$/i.test(f.path)) return `read_parquet(${literal})`
    if (/\.(csv|tsv)$/i.test(f.path)) return `read_csv_auto(${literal})`
    if (/\.xlsx$/i.test(f.path)) return `read_xlsx(${literal})`
    return `ST_Read(${literal})`
  }

  function size(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
    return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  }

  type Row = { kind: 'dir'; path: string } | { kind: 'file'; file: WorkspaceFile; name: string; depth: number }

  /** Folders, then their files, in path order (the folder of each file shown once). */
  const rows = $derived.by((): Row[] => {
    const q = filter.trim().toLowerCase()
    const shown = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files
    const out: Row[] = []
    let dir: string | null = null
    for (const f of [...shown].sort((a, b) => Number(!!b.open) - Number(!!a.open) || a.path.localeCompare(b.path))) {
      const slash = f.path.lastIndexOf('/')
      const d = slash < 0 ? '' : f.path.slice(0, slash)
      if (d && d !== dir && !f.open) out.push({ kind: 'dir', path: d })
      dir = f.open ? dir : d
      out.push({ kind: 'file', file: f, name: f.path.slice(slash + 1), depth: d && !f.open ? 1 : 0 })
    }
    return out
  })
  const virtual = $derived(rows.length > VIRTUAL_FROM)
  const first = $derived(virtual ? Math.max(0, Math.floor(scrollTop / ROW) - 8) : 0)
  const last = $derived(virtual ? Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW) + 8) : rows.length)

  function onDrop(e: DragEvent): void {
    dragOver = false
    if (!onAdd || !e.dataTransfer?.files.length) return
    e.preventDefault()
    e.stopPropagation()
    onAdd([...e.dataTransfer.files])
  }
</script>

<section
  class="workspace-files"
  class:drag-over={dragOver}
  aria-label="Files"
  ondragover={(e) => {
    if (!onAdd) return
    e.preventDefault()
    e.stopPropagation()
    dragOver = true
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
>
  <header>
    <h2>Files</h2>
    {#if onAdd}
      <button type="button" class="add" onclick={() => onAdd?.()}><Icon name="plus" size={12} />Add files…</button>
    {/if}
  </header>
  {#if files.length > FILTER_FROM}
    <label class="filter">
      <Icon name="search" size={12} />
      <input type="text" bind:value={filter} placeholder="Filter {files.length} files" aria-label="Filter files" autocomplete="off" spellcheck="false" />
    </label>
  {/if}
  <ul bind:clientHeight={viewport} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)} style:--row="{ROW}px">
    {#if virtual}<li class="pad" style:height="{first * ROW}px" aria-hidden="true"></li>{/if}
    {#each rows.slice(first, last) as row, i (row.kind === 'dir' ? `d:${row.path}` : `f:${row.file.path}:${first + i}`)}
      {#if row.kind === 'dir'}
        <li class="dir" title={row.path}><Icon name="chevron-down" size={12} /><span>{row.path}</span></li>
      {:else}
        <li>
          <button type="button" style:padding-left="{6 + row.depth * 14}px" title="Insert {insertion(row.file)} at the cursor" onclick={() => onInsert(insertion(row.file))}>
            <Icon name="file" size={14} />
            <span class="name">{row.name}</span>
            {#if row.file.open}<span class="layer">(layer)</span>{/if}
            <span class="size">{size(row.file.size)}</span>
          </button>
        </li>
      {/if}
    {/each}
    {#if virtual}<li class="pad" style:height="{(rows.length - last) * ROW}px" aria-hidden="true"></li>{/if}
    {#if !rows.length}
      <li class="empty">{files.length ? 'No file matches.' : onAdd ? 'Add files to query them with the open one.' : 'No other data files in this workspace.'}</li>
    {/if}
  </ul>
  <p class="hint">{onAdd ? 'Click a file to insert it. Drop files here to add them.' : 'Click a file to insert it. Paths are relative to the workspace root.'}</p>
</section>

<style>
  .workspace-files {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--se-bg-panel);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .workspace-files.drag-over {
    outline: 1px dashed var(--se-focus);
    outline-offset: -3px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 6px 6px 4px 10px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-link);
    font: inherit;
    font-size: 0.92em;
    cursor: pointer;
  }
  .add:hover {
    background: var(--se-bg-hover);
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 8px 4px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
  }
  .filter input {
    flex: 1;
    min-width: 0;
    height: 20px;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
  }
  ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 4px 4px;
    overflow: auto;
    list-style: none;
  }
  li {
    min-height: var(--row);
  }
  .pad {
    min-height: 0;
  }
  .dir {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--row);
    padding: 0 6px;
    color: var(--se-text-secondary);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  button:not(.add) {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: var(--row);
    padding: 0 6px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:not(.add):hover {
    background: var(--se-bg-hover);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  button :global(.icon) {
    color: var(--se-text-secondary);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .layer {
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 0.9em;
  }
  .size {
    margin-left: auto;
    flex: none;
    color: var(--se-text-muted);
    font-size: 0.88em;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    padding: 6px;
    color: var(--se-text-secondary);
  }
  .hint {
    flex: none;
    margin: 0;
    padding: 4px 10px 6px;
    color: var(--se-text-muted);
    font-size: 0.88em;
    line-height: 1.35;
  }
</style>
