import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three'
import type { SceneManifest } from '../config/types.ts'
import type { ShipVisualReferences } from './createProceduralShip.ts'

export class AnimationController {
  private manifest: SceneManifest
  private procedural: ShipVisualReferences | null = null
  private importedRoot: Object3D | null = null
  private importedClips: AnimationClip[] = []
  private mixer: AnimationMixer | null = null
  private action: AnimationAction | null = null
  private elapsedSeconds = 0

  constructor(manifest: SceneManifest) {
    this.manifest = manifest
  }

  configure(manifest: SceneManifest): void {
    const previousClip = this.manifest.animation.importedClip
    const clipChanged = previousClip !== manifest.animation.importedClip
    if (clipChanged && this.mixer) this.selectImportedClip(manifest.animation.importedClip, manifest)
    this.manifest = manifest
    if (!clipChanged && this.action) this.applyLoopState()
    this.applyTransportState()
  }

  attachProcedural(references: ShipVisualReferences): void {
    this.procedural = references
  }

  attachImported(root: Object3D, clips: AnimationClip[]): void {
    this.releaseImported()
    this.importedRoot = root
    this.importedClips = [...clips]
    this.mixer = new AnimationMixer(root)
    this.selectImportedClip(this.manifest.animation.importedClip, this.manifest)
  }

  get availableImportedClips(): string[] {
    return this.importedClips.map((clip) => clip.name)
  }

  get activeImportedClip(): string | null {
    return this.action?.getClip().name ?? null
  }

  play(): void {
    this.manifest.animation.playing = true
    if (this.action) this.action.paused = false
  }

  pause(): void {
    this.manifest.animation.playing = false
    if (this.action) this.action.paused = true
  }

  reset(): void {
    this.elapsedSeconds = 0
    this.action?.reset()
    if (this.action && this.manifest.animation.playing) this.action.play()
  }

  scrub(normalizedTime: number): void {
    if (!this.action || !this.mixer) return
    const duration = this.action.getClip().duration
    this.mixer.setTime(Math.max(0, Math.min(1, normalizedTime)) * duration)
  }

  update(deltaSeconds: number, throttle: number): void {
    if (!this.manifest.animation.playing) return
    const animation = this.manifest.animation
    const scaledDelta = deltaSeconds * animation.timeScale
    this.elapsedSeconds += scaledDelta
    this.mixer?.update(scaledDelta)

    if (!this.procedural) return
    const pulse = 1 + Math.sin(this.elapsedSeconds * animation.exhaustPulseSpeed) * animation.exhaustPulseAmount
    const exhaustScale = Math.max(0.18, 0.35 + Math.max(0, throttle) * 1.4) * pulse
    for (const exhaust of this.procedural.exhausts) exhaust.scale.set(1, exhaustScale, 1)
    const wingFlex = Math.sin(this.elapsedSeconds * 2.2) * animation.wingFlexAmount * Math.max(0.2, Math.abs(throttle))
    this.procedural.leftWing.rotation.z = wingFlex
    this.procedural.rightWing.rotation.z = -wingFlex
  }

  dispose(): void {
    this.releaseImported()
    this.procedural = null
  }

  private selectImportedClip(name: string | null, manifest: SceneManifest): void {
    if (!name || !this.mixer) {
      this.action?.stop()
      this.action = null
      return
    }
    const clip = this.importedClips.find((candidate) => candidate.name === name)
    if (!clip) throw new Error(`Imported animation clip “${name}” is not available.`)
    this.action?.stop()
    const action = this.mixer.clipAction(clip)
    action.setLoop(manifest.animation.importedClipLoop ? LoopRepeat : LoopOnce, manifest.animation.importedClipLoop ? Infinity : 1)
    action.clampWhenFinished = !manifest.animation.importedClipLoop
    this.action = action.reset().play()
  }

  private applyLoopState(): void {
    if (!this.action) return
    const loop = this.manifest.animation.importedClipLoop
    this.action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
    this.action.clampWhenFinished = !loop
  }

  private applyTransportState(): void {
    if (!this.action) return
    this.action.paused = !this.manifest.animation.playing
    this.action.timeScale = this.manifest.animation.timeScale
  }

  private releaseImported(): void {
    if (this.mixer && this.importedRoot) {
      this.mixer.stopAllAction()
      this.mixer.uncacheRoot(this.importedRoot)
    }
    this.action = null
    this.mixer = null
    this.importedRoot = null
    this.importedClips = []
  }
}
