import assert from 'node:assert/strict'
import test from 'node:test'
import { transportActionForPhase, transportLabelForPhase } from '../src/ui/runtimeStatus.ts'

test('flight transport exposes a reversible start, pause, and resume path', () => {
  assert.deepEqual(
    ['idle', 'running', 'paused', 'blocked', 'disposed'].map((phase) => [
      phase,
      transportActionForPhase(phase as Parameters<typeof transportActionForPhase>[0]),
      transportLabelForPhase(phase as Parameters<typeof transportLabelForPhase>[0]),
    ]),
    [
      ['idle', 'start', 'Start'],
      ['running', 'pause', 'Pause'],
      ['paused', 'start', 'Resume'],
      ['blocked', 'none', 'Start'],
      ['disposed', 'none', 'Start'],
    ],
  )
})
