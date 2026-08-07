import assert from 'node:assert/strict'
import test from 'node:test'
import { AnimationClip, Group } from 'three'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import { AnimationController } from '../src/runtime/AnimationController.ts'

test('an unavailable imported clip leaves the active animation unchanged', () => {
  const manifest = getDefaultSceneManifest()
  manifest.animation.importedClip = 'idle'
  const controller = new AnimationController(manifest)
  controller.attachImported(new Group(), [new AnimationClip('idle', 1, [])])
  assert.equal(controller.activeImportedClip, 'idle')

  const invalid = structuredClone(manifest)
  invalid.animation.importedClip = 'missing'
  assert.throws(() => controller.configure(invalid), /not available/u)
  assert.equal(controller.activeImportedClip, 'idle')
  controller.dispose()
})
