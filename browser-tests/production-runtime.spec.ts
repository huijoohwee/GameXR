import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

interface ArtifactEntry {
  path: string
  bytes: number
  sha256: string
}

interface ReleaseManifest {
  schema: string
  basePath: string
  candidateStatus: string
  sourceRevision: string | null
  artifactDigest: string
  deploymentAuthorized: boolean
  artifacts: ArtifactEntry[]
}

interface PrecacheManifest {
  schema: string
  basePath: string
  buildDigest: string
  serviceWorkerRegistrationEnabled: boolean
  entries: ArtifactEntry[]
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function releaseDigest(artifacts: ArtifactEntry[]): string {
  const input = [...artifacts]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((artifact) => `${artifact.path}\0${artifact.bytes}\0${artifact.sha256}`)
    .join('\n')
  return sha256(Buffer.from(input))
}

test('release manifest binds every served artifact byte', async ({ page, request }) => {
  await page.goto('/gamexr/')
  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false')
  const manifestUrl = new URL('release-manifest.json', page.url()).href
  const manifestResponse = await request.get(manifestUrl)
  expect(manifestResponse.ok()).toBe(true)
  const manifest = await manifestResponse.json() as ReleaseManifest

  expect(manifest.schema).toBe('gamexr-release-artifact/v1')
  expect(manifest.basePath).toBe('/gamexr/')
  if (process.env.GAME_XR_E2E_URL || process.env.GAME_XR_EXPECTED_SOURCE_REVISION) {
    expect(manifest.candidateStatus).toBe('source-bound-clean')
  } else {
    expect(['source-bound-clean', 'unsealed-dirty-source']).toContain(manifest.candidateStatus)
  }
  expect(manifest.deploymentAuthorized).toBe(false)
  const expectedRevision = process.env.GAME_XR_EXPECTED_SOURCE_REVISION?.trim()
  const expectedDigest = process.env.GAME_XR_EXPECTED_ARTIFACT_DIGEST?.trim()
  if (expectedRevision) expect(manifest.sourceRevision).toBe(expectedRevision)
  if (expectedDigest) expect(manifest.artifactDigest).toBe(expectedDigest)

  for (const artifact of manifest.artifacts) {
    const response = await request.get(new URL(artifact.path, page.url()).href)
    expect(response.ok(), artifact.path).toBe(true)
    const bytes = await response.body()
    expect(bytes.byteLength, artifact.path).toBe(artifact.bytes)
    expect(sha256(bytes), artifact.path).toBe(artifact.sha256)
  }
  expect(releaseDigest(manifest.artifacts)).toBe(manifest.artifactDigest)
})

test('WebMCP reports the Knowgrph-resolved chase camera while flight controls move it', async ({ page }) => {
  await page.goto('/gamexr/')
  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false')

  const initial = await page.evaluate(() => window.gameXR.inspect().runtime)
  expect(initial.camera.mode).toBe('chase')
  expect(initial.camera.position).toHaveLength(3)
  expect(initial.camera.quaternion).toHaveLength(4)
  expect(initial.camera.lookTarget).toHaveLength(3)
  expect(initial.camera.fieldOfViewDegrees).toBeGreaterThanOrEqual(30)

  await page.evaluate(async () => {
    await window.gameXR.control({ operation: 'start' })
    await window.gameXR.control({
      operation: 'set-controls',
      throttle: 1,
      pitch: 0.8,
      roll: 0.6,
      yaw: 0.25,
    })
  })

  await expect.poll(async () => {
    const current = await page.evaluate(() => window.gameXR.inspect().runtime)
    const aircraftDelta = current.rotation.reduce(
      (sum, component, index) => sum + Math.abs(component - initial.rotation[index]!),
      0,
    )
    const cameraDelta = current.camera.position.reduce(
      (sum, component, index) => sum + Math.abs(component - initial.camera.position[index]!),
      0,
    )
    return { aircraftMoved: aircraftDelta > 0.01, cameraMoved: cameraDelta > 0.01 }
  }).toEqual({ aircraftMoved: true, cameraMoved: true })

  const inspection = await page.evaluate(async () => {
    const tool = window.gameXR.tools.find((candidate) => candidate.name === 'gamexr.inspect_runtime')
    if (!tool) throw new Error('GameXR inspection tool is missing.')
    return tool.execute({})
  }) as { runtime: { camera: { mode: string } } }
  expect(inspection.runtime.camera.mode).toBe('chase')
  await page.evaluate(() => window.gameXR.control({ operation: 'pause' }))
})

test('service worker admits exactly the current verified content-addressed cache', async ({ page, request }) => {
  await page.goto('/gamexr/')
  await expect(page.locator('#offline-status')).toHaveText('Offline shell ready')
  const manifestUrl = new URL('precache-manifest.json', page.url()).href
  const manifestResponse = await request.get(manifestUrl, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
  expect(manifestResponse.ok()).toBe(true)
  const manifest = await manifestResponse.json() as PrecacheManifest
  const expectedCacheName = `gamexr-shell-${manifest.buildDigest}`

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    await registration.update()
    registration.waiting?.postMessage('gamexr:skip-waiting')
  })
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload()
  }
  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false')

