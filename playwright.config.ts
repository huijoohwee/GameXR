import { defineConfig, devices } from '@playwright/test'

const externalE2eUrl = process.env.GAME_XR_E2E_URL?.trim()
const expectedSourceRevision = process.env.GAME_XR_EXPECTED_SOURCE_REVISION?.trim()
const expectedArtifactDigest = process.env.GAME_XR_EXPECTED_ARTIFACT_DIGEST?.trim()

if (externalE2eUrl) {
  if (!/^[a-f0-9]{40}$/u.test(expectedSourceRevision ?? '')) {
    throw new Error('External GameXR verification requires GAME_XR_EXPECTED_SOURCE_REVISION as an exact 40-hex Git revision.')
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedArtifactDigest ?? '')) {
    throw new Error('External GameXR verification requires GAME_XR_EXPECTED_ARTIFACT_DIGEST as an exact 64-hex artifact digest.')
  }
}
const baseURL = externalE2eUrl ? new URL(externalE2eUrl).origin : 'http://127.0.0.1:4187'

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: externalE2eUrl ? undefined : {
    command: 'npm run check && npm run preview -- --host 127.0.0.1 --port 4187 --strictPort',
    url: `${baseURL}/gamexr/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
