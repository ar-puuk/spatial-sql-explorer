#!/usr/bin/env node
// Screenshot tool: captures the REAL running product, not a simulation.
//
// - VS Code: launches the same VS Code build @vscode/test-electron uses,
//   through Playwright's Electron driver, with apps/vscode-ext loaded as a
//   development extension, a throwaway profile per color theme, and the test
//   fixtures folder open. It opens a file via Quick Open (the way a user
//   does) and drives the webview through its nested iframes.
// - Web: serves the production build with `vite preview` and drives it in
//   Chromium (SwiftShader WebGL, like tests/web) in light and dark.
//
// This tool found the "VS Code map draws no data" bug (design-plan.md §8.6)
// that every automated assertion at the time passed. Run it after UI changes
// and look at the output.
//
// Usage (builds first):  npm run screenshots -- [options]
//   --only vscode|web       one target (default: both)
//   --themes "A,B"          VS Code color themes (default: Dark Modern, Light Modern, High Contrast)
//   --file NAME             fixture to open in VS Code (default: sample.fgb)
//   --out DIR               output directory (default: screenshots/)
import { _electron as electron, chromium } from '@playwright/test'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = path.join(root, 'tests', 'vscode-ext', 'fixtures')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  // npm on Windows passes arguments through cmd.exe, which can leave `^` escapes behind.
  return i >= 0 ? process.argv[i + 1].replace(/\^/g, '') : fallback
}
const only = arg('only', 'all')
const themes = arg('themes', 'Default Dark Modern,Default Light Modern,Default High Contrast').split(',').map((t) => t.trim())
const file = arg('file', 'sample.fgb')
const out = path.resolve(root, arg('out', 'screenshots'))
fs.mkdirSync(out, { recursive: true })

const slug = (s) => s.replace(/\W+/g, '-').toLowerCase()
const written = []
async function shot(page, name, options = {}) {
  const p = path.join(out, `${name}.png`)
  await page.screenshot({ path: p, ...options })
  written.push(p)
}

/** Runs a scene step; a failing optional step is reported, not fatal. */
async function step(label, fn) {
  try {
    await fn()
  } catch (err) {
    console.warn(`  ! ${label}: ${String(err?.message ?? err).split('\n')[0]}`)
  }
}

// --- VS Code ---------------------------------------------------------------

