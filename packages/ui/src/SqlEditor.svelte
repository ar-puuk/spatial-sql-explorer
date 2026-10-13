<script lang="ts">
  // CodeMirror 6 SQL editor (spec 002, research §6; contracts/ui-query-panel.md).
  // Every color comes from the --se-sql-* tokens, so it follows the VS Code
  // theme (including high contrast) and the web brand palette without any
  // per-host code. No workers and no injected stylesheets: works under the
  // webview CSP as-is.
  import { onDestroy, onMount } from 'svelte'
  import { EditorState, Compartment } from '@codemirror/state'
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder } from '@codemirror/view'
  import { defaultKeymap, history, historyKeymap, indentMore } from '@codemirror/commands'
  import { bracketMatching, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
  import { autocompletion, closeCompletion, completionKeymap, type CompletionSource } from '@codemirror/autocomplete'
  import { sql, StandardSQL, schemaCompletionSource, type SQLNamespace } from '@codemirror/lang-sql'
  import { linter, lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
  import { tags } from '@lezer/highlight'

  interface Props {
    value: string
    onChange: (value: string) => void
    /** Ctrl/Cmd+Enter. Receives the current selection. */
    onRun: (selection: { from: number; to: number }) => void
    /** Esc while a query runs. */
    onCancel?: () => void
    running?: boolean
    diagnostics?: Diagnostic[]
    /** Table -> columns for completion (FR-015). */
    schema?: SQLNamespace
    completionSources?: CompletionSource[]
  }
  let { value, onChange, onRun, onCancel, running = false, diagnostics = [], schema = {}, completionSources = [] }: Props = $props()

  let host: HTMLDivElement
  let view: EditorView | null = null
  const language = new Compartment()
  const completion = new Compartment()

  const highlight = HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--se-sql-keyword)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--se-sql-string)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--se-sql-number)' },
    { tag: [tags.function(tags.variableName), tags.standard(tags.name)], color: 'var(--se-sql-function)' },
    { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--se-sql-operator)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--se-sql-comment)', fontStyle: 'italic' },
    { tag: [tags.typeName, tags.special(tags.name)], color: 'var(--se-sql-number)' },
  ])

  const theme = EditorView.theme({
    '&': {
      height: '100%',
      color: 'var(--se-sql-fg)',
      backgroundColor: 'var(--se-sql-bg)',
      fontSize: 'var(--se-sql-font-size)',
    },
    '.cm-scroller': { fontFamily: 'var(--se-font-mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--se-sql-cursor)', padding: '6px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--se-sql-cursor)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--se-sql-selection) !important' },
    '.cm-activeLine': { backgroundColor: 'var(--se-sql-active-line)' },
    '.cm-gutters': { backgroundColor: 'var(--se-sql-gutter-bg)', color: 'var(--se-sql-gutter-fg)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--se-sql-active-line)', color: 'var(--se-sql-gutter-active-fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-matchingBracket': { backgroundColor: 'var(--se-sql-selection)', outline: '1px solid var(--se-border)' },
    '.cm-placeholder': { color: 'var(--se-text-muted)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--se-menu-bg)',
      color: 'var(--se-menu-fg)',
      border: '1px solid var(--se-menu-border)',
      borderRadius: 'var(--se-radius)',
      boxShadow: 'var(--se-shadow-elevated)',
      fontFamily: 'var(--se-font-ui)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--se-menu-hover-bg)', color: 'var(--se-menu-hover-fg)' },
    '.cm-completionDetail': { color: 'var(--se-text-secondary)', fontStyle: 'normal', marginLeft: '0.75em' },
    '.cm-completionInfo': { maxWidth: '360px', padding: '6px 8px', whiteSpace: 'pre-wrap' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--se-sql-error)', textUnderlineOffset: '3px' },
    '.cm-lint-marker-error': { content: '""' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--se-sql-error)' },
  })

  const languageExtension = (s: SQLNamespace) => sql({ dialect: StandardSQL, schema: s, defaultTable: 'layer', upperCaseKeywords: true })
  // `override` replaces every completion source, the language's own schema
  // completion included, so it's composed back in explicitly.
  const completionExtension = (s: SQLNamespace, sources: CompletionSource[]) =>
    autocompletion({
      override: [schemaCompletionSource({ schema: s, defaultTable: 'layer', dialect: StandardSQL }), ...sources],
      activateOnTyping: true,
      icons: false,
    })

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          bracketMatching(),
          placeholder('SELECT * FROM layer'),
          language.of(languageExtension(schema)),
          completion.of(completionExtension(schema, completionSources)),
          syntaxHighlighting(highlight),
          linter(null),
          lintGutter(),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': 'SQL query', 'aria-multiline': 'true' }),
          keymap.of([
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: (v) => {
                const sel = v.state.selection.main
                // Spec 010: a result shows the Table tab; an open completion list would be left over a hidden editor.
                closeCompletion(v)
                onRun({ from: sel.from, to: sel.to })
                return true
              },
            },
            {
              key: 'Escape',
              run: () => {
                if (!running || !onCancel) return false
                onCancel()
                return true
              },
            },
            // Tab moves focus out (keyboard users are never trapped,
            // Constitution VII); indent lives on Ctrl+].
            { key: 'Ctrl-]', run: indentMore },
            ...completionKeymap,
            ...defaultKeymap.filter((b) => b.key !== 'Tab' && b.key !== 'Shift-Tab'),
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            // Dispatching inside an update isn't allowed; the store clears
            // diagnostics on edit, and the effect below re-applies them.
            if (u.docChanged) {
              const text = u.state.doc.toString()
              if (text !== value) onChange(text)
            }
          }),
        ],
      }),
    })
  })

  onDestroy(() => {
    view?.destroy()
    view = null
  })

  // External value changes (history entry, Reset): replace the document.
  $effect(() => {
    const next = value
    if (view && view.state.doc.toString() !== next) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
    }
  })

  $effect(() => {
    const d = diagnostics
    if (view) view.dispatch(setDiagnostics(view.state, d))
  })

  $effect(() => {
    const s = schema
    view?.dispatch({ effects: language.reconfigure(languageExtension(s)) })
  })

  $effect(() => {
    const s = schema
    const sources = completionSources
    view?.dispatch({ effects: completion.reconfigure(completionExtension(s, sources)) })
  })

  /** Focus the editor (used by the panel's keyboard shortcut). */
  export function focus(): void {
    view?.focus()
  }

  /** Spec 010: puts text at the selection (replacing it) and the cursor after it. */
  export function insertText(text: string): void {
    if (!view) return
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true })
    view.focus()
  }
</script>

<div class="sql-editor" bind:this={host}></div>

<style>
  .sql-editor {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
  }
  .sql-editor:focus-within {
    border-color: var(--se-focus);
  }
  .sql-editor :global(.cm-editor) {
    height: 100%;
  }
</style>
