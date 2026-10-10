// Turns the engine catalog into CodeMirror completion (spec 002 FR-015).
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { SQLNamespace } from '@codemirror/lang-sql'
import type { CatalogSnapshot } from '@spatial-explorer/core'

/** Table -> columns, with each column's type shown next to it. */
export function schemaFromCatalog(catalog: CatalogSnapshot | null): SQLNamespace {
  const schema: Record<string, Completion[]> = {}
  for (const t of catalog?.tables ?? []) {
    schema[t.name] = t.columns.map((c) => ({ label: c.name, type: 'property', detail: c.type }))
  }
  return schema
}

/** Functions (spatial first, with signature and description) and keywords. */
export function functionSource(catalog: CatalogSnapshot | null): CompletionSource {
  const options: Completion[] = []
  for (const f of catalog?.functions ?? []) {
    options.push({
      label: f.name,
      type: 'function',
      detail: f.signatures[0]?.slice(f.name.length) ?? '',
      info: [f.description, f.signatures.join('\n')].filter(Boolean).join('\n\n'),
      boost: f.spatial ? 2 : 0,
      apply: f.name,
    })
  }
  for (const k of catalog?.keywords ?? []) options.push({ label: k, type: 'keyword', boost: -1 })
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    return { from: word.from, options, validFor: /^[A-Za-z0-9_]*$/ }
  }
}
