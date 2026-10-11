import { defineConfig, devices } from '@playwright/test'

// MapLibre needs WebGL; this sandboxed/headless environment has no real GPU
// (observed "GPU stall" warnings and worker init failures without this).
// SwiftShader gives Chromium a software WebGL implementation — the standard
// fix for headless WebGL testing.
const chromium = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
}

export default defineConfig({
  testDir: './specs',
  timeout: 60000,
  // Up to ~10 parallel software-WebGL browsers: a table or legend update can
  // take longer than Playwright's 5 s assertion default while heavy files
  // render next to it (seen with the spec 003 22,000-feature style tests).
  expect: { timeout: 10000 },
  // Each worker is a software-WebGL Chromium plus a DuckDB-WASM engine;
  // more than ~6 at once starves the heavy specs (60k-row and 22k-feature
  // files) into timeouts that measure the machine, not the app.
  workers: 6,
  webServer: {
    command: 'npm run build --workspace=apps/web && npm run preview --workspace=apps/web -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    cwd: '../..',
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /performance\.spec\.ts/,
      use: chromium,
    },
    // Timing checks (SC-001/003/004) run alone, after everything else:
    // measured alongside parallel tests they report machine contention, not
    // the app (a 1.4 s open measured 2.3 s under load).
    {
      name: 'performance',
      testMatch: /performance\.spec\.ts/,
      dependencies: ['chromium'],
      fullyParallel: false,
      use: chromium,
    },
  ],
})
