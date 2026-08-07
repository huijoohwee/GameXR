import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187/gamexr/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
