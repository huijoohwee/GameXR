import type { RuntimeTelemetry } from '../config/types.ts'

type RuntimePhase = RuntimeTelemetry['phase']

export function transportActionForPhase(phase: RuntimePhase): 'pause' | 'start' | 'none' {
  if (phase === 'running') return 'pause'
  if (phase === 'idle' || phase === 'paused') return 'start'
  return 'none'
}

export function transportLabelForPhase(phase: RuntimePhase): 'Pause' | 'Resume' | 'Start' {
  if (phase === 'running') return 'Pause'
  if (phase === 'paused') return 'Resume'
  return 'Start'
}
