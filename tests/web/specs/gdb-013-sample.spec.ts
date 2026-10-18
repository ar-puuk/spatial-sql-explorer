// Spec 013 acceptance on a real geodatabase (SC-001): not committed data, so this runs only when SE_GDB_SAMPLE
// names a .gdb folder, e.g. D:\WFv1000_MasterNet_20260903.gdb (a 111 MB Cube transit network, 56 layers, UTM 12N).
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { runQuery } from './helpers'

const sample = process.env.SE_GDB_SAMPLE

test.skip(!sample || !fs.existsSync(sample), 'set SE_GDB_SAMPLE to a .gdb folder to run this')

test('a real geodatabase: layers listed, a 58,000-line layer on the map, others read by name', async ({ page }) => {
  test.setTimeout(300000)
  await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showDirectoryPicker)
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
  )
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'More ways to open' }).click()
  await page.getByRole('menuitem', { name: /Geodatabase folder/ }).click()
  const t0 = Date.now()
  await (await chooser).setFiles(sample!)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 240000 })
  console.log(`opened the first layer in ${Date.now() - t0} ms`)
  const options = page.getByRole('combobox', { name: 'Layer' }).locator('option')
  expect(await options.count()).toBeGreaterThan(50)

  // A layer over 100 MB is announced before it is read in full (the same dialog as any big FlatGeobuf).
  const t1 = Date.now()
  await page.getByRole('combobox', { name: 'Layer' }).selectOption('WFv1000_MasterNet_20260903_Link')
  await page.getByRole('dialog', { name: 'Read the whole file?' }).getByRole('button', { name: 'Open' }).click()
  await expect(page.locator('.status-bar')).toContainText('58,195 features', { timeout: 240000 })
  console.log(`Link layer (109 MB): ${Date.now() - t1} ms`)

  // Another layer, read by name from SQL (first use converts it).
  await runQuery(page, 'SELECT count(*) AS n FROM wfv1000_masternet_20260903.wfv1000_masternet_20260903_node')
  await expect(page.locator('[role="grid"][aria-label="Attribute table"]')).toContainText('21964', { timeout: 120000 })
})
