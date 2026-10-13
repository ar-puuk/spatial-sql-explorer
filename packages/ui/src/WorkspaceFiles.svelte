<script lang="ts">
  // Spec 010 layout Option A (T050): the files a query can name, beside the
  // SQL editor. Phase 9 lists the workspace's files; for now it is the open
  // file, as the `layer` table. A click inserts the name at the cursor.
  import Icon from './Icon.svelte'

  interface Props {
    files: ReadonlyArray<{ name: string; sql: string; detail?: string }>
    onInsert: (text: string) => void
  }
  let { files, onInsert }: Props = $props()
</script>

<section class="workspace-files" aria-label="Files">
  <h2>Files</h2>
  <ul>
    {#each files as f (f.sql)}
      <li>
        <button type="button" title="Insert {f.sql} at the cursor" onclick={() => onInsert(f.sql)}>
          <Icon name="file" size={14} />
          <span class="name">{f.name}</span>
          {#if f.detail}<span class="detail">{f.detail}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
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
  h2 {
    flex: none;
    margin: 0;
    padding: 6px 10px 4px;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 4px 4px;
    overflow: auto;
    list-style: none;
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 22px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail {
    margin-left: auto;
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 0.9em;
  }
</style>
