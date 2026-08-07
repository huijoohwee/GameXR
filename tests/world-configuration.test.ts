import assert from 'node:assert/strict'
import test from 'node:test'
import { Scene } from 'three'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import { createWorld } from '../src/runtime/createWorld.ts'

test('environment selection projects distinct orbit and hangar scene features', () => {
  const orbitManifest = getDefaultSceneManifest()
  orbitManifest.scene.environment = 'orbit'
  orbitManifest.scene.starCount = 0
  orbitManifest.scene.asteroidCount = 0
  orbitManifest.scene.planet.enabled = false
  const orbit = createWorld(new Scene(), orbitManifest)
  assert(orbit.root.getObjectByName('gamexr-orbit-guide')?.children.length)
  assert.equal(orbit.root.getObjectByName('gamexr-hangar')?.children.length, 0)
  orbit.dispose()

  const hangarManifest = structuredClone(orbitManifest)
  hangarManifest.scene.environment = 'hangar'
  const hangar = createWorld(new Scene(), hangarManifest)
  assert(hangar.root.getObjectByName('gamexr-hangar')?.children.length)
  assert.equal(hangar.root.getObjectByName('gamexr-orbit-guide')?.children.length, 0)
  hangar.dispose()
})
