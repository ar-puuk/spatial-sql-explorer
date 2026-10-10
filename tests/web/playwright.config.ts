import { defineConfig, devices } from '@playwright/test'

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
      use: {
        ...devices['Desktop Chrome'],
        // MapLibre needs WebGL; this sandboxed/headless environment has no
        // real GPU (observed "GPU stall" warnings and worker init failures
        // without this). SwiftShader gives Chromium a software WebGL
        // implementation — the standard fix for headless WebGL testing.
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
})
