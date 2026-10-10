<script lang="ts">
  // Visually distinct from ErrorBanner — a skipped-geometry count is a
  // successful load with a caveat (FR-014), not a failure.
  interface Props {
    invalidGeometryCount: number
  }
  let { invalidGeometryCount }: Props = $props()
</script>

{#if invalidGeometryCount > 0}
  <div class="warning-banner" role="status">
    <span aria-hidden="true">ℹ</span>
    <span>
      {invalidGeometryCount}
      {invalidGeometryCount === 1 ? 'invalid geometry was' : 'invalid geometries were'} skipped.
    </span>
  </div>
{/if}

<style>
  .warning-banner {
    padding: 6px 12px;
    background: var(--vscode-inputValidation-warningBackground, #5a4d1d);
    border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
    color: var(--vscode-foreground, #fff);
    display: flex;
    gap: 8px;
    align-items: center;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 0.9em;
  }
</style>
