// T030 (specs/001-quick-look/tasks.md): the empty state (no file loaded)
// renders correctly.
import { test, expect } from '@playwright/test'

test('empty state renders when no file is loaded', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Drag a geospatial file here')).toBeVisible()
  await expect(page.getByText('Choose a file')).toBeVisible()
})
