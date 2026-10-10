// T030 (spec 002, US2; quickstart Scenario 2, steps 1-4): specific errors with
// editor positions, policy refusals, and the previous result always kept.
// The last test proves the ENGINE lockdown on its own, bypassing the
// statement policy through the ?e2e=1 hook (contracts/statement-policy.md,
// "Defense in depth").
import { test, expect } from '@playwright/test'
import { fixture, openFile, openQueryPanel, rowCount, runQuery, status } from './helpers'

test('a syntax error names the problem, marks its position, and keeps the previous result', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)
  await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'U%'")
  expect(await rowCount(page)).toBe(8)

  await runQuery(page, 'SELECT *\nFORM layer')
  await expect(status(page)).toContainText('Parser Error')
  await expect(status(page)).toContainText('syntax error at or near "layer"')
  // The squiggle is on line 2, on "layer".
  const mark = page.locator('.cm-lintRange-error')
  await expect(mark).toHaveCount(1)
  await expect(page.locator('.cm-line').nth(1)).toContainText('FORM layer')
  await expect(page.locator('.cm-line').nth(1).locator('.cm-lintRange-error')).toHaveCount(1)
  expect(await rowCount(page)).toBe(8)
})

test('an unknown column names it and lists the candidates', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)
  await runQuery(page, 'SELECT nope FROM layer')
  await expect(status(page)).toContainText('Binder Error')
  await expect(status(page)).toContainText('"nope"')
  await expect(status(page)).toContainText('Candidate bindings')
})

test('statements outside the policy are refused before anything runs (FR-013)', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)
  await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'U%'")

  await runQuery(page, "COPY layer TO 'x.csv'")
  await expect(status(page)).toContainText("Exporting results isn't available yet.")
  expect(await rowCount(page)).toBe(8)

  await runQuery(page, 'INSERT INTO layer SELECT * FROM layer')
  await expect(status(page)).toContainText("Spatial Explorer doesn't modify data.")

  await runQuery(page, 'DROP VIEW layer')
  await expect(status(page)).toContainText("`layer` is the opened file and can't be replaced or dropped.")
  expect(await rowCount(page)).toBe(8)
})

test('the engine lockdown blocks file and network access on its own (defense in depth)', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const raw = (sql: string): Promise<string> =>
    page.evaluate(async (q) => {
      try {
        await (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<unknown> } }).__spatialExplorerE2E.runRaw(q)
        return 'ok'
      } catch (e) {
        return String((e as Error).message ?? e)
      }
    }, sql)
  expect(await raw("COPY (SELECT 1) TO '/tmp/x.csv'")).toContain('Permission Error')
  expect(await raw("SELECT * FROM read_csv('https://example.com/x.csv')")).toContain('Permission Error')
  expect(await raw('LOAD httpfs')).toContain('Permission Error')
  expect(await raw('SET threads = 2')).toContain('locked')
  // `layer` is a view: writing to it fails in the engine itself.
  expect(await raw('INSERT INTO layer SELECT * FROM layer')).toContain('not an table')
  // And normal reads still work through the same hook.
  expect(await raw('SELECT count(*) FROM layer')).toBe('ok')
})

// SC-003: every class in the test set (syntax, unknown column, unknown table,
// unknown function, type error) names the specific problem, in the real
// engine, and none of them blanks or breaks the viewer.
test('every error class in the SC-003 set names the specific problem', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)
  await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'U%'")
  const cases: Array<{ sql: string; kind: string; names: RegExp }> = [
    { sql: 'SELEC * FROM layer', kind: 'Did you mean SELECT', names: /"SELEC"/ },
    { sql: 'SELECT * FORM layer', kind: 'Parser Error', names: /"layer"/ },
    { sql: 'SELECT nope FROM layer', kind: 'Binder Error', names: /"nope"/ },
    { sql: 'SELECT * FROM parcels', kind: 'Catalog Error', names: /parcels/ },
    { sql: 'SELECT ST_Areaa(geom) FROM layer', kind: 'Catalog Error', names: /ST_Areaa/i },
    { sql: "SELECT name + 1 FROM layer", kind: 'Error', names: /\+|VARCHAR|Could not convert/ },
    { sql: "SELECT ST_Area('not a geometry') FROM layer", kind: 'Error', names: /geometry|GEOMETRY|WKT/i },
  ]
  for (const c of cases) {
    await runQuery(page, c.sql)
    await expect(status(page), c.sql).toContainText(c.kind)
    await expect(status(page), c.sql).toContainText(c.names)
    expect(await rowCount(page), c.sql).toBe(8)
  }
})
