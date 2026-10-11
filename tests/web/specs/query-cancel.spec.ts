// T031 (spec 002, US2; quickstart Scenario 2, step 5; SC-004): a running
// query can be cancelled within 3 s, the viewer stays responsive, and the
// previous result is kept.
import { test, expect } from '@playwright/test'
import { editor, fixture, openFile, openQueryPanel, rowCount, runQuery, setQuery, status } from './helpers'

const SLOW = 'SELECT sum(a.range * b.range) AS s FROM range(200000) a, range(200000) b'

for (const how of ['button', 'Escape'] as const) {
  test(`a slow query is cancelled with ${how === 'button' ? 'the Cancel button' : 'Esc'} in under 3 s`, async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('world-boundaries.geojson'))
    await openQueryPanel(page)
    await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'U%'")

    await setQuery(page, SLOW)
    await editor(page).press('Control+Enter')
    await expect(status(page)).toContainText('Running', { timeout: 10000 })
    await page.waitForTimeout(500)
    const t0 = Date.now()
    if (how === 'button') await page.getByRole('button', { name: 'Cancel' }).click()
    else await editor(page).press('Escape')
    await expect(status(page)).toContainText('Cancelled after', { timeout: 3000 })
    const cancelMs = Date.now() - t0
    console.log(`TIMING SC-004 cancel (web, ${how}): ${cancelMs} ms`)
    expect(cancelMs).toBeLessThan(3000)
    expect(await rowCount(page)).toBe(8)

    // Responsive, and the engine is usable again.
    await runQuery(page, 'SELECT 42 AS answer')
    await expect(status(page)).toContainText('✓ 1 row ·')
  })
}
