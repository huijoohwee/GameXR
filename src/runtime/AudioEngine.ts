import type { SceneManifest } from '../config/types.ts'
import { projectEngineAudioTargets } from './engineAudioProjection.ts'

export class AudioEngine {
  private manifest: SceneManifest
  private context: AudioContext | null = null
  private oscillator: OscillatorNode | null = null
  private gain: GainNode | null = null
  private filter: BiquadFilterNode | null = null

  constructor(manifest: SceneManifest) {
    this.manifest = manifest
  }

  configure(manifest: SceneManifest): void {
    this.manifest = manifest
    this.update(0, 0)
  }

  async startFromUserGesture(): Promise<boolean> {
    if (!this.manifest.audio.enabled) return false
    const AudioContextConstructor = globalThis.AudioContext
    if (!AudioContextConstructor) return false
    this.context ??= new AudioContextConstructor({ latencyHint: 'interactive' })
    if (!this.oscillator || !this.gain || !this.filter) this.createGraph(this.context)
    if (this.context.state !== 'running') await this.context.resume()
    return this.context.state === 'running'
  }

  update(throttle: number, speed: number): void {
    if (!this.context || !this.oscillator || !this.gain || !this.filter) return
    const now = this.context.currentTime
    const targets = projectEngineAudioTargets(this.manifest.audio, throttle, speed)
    this.oscillator.frequency.setTargetAtTime(targets.frequency, now, 0.04)
    this.filter.frequency.setTargetAtTime(targets.lowPassFrequency, now, 0.08)
    this.gain.gain.setTargetAtTime(targets.gain, now, 0.06)
  }

  async suspend(): Promise<void> {
    if (this.context?.state === 'running') await this.context.suspend()
  }

  async dispose(): Promise<void> {
    this.oscillator?.stop()
    this.oscillator?.disconnect()
    this.filter?.disconnect()
    this.gain?.disconnect()
    this.oscillator = null
    this.filter = null
    this.gain = null
    if (this.context && this.context.state !== 'closed') await this.context.close()
    this.context = null
  }

  private createGraph(context: AudioContext): void {
    const oscillator = context.createOscillator()
    oscillator.type = projectEngineAudioTargets(this.manifest.audio, 0, 0).waveform
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = projectEngineAudioTargets(this.manifest.audio, 0, 0).filterQ
    const gain = context.createGain()
    gain.gain.value = 0
    oscillator.connect(filter).connect(gain).connect(context.destination)
    oscillator.start()
    this.oscillator = oscillator
    this.filter = filter
    this.gain = gain
  }
}
