// The repo's config, run with the installed Google Chrome instead of
// Playwright's downloaded Chromium: for machines whose policy blocks
// Playwright's browsers (npm run test:web:chrome). Use 3 workers or fewer
// there; the timing tests are sensitive to load.
import base from './playwright.config'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  ...base,
  projects: (base.projects ?? []).map((p) => ({ ...p, use: { ...p.use, channel: 'chrome' } })),
})
