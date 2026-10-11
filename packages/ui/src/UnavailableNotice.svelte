<script lang="ts">
  // Spec 007 FR-009a: a pillar that doesn't apply to this data (a PMTiles
  // archive holds map tiles, not a table) says why, in place of its content.
  import Icon from './Icon.svelte'

  interface Props {
    text: string
  }
  let { text }: Props = $props()
</script>

<p class="unavailable" role="status"><Icon name="info" size={14} /><span>{text}</span></p>

<style>
  .unavailable {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 6px 8px;
    color: var(--se-text-secondary);
    border-bottom: 1px solid var(--se-border);
  }
</style>
