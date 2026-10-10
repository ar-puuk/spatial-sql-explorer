// T029 (specs/001-quick-look/tasks.md): opening a file via the web shell
// renders the same map+table outcome as the VS Code path (SC-006). Uses the
// real file input (setInputFiles) rather than simulating an OS-level drag —
// both paths call the same handleFiles() code, so this exercises the shared
// logic for real.
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('opening a real file renders the map and table with matching rows', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Drag a geospatial file here')).toBeVisible()

  const fixturePath = path.resolve(__dirname, '../../vscode-ext/fixtures/world-boundaries.geojson')
  await page.locator('input[type="file"]').setInputFiles(fixturePath)

  // Empty state is replaced by ViewerLayout once the file loads.
  await expect(page.locator('.viewer-layout')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.attribute-table table tbody tr:not(.spacer)').first()).toBeVisible({ timeout: 60000 })

  // 179 valid features (1 topologically invalid geometry is skipped per
  // FR-014 — see research.md / tasks.md T014's note on this exact dataset).
  // Rows are virtualized (design-plan.md §8.1), so count the grid's data
  // rows via aria-rowcount (data rows + 1 header row) rather than the DOM,
  // and check the drawer header reports the same count.
  // Spec 002 amendment: the row with invalid geometry is listed in the table
  // (180 rows + 1 header row) and left off the map (179 mapped).
  await expect(page.getByRole('grid', { name: 'Attribute table' })).toHaveAttribute('aria-rowcount', '181')
  await expect(page.locator('.drawer-header .count')).toHaveText('180 rows · 179 mapped')
  const rendered = await page.locator('.attribute-table table tbody tr:not(.spacer)').count()
  expect(rendered).toBeGreaterThan(0)
  expect(rendered).toBeLessThan(179)

  // MapView's canvas should have rendered too.
  await expect(page.locator('.map-pane canvas')).toBeVisible()
})
