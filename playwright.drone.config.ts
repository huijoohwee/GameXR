import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './drone-browser-tests', workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4193', trace: 'retain-on-failure' },
  projects: [{ name: 'drone-mobile-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: {
    command: 'npm run drone:bench -- --port=4193',
    url: 'http://127.0.0.1:4193/gamexr/', reuseExistingServer: false, timeout: 15000,
  },
})
