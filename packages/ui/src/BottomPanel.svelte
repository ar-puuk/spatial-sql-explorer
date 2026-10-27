<script lang="ts">
  // Spec 010 layout Option A (T050): the bottom panel, VS Code's panel
  // pattern: a 35 px tab bar (Table, SQL) with actions on the right, and the
  // active tab's body. Both bodies stay mounted (the SQL editor keeps its
  // state); the inactive one is hidden. Arrow keys switch tabs.
  import type { Snippet } from 'svelte'
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'

  type Tab = string
  interface Props {
    tab: Tab
    onTab: (tab: Tab) => void
    /** Spec 027: other tabs than Table and SQL (a raster's profile and statistics); each body comes from `body(id)`. */
    tabs?: ReadonlyArray<{ id: string; label: string }>
    body?: Snippet<[string]>
    collapsed: boolean
    onToggleCollapsed: () => void
    maximized: boolean
    onToggleMaximized: () => void
    actions?: Snippet
    table?: Snippet
    sql?: Snippet
  }
  let { tab, onTab, tabs, body, collapsed, onToggleCollapsed, maximized, onToggleMaximized, actions, table, sql }: Props = $props()

  const TABS: ReadonlyArray<{ id: Tab; label: string }> = $derived(
    tabs ?? [
      { id: 'table', label: 'Table' },
      { id: 'sql', label: 'SQL' },
    ]
  )
  let bar = $state<HTMLDivElement>()

  function tabKeydown(e: KeyboardEvent): void {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.id === tab)
    const next = e.key === 'Home' ? TABS[0] : e.key === 'End' ? TABS[TABS.length - 1] : TABS[(i + dir + TABS.length) % TABS.length]
    onTab(next.id)
    void tick().then(() => bar?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus())
  }
</script>

<section class="bottom-panel" class:collapsed aria-label="Panel">
  <div class="tab-bar">
    <div class="tabs" role="tablist" aria-label="Panel views" bind:this={bar}>
      {#each TABS as t (t.id)}
        <button
          type="button"
          role="tab"
          id="panel-tab-{t.id}"
          data-tab={t.id}
          aria-selected={tab === t.id}
          aria-controls="panel-body-{t.id}"
          tabindex={tab === t.id ? 0 : -1}
          class:active={tab === t.id && !collapsed}
          onclick={() => onTab(t.id)}
          onkeydown={tabKeydown}
        >
          {t.label}
        </button>
      {/each}
    </div>
    <span class="spacer"></span>
    {@render actions?.()}
    <button
      type="button"
      class="icon-button"
      aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}
      title={maximized ? 'Restore panel size' : 'Maximize panel'}
      onclick={onToggleMaximized}
    >
      <Icon name={maximized ? 'restore' : 'maximize'} size={14} />
    </button>
    <button
      type="button"
      class="icon-button"
      aria-label={collapsed ? 'Show panel' : 'Hide panel'}
      title={collapsed ? 'Show panel' : 'Hide panel'}
      aria-expanded={!collapsed}
      onclick={onToggleCollapsed}
    >
      <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={14} />
    </button>
  </div>
  {#if tabs}
    {#each tabs as t (t.id)}
      <div class="body" id="panel-body-{t.id}" role="tabpanel" aria-labelledby="panel-tab-{t.id}" hidden={collapsed || tab !== t.id}>
        {@render body?.(t.id)}
      </div>
    {/each}
  {:else}
    <div class="body" id="panel-body-table" role="tabpanel" aria-labelledby="panel-tab-table" hidden={collapsed || tab !== 'table'}>
      {@render table?.()}
    </div>
    <div class="body" id="panel-body-sql" role="tabpanel" aria-labelledby="panel-tab-sql" hidden={collapsed || tab !== 'sql'}>
      {@render sql?.()}
    </div>
  {/if}
</section>

<style>
  .bottom-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--se-bg-base);
    color: var(--se-text-primary);
  }
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    height: 35px;
    padding: 0 8px 0 4px;
    background: var(--se-panel-tabs-bg, var(--se-bg-base));
    white-space: nowrap;
    position: relative;
    z-index: 3;
  }
  .tabs {
    display: flex;
    height: 100%;
  }
  [role='tab'] {
    position: relative;
    height: 100%;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--se-panel-tab-inactive-fg, var(--se-text-secondary));
    font: var(--se-tab-font, 11px var(--se-font-ui));
    text-transform: var(--se-tab-transform, uppercase);
    letter-spacing: var(--se-tab-tracking, 0.04em);
    cursor: pointer;
  }
  [role='tab']:hover,
  [role='tab'].active {
    color: var(--se-panel-tab-active-fg, var(--se-text-primary));
  }
  [role='tab'].active::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: var(--se-tab-underline-bottom, 4px);
    height: var(--se-tab-underline-height, 1px);
    background: var(--se-panel-tab-border, var(--se-accent));
  }
  [role='tab']:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -4px;
  }
  .spacer {
    flex: 1;
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .body[hidden] {
    display: none;
  }
</style>