async function captureVsCode() {
  const executablePath = await downloadAndUnzipVSCode({ cachePath: path.join(root, 'tests', 'vscode-ext', '.vscode-test') })
  for (const theme of themes) {
    console.log(`VS Code: ${theme}`)
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'se-shots-'))
    fs.mkdirSync(path.join(profile, 'User'), { recursive: true })
    fs.writeFileSync(
      path.join(profile, 'User', 'settings.json'),
      JSON.stringify({
        'workbench.colorTheme': theme,
        'workbench.startupEditor': 'none',
        'workbench.tips.enabled': false,
        'workbench.secondarySideBar.defaultVisibility': 'hidden',
        'security.workspace.trust.enabled': false,
        'window.restoreWindows': 'none',
        'chat.disableAIFeatures': true,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'extensions.ignoreRecommendations': true,
      })
    )
    // Export scenes (spec 005 T031): a keybinding that points the next export
    // at a temp file, so no native save dialog opens under automation.
    fs.writeFileSync(
      path.join(profile, 'User', 'keybindings.json'),
      JSON.stringify([{ key: 'ctrl+alt+shift+f12', command: 'spatialExplorer._saveNextExportTo', args: path.join(profile, 'export-shot.geojson') }])
    )
    const app = await electron.launch({
      executablePath,
      args: [
        fixtures,
        `--extensionDevelopmentPath=${path.join(root, 'apps', 'vscode-ext')}`,
        '--disable-extensions',
        `--user-data-dir=${profile}`,
        `--extensions-dir=${path.join(profile, 'extensions')}`,
        '--skip-release-notes',
        '--disable-workspace-trust',
      ],
    })
    try {
      const win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
      await win.waitForTimeout(1500)
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        w.unmaximize()
        w.setSize(1440, 900)
        w.center()
      })
      await win.waitForTimeout(2500)
      // Dismiss the "extensions temporarily disabled" toast so it doesn't cover the table.
      await step('dismiss notifications', async () => {
        await win.keyboard.press('Control+Shift+P')
        await win.keyboard.type('Notifications: Clear All Notifications')
        await win.waitForTimeout(400)
        await win.keyboard.press('Enter')
      })
      await win.keyboard.press('Control+P')
      await win.waitForTimeout(600)
      await win.keyboard.type(file)
      await win.waitForTimeout(600)
      await win.keyboard.press('Enter')

      const view = win.frameLocator('iframe.webview').frameLocator('iframe')
      // Wait for real rendered data, not a fixed delay.
      await view.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 90000 })
      await win.waitForTimeout(1500)
      const name = `vscode-${slug(theme)}`
      await shot(win, `${name}-loaded`)

      await step('select + zoom from table', async () => {
        await view.locator('.attribute-table tbody tr:not(.spacer)').nth(4).dblclick({ timeout: 5000 })
        await win.waitForTimeout(1200)
      })
      await step('style panel', async () => {
        await view.getByRole('button', { name: 'Layer style' }).click({ timeout: 5000 })
        await win.waitForTimeout(500)
        await shot(win, `${name}-style`)
        await view.getByRole('button', { name: 'Layer style' }).click({ timeout: 5000 })
      })
      await step('basemap picker', async () => {
        await view.getByRole('button', { name: 'Basemap' }).click({ timeout: 3000 })
        await win.waitForTimeout(500)
        await shot(win, `${name}-basemap`)
        await view.getByRole('button', { name: 'Basemap' }).click({ timeout: 3000 })
      })
      await step('inspect on map click', async () => {
        const box = await win.locator('iframe.webview').boundingBox()
        await win.mouse.click(box.x + box.width / 2, box.y + box.height * 0.35)
        await win.waitForTimeout(800)
        await shot(win, `${name}-inspect`)
      })
      await step('open the query panel', async () => {
        await win.keyboard.press('Escape')
        await view.locator('.attribute-table table').focus()
        await win.keyboard.press('Control+Shift+Q')
      })
      await queryScenes(view, win, name)
      await styleScenes(view, win, name)
      await exportScenes(view, win, name, async () => win.keyboard.press('Control+Alt+Shift+F12'))
      await step('native status bar while hovering', async () => {
        const box = await win.locator('iframe.webview').boundingBox()
        await win.mouse.move(box.x + box.width / 2 - 20, box.y + box.height * 0.3)
        await win.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3)
        await win.waitForTimeout(600)
        await shot(win, `${name}-statusbar`, { clip: { x: 840, y: 870, width: 600, height: 30 } })
      })
    } finally {
      await app.close()
      fs.rmSync(profile, { recursive: true, force: true })
    }
  }
}

/**
 * Spec 002 scenes, shared by both shells (T049): a result, an error with its
 * squiggle, the autocomplete list, the history popover and the large-result
 * dialog. `ui` finds elements (the webview frame in VS Code), `win` types and
 * captures.
 */
async function queryScenes(ui, win, prefix) {
  const editor = ui.getByRole('textbox', { name: 'SQL query' })
  const replace = async (sql) => {
    await editor.click()
    await win.keyboard.press('Control+A')
    // VS Code applies a webview's select-all asynchronously; let it land
    // before the replacement text goes in.
    await win.waitForTimeout(250)
    await win.keyboard.press('Delete')
    await win.keyboard.insertText(sql)
    await win.keyboard.press('Escape')
  }
  await step('query panel with a result', async () => {
    await replace("SELECT name, round(ST_Area(geom)) AS area, geom\nFROM layer\nWHERE name LIKE 'S%'\nORDER BY area DESC")
    await win.keyboard.press('Control+Enter')
    await ui.locator('.query-status').filter({ hasText: '✓' }).waitFor({ timeout: 30000 })
    await win.waitForTimeout(1200)
    await shot(win, `${prefix}-query`)
  })
  await step('query error with a squiggle', async () => {
    await replace('SELECT *\nFORM layer')
    await win.keyboard.press('Control+Enter')
    await ui.locator('.cm-lintRange-error').waitFor({ timeout: 30000 })
    await win.waitForTimeout(400)
    await shot(win, `${prefix}-query-error`)
  })
  await step('autocomplete list', async () => {
    await replace('SELECT ')
    await win.keyboard.press('End')
    await win.keyboard.type('ST_Ar', { delay: 40 })
    await ui.locator('.cm-tooltip-autocomplete').waitFor({ timeout: 10000 })
    await win.waitForTimeout(400)
    await shot(win, `${prefix}-query-autocomplete`)
    await win.keyboard.press('Escape')
  })
  await step('history popover', async () => {
    await ui.getByRole('button', { name: 'Query history' }).click()
    await ui.getByRole('listbox', { name: 'Query history' }).waitFor({ timeout: 5000 })
    await win.waitForTimeout(300)
    await shot(win, `${prefix}-query-history`)
    await win.keyboard.press('Escape')
  })
  await step('large-result dialog', async () => {
    await replace('SELECT * FROM range(60000)')
    await win.keyboard.press('Control+Enter')
    await ui.getByRole('dialog', { name: 'Large result' }).waitFor({ timeout: 30000 })
    await win.waitForTimeout(300)
    await shot(win, `${prefix}-query-large`)
    await win.keyboard.press('Escape')
  })
}

