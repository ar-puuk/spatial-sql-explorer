// A guard on what the first paint downloads and parses: the JavaScript the entry chunk imports statically (the
// same idea as GeoLibre's boot-bundle budget). Code that only a dialog, a panel or a rare tool needs belongs in a
// dynamic import (packages/ui/src/lazy.svelte.ts); without a check, one static import quietly puts it back on the
// boot path and the app is just slower to start. Raise a budget (scripts/boot-budget.json) only after confirming the
// new eager code really belongs at start.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const BUDGETS = JSON.parse(readFileSync(fileURLToPath(new URL('./boot-budget.json', import.meta.url)), 'utf8'))

/** @param {'web' | 'webview'} app which budget in boot-budget.json applies */
export function bootBudget(app) {
  const budget = BUDGETS[app]
  return {
    name: 'spatial-explorer:boot-budget',
    apply: 'build',
    generateBundle(_, bundle) {
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry)
      if (!entry) this.error('Boot budget: no entry chunk found; update scripts/viteBootBudget.mjs.')
      const seen = new Set()
      const pending = [entry.fileName]
      let raw = 0
      let gzip = 0
      const sizes = []
      while (pending.length) {
        const name = pending.pop()
        if (seen.has(name)) continue
        seen.add(name)
        const chunk = bundle[name]
        if (chunk?.type !== 'chunk') continue
        const bytes = Buffer.byteLength(chunk.code)
        raw += bytes
        gzip += gzipSync(chunk.code, { level: 9 }).length
        sizes.push([name, bytes])
        pending.push(...chunk.imports)
      }
      const kb = (n) => `${(n / 1024).toFixed(0)} kB`
      const over = []
      if (raw > budget.rawBytes) over.push(`${kb(raw)} raw, over the ${kb(budget.rawBytes)} budget`)
      if (gzip > budget.gzipBytes) over.push(`${kb(gzip)} gzipped, over the ${kb(budget.gzipBytes)} budget`)
      if (over.length) {
        const largest = sizes.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, b]) => `  ${n} (${kb(b)})`)
        this.error(`Boot bundle too big for ${app}: ${over.join('; ')}.\nLargest chunks loaded at start:\n${largest.join('\n')}\nMove what is not needed at start behind a dynamic import (lazy.svelte.ts), or raise scripts/boot-budget.json on purpose.`)
      }
      this.info?.(`boot JS (${app}): ${kb(raw)} raw, ${kb(gzip)} gzipped`)
    },
  }
}
