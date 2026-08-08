import type { SceneManifest } from '../config/types.ts'

export interface EngineAudioTargets {
  waveform: 'sawtooth'
  frequency: number
  gain: number
  lowPassFrequency: number
  filterQ: number
}

export function projectEngineAudioTargets(
  audio: SceneManifest['audio'],
  throttle: number,
  speed: number,
): EngineAudioTargets {
  const normalizedThrottle = Math.max(0, Math.min(1, throttle))
  const frequency = audio.engineBaseFrequency
    + normalizedThrottle * audio.engineThrottleRange
    + Math.min(speed, 60) * 0.8
  return {
    waveform: 'sawtooth',
    frequency,
    gain: audio.enabled ? audio.masterGain * (0.3 + normalizedThrottle * 0.7) : 0,
    lowPassFrequency: 180 + frequency * 3.4,
    filterQ: 1.4,
  }
}
