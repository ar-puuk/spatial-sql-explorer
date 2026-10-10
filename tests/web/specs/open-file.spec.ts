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
  await expect(page.locator('.attribute-table table tbody tr').first()).toBeVisible({ timeout: 60000 })

  const rowCount = await page.locator('.attribute-table table tbody tr').count()
  // 179 valid features (1 topologically invalid geometry is skipped per
  // FR-014 — see research.md / tasks.md T014's note on this exact dataset).
  expect(rowCount).toBe(179)

  // MapView's canvas should have rendered too.
  await expect(page.locator('.map-pane canvas')).toBeVisible()
})
