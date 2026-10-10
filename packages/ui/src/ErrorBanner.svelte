<script lang="ts">
  interface Props {
    message: string | null
  }
  let { message }: Props = $props()
</script>

{#if message}
  <div class="error-banner" role="alert">
    <span aria-hidden="true">⚠</span>
    <span>{message}</span>
  </div>
{/if}

<style>
  .error-banner {
    padding: 8px 12px;
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    color: var(--vscode-foreground, #fff);
    display: flex;
    gap: 8px;
    align-items: center;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
  }
</style>
