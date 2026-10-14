<script lang="ts">
  // The options of a column picker: each column's type as a short, muted
  // symbol in front of its name in the open list (the full type is in the
  // tooltip). The <select> stays native. The symbol is CSS (`data-type`, drawn
  // by the column-select rules in LayerStylePanel with `appearance:
  // base-select`), so the closed picker shows just the name, and browsers
  // without a customizable select show plain names.
  import { columnTypeSymbol } from './columnType.js'

  interface Props {
    columns: ReadonlyArray<{ name: string; type: string }>
  }
  let { columns }: Props = $props()
</script>

{#each columns as c (c.name)}
  {@const t = columnTypeSymbol(c.type)}
  <option value={c.name} data-type={t.text} data-icon={t.icon} title={`${c.name} · ${c.type} (${t.name.toLowerCase()})`}>{c.name}</option>
{/each}
