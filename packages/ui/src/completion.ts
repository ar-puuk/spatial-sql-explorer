// Turns the engine catalog into CodeMirror completion (spec 002 FR-015).
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { SQLNamespace } from '@codemirror/lang-sql'
import type { CatalogSnapshot } from '@spatial-explorer/core'

/** Table -> columns, with each column's type shown next to it; a multi-layer file's layers under its schema. */
export function schemaFromCatalog(catalog: CatalogSnapshot | null): SQLNamespace {
  const schema: Record<string, Completion[] | Record<string, Completion[]>> = {}
  for (const t of catalog?.tables ?? []) {
    const columns = t.columns.map((c) => ({ label: c.name, type: 'property', detail: c.type }))
    if (!t.schema) schema[t.name] = columns
    else {
      const inner = schema[t.schema]
      const layers = inner && !Array.isArray(inner) ? inner : (schema[t.schema] = {})
      layers[t.name] = columns
    }
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

/**
 * Spec 010 phase 9: inside a string literal, the data files a query can name
 * (workspace paths in VS Code, added files on the web).
 */
export function pathSource(files: ReadonlyArray<{ path: string; open?: boolean }>): CompletionSource {
  const options: Completion[] = files.filter((f) => !f.open).map((f) => ({ label: f.path, type: 'text', apply: f.path.replace(/'/g, "''") }))
  return (ctx: CompletionContext): CompletionResult | null => {
    if (!options.length) return null
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = line.text.slice(0, ctx.pos - line.from)
    // An odd number of quotes before the cursor: inside a literal ('' escapes count twice).
    if ((before.match(/'/g)?.length ?? 0) % 2 === 0) return null
    const open = before.lastIndexOf("'")
    return { from: line.from + open + 1, options, validFor: /^[^'\n]*$/ }
  }
}