  await expect.poll(async () => page.evaluate(async (cacheName) => {
    const registration = await navigator.serviceWorker.getRegistration()
    registration?.waiting?.postMessage('gamexr:skip-waiting')
    const gameXrCaches = (await caches.keys()).filter((name) => name.startsWith('gamexr-shell-'))
    if (gameXrCaches.length !== 1 || gameXrCaches[0] !== cacheName) {
      return { active: false, controlled: false, gameXrCaches, markerMatches: false }
    }

    const cache = await caches.open(cacheName)
    const markerResponse = await cache.match(new URL('.gamexr-cache-active', document.URL))
    let markerMatches = false
    if (markerResponse) {
      try {
        const marker = await markerResponse.json()
        markerMatches = marker?.schema === 'gamexr-cache-marker/v1'
          && marker.state === 'active'
          && cacheName === `gamexr-shell-${marker.buildDigest}`
      } catch {
        markerMatches = false
      }
    }
    return {
      active: registration?.active?.state === 'activated',
      controlled: Boolean(navigator.serviceWorker.controller),
      gameXrCaches,
      markerMatches,
    }
  }, expectedCacheName), { timeout: 15_000 }).toEqual({
    active: true,
    controlled: true,
    gameXrCaches: [expectedCacheName],
    markerMatches: true,
  })

  const proof = await page.evaluate(async ({ cacheName, authoritativeManifest }) => {
    const cache = await caches.open(cacheName)
    const keys = (await cache.keys())
      .map((cachedRequest) => ({ method: cachedRequest.method, url: cachedRequest.url }))
      .sort((left, right) => left.url.localeCompare(right.url))
    const cachedManifestResponse = await cache.match(new URL('precache-manifest.json', document.URL))
    const readyMarkerResponse = await cache.match(new URL('.gamexr-cache-ready', document.URL))
    const activeMarkerResponse = await cache.match(new URL('.gamexr-cache-active', document.URL))
    const entries = await Promise.all(authoritativeManifest.entries.map(async (entry) => {
      const response = await cache.match(new URL(entry.path, document.URL))
      if (!response) return { path: entry.path, missing: true }
      const bytes = await response.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
      return { path: entry.path, missing: false, bytes: bytes.byteLength, sha256: hex }
    }))
    return {
      activeMarker: activeMarkerResponse ? await activeMarkerResponse.json() : null,
      cachedManifest: cachedManifestResponse ? await cachedManifestResponse.json() : null,
      entries,
      keys,
      readyMarker: readyMarkerResponse ? await readyMarkerResponse.json() : null,
    }
  }, { cacheName: expectedCacheName, authoritativeManifest: manifest })

  expect(manifest.schema).toBe('gamexr-precache/v1')
  expect(manifest.basePath).toBe('/gamexr/')
  expect(manifest.serviceWorkerRegistrationEnabled).toBe(true)
  expect(proof.cachedManifest).toEqual(manifest)
  expect(proof.readyMarker).toEqual({
    schema: 'gamexr-cache-marker/v1',
    state: 'ready',
    buildDigest: manifest.buildDigest,
  })
  expect(proof.activeMarker).toEqual({
    schema: 'gamexr-cache-marker/v1',
    state: 'active',
    buildDigest: manifest.buildDigest,
  })
  const expectedCacheUrls = [
    manifestUrl,
    ...manifest.entries.map((entry) => new URL(entry.path, page.url()).href),
    new URL('.gamexr-cache-ready', page.url()).href,
    new URL('.gamexr-cache-active', page.url()).href,
  ].sort((left, right) => left.localeCompare(right))
  expect(proof.keys).toEqual(expectedCacheUrls.map((url) => ({ method: 'GET', url })))
  for (const entry of manifest.entries) {
    const cached = proof.entries.find((candidate) => candidate.path === entry.path)
    expect(cached?.missing, entry.path).toBe(false)
    expect(cached?.bytes, entry.path).toBe(entry.bytes)
    expect(cached?.sha256, entry.path).toBe(entry.sha256)
  }
})
