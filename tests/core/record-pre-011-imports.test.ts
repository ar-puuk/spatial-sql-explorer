// @vitest-environment happy-dom
// Spec 011 T011: records what the PRE-011 build draws after importing each
// 0.3.0 sidecar (fixtures/style/pre-011-sidecars), into
// fixtures/style/pre-011-imports.json. Run once on the pre-011 style code:
//
//   SE_RECORD_011=1 npx vitest run record-pre-011-imports     (in tests/core)
//
// style-qml-migration-011 compares the 011 import against it (US2).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { importStyle } from '@spatial-explorer/core'
import { PRE_011_SIDECAR_GEOMETRY } from './fixtures/style/pre-011-styles'
import { drawnAfterImport } from './fixtures/style/pre-011-drawn'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, 'fixtures', 'style')

describe.runIf(process.env.SE_RECORD_011 === '1')('record the pre-011 import of each 0.3.0 sidecar', () => {
  it('writes pre-011-imports.json', () => {
    const out: Record<string, unknown> = {}
    for (const name of Object.keys(PRE_011_SIDECAR_GEOMETRY)) {
      const text = readFileSync(join(dir, 'pre-011-sidecars', `${name}.qml`), 'utf8')
      out[name] = drawnAfterImport(importStyle(`${name}.qml`, text).style)
    }
    const header = { recordedFrom: process.env.SE_RECORD_011_COMMIT ?? 'unknown', note: 'Spec 011 T011: what the pre-011 build draws after importing each 0.3.0 sidecar.' }
    writeFileSync(join(dir, 'pre-011-imports.json'), JSON.stringify({ header, styles: out }, null, 1) + '\n')
  })
})
