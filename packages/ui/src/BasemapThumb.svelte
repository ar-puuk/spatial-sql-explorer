<script lang="ts">
  // Spec 012: one basemap preview, filling its box (the parent sets the size).
  // A tile that fails to load falls back to the neutral tile. Tiles go with
  // the page's referrer, as the map's own do: OpenStreetMap's tile policy
  // blocks requests without one.
  import Icon from './Icon.svelte'
  import type { BasemapPreview } from './basemapPreviews.svelte.js'

  interface Props {
    preview: BasemapPreview
    /** Shown on the neutral tile when there is no image (the provider's name). */
    label?: string
    /** Small tiles (search results): no text, the key icon alone. */
    compact?: boolean
  }
  let { preview, label = '', compact = false }: Props = $props()

  let failed = $state<string | null>(null)
</script>

<span class="thumb" aria-hidden="true">
  {#if preview.kind === 'image' && failed !== preview.src}
    <img
      src={preview.src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      style:object-position={preview.x !== undefined ? `${Math.round(preview.x * 100)}% ${Math.round((preview.y ?? 0.5) * 100)}%` : undefined}
      onerror={() => (failed = preview.kind === 'image' ? preview.src : null)}
    />
  {:else if preview.kind === 'blank'}
    <span class="fill blank" class:custom={preview.color} style:background={preview.color ?? undefined}></span>
  {:else if preview.kind === 'key'}
    <span class="fill neutral"><Icon name="key" size={14} />{#if !compact}<span class="text">Needs key</span>{/if}</span>
  {:else}
    <span class="fill neutral">{#if !compact}<span class="text">{label}</span>{/if}</span>
  {/if}
</span>

<style>
  .thumb {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    background: var(--se-bg-hover);
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .fill {
    position: absolute;
    inset: 0;
  }
  .blank:not(.custom) {
    background: var(--se-map-bg);
  }
  .neutral {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 4px;
    color: var(--se-text-muted);
    font-size: 10.5px;
    text-align: center;
    line-height: 1.2;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>
