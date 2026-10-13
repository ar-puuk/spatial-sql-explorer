<script lang="ts">
  // Spec 010 layout Option A (T050): the search box floating on the map's
  // top-left corner. It replaces the Search places button and popover; phase
  // 10 adds layer values and coordinates. Until then it is the place search
  // (shown only when the host allows it).
  import PlaceSearch from './PlaceSearch.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
  }
  let { store }: Props = $props()
</script>

<div class="search-box">
  <PlaceSearch {store} floating onClose={() => {}} />
</div>

<style>
  .search-box {
    pointer-events: auto;
  }
</style>