/**
 * Spec 003 scenes (T045): categorized with its legend, graduated (natural
 * breaks) on an area column computed in SQL, the ramp picker, a hidden
 * class, and the fallback when the styled column leaves the result.
 */
async function styleScenes(ui, win, prefix) {
  const editor = ui.getByRole('textbox', { name: 'SQL query' })
  const run = async (sql) => {
    await editor.click()
    await win.keyboard.press('Control+A')
    await win.waitForTimeout(250)
    await win.keyboard.press('Delete')
    await win.keyboard.insertText(sql)
    await win.keyboard.press('Escape')
    // Wait for THIS run's status: the previous run's "✓" is still showing.
    const status = ui.locator('.query-status')
    const before = await status.textContent()
    await win.keyboard.press('Control+Enter')
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const now = (await status.textContent()) ?? ''
      if (now !== before && now.includes('✓')) return
      await win.waitForTimeout(100)
    }
    throw new Error(`query did not finish: ${sql}`)
  }
  await step('style: categorized with legend', async () => {
    await run('SELECT *, round(ST_Area(geom), 1) AS area FROM layer')
    await ui.getByRole('button', { name: 'Layer style' }).click()
    await ui.getByRole('radio', { name: 'Categorized' }).click()
    await ui.getByLabel('Column').selectOption('name')
    await win.waitForTimeout(1200)
    await shot(win, `${prefix}-style-categorized`)
  })
  await step('style: graduated, natural breaks', async () => {
    await ui.getByRole('radio', { name: 'Graduated' }).click()
    await ui.getByLabel('Column').selectOption('area')
    await ui.getByLabel('Method').selectOption('jenks')
    await win.waitForTimeout(1200)
    await shot(win, `${prefix}-style-graduated`)
  })
  await step('style: ramp picker', async () => {
    await ui.getByRole('button', { name: /^Colors:/ }).click()
    await win.waitForTimeout(400)
    await shot(win, `${prefix}-style-ramps`)
    await win.keyboard.press('Escape')
  })
  await step('style: a hidden class', async () => {
    await ui.getByRole('region', { name: 'Legend' }).getByRole('button', { name: /^Hide class/ }).last().click()
    await win.waitForTimeout(1000)
    await shot(win, `${prefix}-style-hidden`)
  })
  await step('style: fallback notice', async () => {
    await run('SELECT name, geom FROM layer')
    await win.waitForTimeout(1000)
    await shot(win, `${prefix}-style-fallback`)
    await win.keyboard.press('Escape')
  })
}

/**
 * Spec 005 scenes (T031): the export dialog for a geometry result, the done
 * confirmation with its notices, the display-limited rows choice, and the
 * running progress. `beforeSave` points VS Code's save at a temp file.
 */
