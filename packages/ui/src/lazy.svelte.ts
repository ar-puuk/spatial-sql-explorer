/**
 * A component loaded on first use, so its code (and what only it imports: the SQL editor's CodeMirror, the print
 * composer, the dialogs) is not part of the bundle the first paint waits for. Render it as `<Thing.component … />`
 * (nothing is drawn until the chunk has arrived) and call `load()` when it may be needed; `load()` is cheap to repeat.
 * `component` is undefined until then, and stays after.
 */
export interface LazyComponent<C> {
  readonly component: C | undefined
  load(): Promise<void>
}

export function lazy<C>(importer: () => Promise<{ default: C }>): LazyComponent<C> {
  let component = $state.raw<C | undefined>(undefined)
  let loading: Promise<void> | null = null
  return {
    get component() {
      return component
    },
    load() {
      loading ??= importer().then(
        (m) => {
          component = m.default
        },
        (err) => {
          // A failed chunk (offline dev server, say) is tried again by the next call.
          loading = null
          throw err
        }
      )
      return loading
    },
  }
}
