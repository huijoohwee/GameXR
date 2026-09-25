import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './drone-browser-tests', testMatch: '**/*.diagnostics.ts',
  workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4195', trace: 'retain-on-failure' },
  projects: [{ name: 'diagnostics-mobile-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: { command: 'node drone-browser-tests/diagnostics-fixture.ts',
    url: 'http://127.0.0.1:4195/gamexr/', reuseExistingServer: false, timeout: 15000 },
})