async function exportScenes(ui, win, prefix, beforeSave) {
  const dialog = ui.getByRole('dialog', { name: 'Export data' })
  const editor = ui.getByRole('textbox', { name: 'SQL query' })
  await step('export: dialog', async () => {
    await win.keyboard.press('Escape')
    await ui.getByRole('button', { name: 'Export data…' }).click()
    await dialog.waitFor({ timeout: 5000 })
    await win.waitForTimeout(400)
    await shot(win, `${prefix}-export`)
  })
  await step('export: done with notices', async () => {
    await dialog.getByRole('radio', { name: 'GeoJSON', exact: true }).click()
    await beforeSave()
    if (prefix.startsWith('web')) {
      await Promise.all([win.waitForEvent('download', { timeout: 30000 }), dialog.getByRole('button', { name: 'Export…' }).click()])
    } else {
      await dialog.getByRole('button', { name: 'Export…' }).click()
    }
    await dialog.getByRole('status').filter({ hasText: 'Saved' }).waitFor({ timeout: 30000 })
    await win.waitForTimeout(300)
    await shot(win, `${prefix}-export-done`)
    await dialog.getByRole('button', { name: 'Done' }).click()
  })
  await step('export: display-limited rows', async () => {
    await editor.click()
    await win.keyboard.press('Control+A')
    await win.waitForTimeout(250)
    await win.keyboard.press('Delete')
    await win.keyboard.insertText('SELECT a.name, ST_Centroid(a.geom) AS geom FROM layer a, range(10000) b LIMIT 1000000')
    await win.keyboard.press('Escape')
    await win.keyboard.press('Control+Enter')
    await ui.getByRole('dialog', { name: 'Large result' }).getByRole('button', { name: 'Show first 50,000' }).click({ timeout: 30000 })
    await ui.locator('.query-status').filter({ hasText: 'Showing first 50,000' }).waitFor({ timeout: 60000 })
    await ui.getByRole('button', { name: 'Export data…' }).click()
    await dialog.waitFor({ timeout: 5000 })
    await win.waitForTimeout(400)
    await shot(win, `${prefix}-export-limited`)
  })
  await step('export: running progress', async () => {
    await dialog.getByRole('radio', { name: 'GeoJSON', exact: true }).click()
    await dialog.getByRole('button', { name: 'Export…' }).click()
    await dialog.getByRole('status').filter({ hasText: /rows written/ }).waitFor({ timeout: 30000 })
    await shot(win, `${prefix}-export-progress`)
    await dialog.getByRole('button', { name: 'Cancel export' }).click()
    await dialog.getByText('Export cancelled').waitFor({ timeout: 10000 })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
  })
}

// --- Web -------------------------------------------------------------------

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Preview server did not start at ${url}`)
}

async function captureWeb() {
  const port = 4180
  const server = spawn(`npm run preview --workspace=apps/web -- --port ${port} --strictPort`, { cwd: root, shell: true, stdio: 'ignore' })
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    await waitForServer(`http://localhost:${port}/`, 30000)
    for (const scheme of ['light', 'dark']) {
      console.log(`Web: ${scheme}`)
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
      await page.goto(`http://localhost:${port}/`)
      await page.waitForTimeout(800)
      await shot(page, `web-${scheme}-empty`)
      await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, 'world-boundaries.geojson'))
      await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 90000 })
      await page.waitForTimeout(1500)
      await shot(page, `web-${scheme}-loaded`)
      await step('select + zoom', async () => {
        // Argentina: its bounding-box center lies inside it, so the map-center click below hits it.
        await page.locator('.attribute-table tbody tr:not(.spacer)').nth(4).dblclick()
        await page.waitForTimeout(1200)
      })
      await step('style panel', async () => {
        await page.getByRole('button', { name: 'Layer style' }).click()
        await page.waitForTimeout(400)
        await shot(page, `web-${scheme}-style`)
        await page.getByRole('button', { name: 'Layer style' }).click()
      })
      await step('basemap picker', async () => {
        await page.getByRole('button', { name: 'Basemap' }).click({ timeout: 3000 })
        await page.waitForTimeout(400)
        await shot(page, `web-${scheme}-basemap`)
        await page.getByRole('button', { name: 'Basemap' }).click({ timeout: 3000 })
      })
      await step('inspect on map click', async () => {
        const box = await page.locator('.canvas-host').boundingBox()
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForTimeout(800)
        await shot(page, `web-${scheme}-inspect`)
      })
      await step('open the query panel', async () => {
        await page.keyboard.press('Control+Shift+Q')
      })
      await queryScenes(page, page, `web-${scheme}`)
      await styleScenes(page, page, `web-${scheme}`)
      await exportScenes(page, page, `web-${scheme}`, async () => {})
      await page.close()
    }
  } finally {
    await browser.close()
    server.kill()
    if (process.platform === 'win32' && server.pid) spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' })
  }
}

if (only === 'all' || only === 'vscode') await captureVsCode()
if (only === 'all' || only === 'web') await captureWeb()
console.log(`\n${written.length} screenshots in ${path.relative(root, out) || '.'}:`)
for (const p of written) console.log(`  ${path.relative(root, p)}`)
