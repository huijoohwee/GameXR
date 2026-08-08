import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import {
  projectProceduralShipAnimation,
  projectProceduralWorldAnimationDelta,
} from '../src/runtime/proceduralAnimationProjection.ts'

test('procedural ship and world animation targets stay source-owned and deterministic', () => {
  const manifest = getDefaultSceneManifest()
  assert.deepEqual(projectProceduralShipAnimation(manifest.animation, 1.25, 0.6), {
    exhaustScaleY: 1.323815870894148,
    leftWingRotationZ: 0.008014880833098965,
    rightWingRotationZ: -0.008014880833098965,
  })
  assert.deepEqual(projectProceduralWorldAnimationDelta(manifest.scene, manifest.animation, 0.5), {
    planetYaw: 0.0125,
    asteroidFieldYaw: 0.004,
  })
})

test('paused animation projects zero world motion', () => {
  const manifest = getDefaultSceneManifest()
  manifest.animation.playing = false
  assert.deepEqual(projectProceduralWorldAnimationDelta(manifest.scene, manifest.animation, 10), {
    planetYaw: 0,
    asteroidFieldYaw: 0,
  })
})
