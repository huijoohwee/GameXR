import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyManifestPatch,
  getDefaultSceneManifest,
  parseSceneManifest,
  serializeSceneManifest,
  validateSceneManifest,
} from '../src/config/manifest.ts'

test('bundled manifest validates and round-trips without changing its contract', () => {
  const manifest = getDefaultSceneManifest()
  assert.equal(manifest.motion.deviceOrientation.schema, 'airvio.apple-spatial-input/v1')
  const roundTrip = parseSceneManifest(serializeSceneManifest(manifest))
  assert.equal(roundTrip.ok, true)
  if (roundTrip.ok) assert.deepEqual(roundTrip.value, manifest)
})

test('portable Apple motion shaping is closed and range-validated', () => {
  const manifest = getDefaultSceneManifest()
  const outOfRange = validateSceneManifest({
    ...manifest,
    motion: {
      ...manifest.motion,
      deviceOrientation: {
        ...manifest.motion.deviceOrientation,
        smoothingRatePerSecond: 61,
      },
    },
  })
  assert.equal(outOfRange.ok, false)
  if (!outOfRange.ok) {
    assert(outOfRange.issues.some((issue) => issue.includes('smoothingRatePerSecond')))
  }

  const withUnknownField = getDefaultSceneManifest() as unknown as {
    motion: { deviceOrientation: Record<string, unknown> }
  }
  withUnknownField.motion.deviceOrientation.legacyAxisAlias = true
  const unknown = validateSceneManifest(withUnknownField)
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert(unknown.issues.some((issue) => issue.includes('legacyAxisAlias')))
})

test('validator rejects unknown and out-of-budget fields', () => {
  const manifest = getDefaultSceneManifest() as unknown as Record<string, unknown>
  manifest.legacySceneAlias = 'forbidden'
  const scene = manifest.scene as Record<string, unknown>
  scene.asteroidCount = 129
  const validation = validateSceneManifest(manifest)
  assert.equal(validation.ok, false)
  if (!validation.ok) {
    assert(validation.issues.some((issue) => issue.includes('legacySceneAlias')))
    assert(validation.issues.some((issue) => issue.includes('asteroidCount')))
  }
})

test('camera contract rejects chase heights that canonical AgenticGraph cannot resolve', () => {
  const manifest = getDefaultSceneManifest()
  manifest.camera.chaseHeight = 0
  const validation = validateSceneManifest(manifest)
  assert.equal(validation.ok, false)
  if (!validation.ok) assert(validation.issues.some((issue) => issue.includes('chaseHeight')))
})

test('manifest patch is deep, closed, and preserves unrelated values', () => {
  const manifest = getDefaultSceneManifest()
  const validation = applyManifestPatch(manifest, {
    scene: { asteroidCount: 8 },
    animation: { timeScale: 0.5 },
  })
  assert.equal(validation.ok, true)
  if (!validation.ok) return
  assert.equal(validation.value.scene.asteroidCount, 8)
  assert.equal(validation.value.animation.timeScale, 0.5)
  assert.equal(validation.value.ship.flight.maxForwardSpeed, manifest.ship.flight.maxForwardSpeed)
})

test('asset contract does not accept a local id on the procedural owner', () => {
  const manifest = getDefaultSceneManifest()
  manifest.ship.asset.localAssetId = 'asset-invalid'
  const validation = validateSceneManifest(manifest)
  assert.equal(validation.ok, false)
  if (!validation.ok) assert(validation.issues.some((issue) => issue.includes('must be null')))
})
