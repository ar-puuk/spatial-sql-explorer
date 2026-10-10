<script lang="ts">
  import Icon from './Icon.svelte'

  interface Props {
    message: string | null
  }
  let { message }: Props = $props()
</script>

{#if message}
  <div class="banner" role="alert">
    <Icon name="error" />
    <span class="message">{message}</span>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    background: var(--se-error-bg);
    border-left: 3px solid var(--se-error);
    border-bottom: 1px solid var(--se-error-border);
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    line-height: 1.45;
  }
  .banner > :global(.icon) {
    margin-top: 1px;
    color: var(--se-error);
  }
  .message {
    font-family: var(--se-font-mono);
    font-size: 0.95em;
    overflow-wrap: anywhere;
    user-select: text;
  }
</style>
