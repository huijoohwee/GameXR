import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import { projectEngineAudioTargets } from '../src/runtime/engineAudioProjection.ts'

test('default engine audio targets preserve the browser procedural contract', () => {
  const { audio } = getDefaultSceneManifest()
  assert.deepEqual(projectEngineAudioTargets(audio, 0.5, 12), {
    waveform: 'sawtooth',
    frequency: 123.6,
    gain: 0.10399999999999998,
    lowPassFrequency: 600.24,
    filterQ: 1.4,
  })
})

test('engine audio clamps throttle and mutes only when the manifest disables audio', () => {
  const { audio } = getDefaultSceneManifest()
  const saturated = projectEngineAudioTargets(audio, 4, 80)
  assert.equal(saturated.frequency, 218)
  assert.equal(saturated.gain, 0.16)

  audio.enabled = false
  assert.equal(projectEngineAudioTargets(audio, -2, 0).gain, 0)
})
