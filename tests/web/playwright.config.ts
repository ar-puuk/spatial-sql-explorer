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
