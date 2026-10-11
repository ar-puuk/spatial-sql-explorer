<script lang="ts">
  // Spec 007 T044 (data-model.md, UI states): a FlatGeobuf read in parts
  // draws the map from its spatial index, but whole-file work (queries, the
  // table, thematic styles, export) waits until the user loads it. One notice
  // with one action, wherever that work would start.
  interface Props {
    sizeLabel: string
    /** What loading enables, completing "Load the whole file (…) to …". */
    purpose?: string
    onLoad: () => void
  }
  let { sizeLabel, purpose = 'query it', onLoad }: Props = $props()
</script>

<div class="load-whole" role="status">
  <span>Load the whole file ({sizeLabel}) to {purpose}.</span>
  <button type="button" class="primary" onclick={onLoad}>Load</button>
</div>

<style>
  .load-whole {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    color: var(--se-text);
    background: color-mix(in srgb, var(--se-accent) 10%, var(--se-bg-base));
    border-bottom: 1px solid var(--se-border);
  }
  span {
    flex: 1;
  }
  button {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--se-button-hover);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
