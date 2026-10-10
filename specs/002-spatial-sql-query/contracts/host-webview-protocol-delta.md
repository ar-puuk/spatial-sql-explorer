# Contract delta: extension host ↔ webview protocol (spec 002)

These are additions to `specs/001-quick-look/contracts/host-webview-protocol.md`.
Every webview → host message still passes through the single JSON-normalizing
`post()`, so no Svelte `$state` proxies are posted (001 research §7).

## Webview → host

```ts
| { type: 'log'; detail: string }                       // EXISTING, now also used by HostAdapter.log (FR-010)
| { type: 'queryState'; state: QueryStateReport }       // NEW: test observability
```

```ts
interface QueryStateReport {
  phase: 'idle' | 'running' | 'awaitingConfirm' | 'succeeded' | 'failed' | 'cancelled' | 'refused'
  outcome?: 'result' | 'ddl'
  rowCount?: number
  mappedCount?: number
  geometryColumn?: string | null
  resultCrs?: string
  resultCrsSource?: 'override' | 'engine' | 'detected' | 'layer'
  errorMessage?: string
  errorPosition?: { line: number; column: number }
  refusedReason?: string
  durationMs?: number
  historyLength?: number
}
```

## Host → webview (test hooks only)

These are driven by the `spatialExplorer._runQuery` and
`spatialExplorer._cancelQuery` commands, because `@vscode/test-electron`
cannot type into the webview. They use the same store actions as the Run and
Cancel buttons.

```ts
| { type: 'testRunQuery'; sql: string; confirm?: 'all' | 'first' | 'cancel' }   // confirm answers FR-012's dialog if it appears
| { type: 'testCancelQuery' }
```

## Commands (test-only, underscore-prefixed as in spec 001)

- `spatialExplorer._runQuery(sql, confirm?)`
- `spatialExplorer._cancelQuery()`
- `spatialExplorer._getQueryState() → QueryStateReport | null`
