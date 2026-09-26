import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './browser-tests', testMatch: 'spatial-review.spec.ts', fullyParallel: false, workers: 1,
  timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4196', serviceWorkers: 'allow', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 900 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  // Same-origin deployment has no Origin-varying assets; Vite preview CORS otherwise causes offline cache misses.
  webServer: { command: `npm run build && node --input-type=module -e "import { preview } from 'vite'; await preview({ mode: 'gamexr', preview: { host: '127.0.0.1', port: 4196, strictPort: true, cors: false } });"`, url: 'http://127.0.0.1:4196/gamexr/', reuseExistingServer: false, timeout: 120_000 },
})
