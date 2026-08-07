import type { ControlState, SceneManifest } from '../config/types.ts'
import {
  DeviceOrientationController,
  type DeviceOrientationSnapshot,
} from './DeviceOrientationController.ts'

const ZERO_CONTROLS: ControlState = { throttle: 0, pitch: 0, yaw: 0, roll: 0, brake: 0 }

function axis(negative: boolean, positive: boolean): number {
  return Number(positive) - Number(negative)
}

function applyDeadZone(value: number, deadZone: number): number {
  const magnitude = Math.abs(value)
  if (magnitude <= deadZone) return 0
  return Math.sign(value) * (magnitude - deadZone) / (1 - deadZone)
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

export class InputController {
  private manifest: SceneManifest
  private readonly keys = new Set<string>()
  private touchPitch = 0
  private touchRoll = 0
  private touchYaw = 0
  private throttle = 0
  private brake = 0
  private readonly deviceOrientation: DeviceOrientationController
  private disposed = false

  constructor(manifest: SceneManifest) {
    this.manifest = manifest
    this.deviceOrientation = new DeviceOrientationController({ profile: manifest.motion.deviceOrientation })
    window.addEventListener('keydown', this.handleKeyDown, { passive: false })
    window.addEventListener('keyup', this.handleKeyUp)
    window.addEventListener('blur', this.clearTransientInput)
  }

  configure(manifest: SceneManifest): void {
    this.deviceOrientation.configure(manifest.motion.deviceOrientation)
    if (!manifest.motion.touchEnabled) {
      this.clearTouchSteering()
      this.throttle = 0
      this.brake = 0
    }
    if (!manifest.motion.deviceMotionEnabled
      && ['requesting-permission', 'calibrating', 'running'].includes(this.deviceOrientation.inspect().phase)) {
      this.deviceOrientation.disable('Device orientation stopped because it is disabled in the active manifest.')
    }
    this.manifest = manifest
  }

  setThrottle(value: number): void {
    this.throttle = clampAxis(value)
  }

  setBrake(value: number): void {
    const nextBrake = Math.max(0, Math.min(1, value))
    if (nextBrake > 0 && this.brake === 0) this.pulseHaptic()
    this.brake = nextBrake
  }

  setTouchSteering(pitch: number, roll: number, yaw = roll * 0.55): void {
    this.touchPitch = clampAxis(pitch)
    this.touchRoll = clampAxis(roll)
    this.touchYaw = clampAxis(yaw)
  }

  clearTouchSteering(): void {
    this.touchPitch = 0
    this.touchRoll = 0
    this.touchYaw = 0
  }

  snapshot(): ControlState {
    if (this.disposed) return { ...ZERO_CONTROLS }
    const motion = this.manifest.motion
    const keyboardPitch = motion.keyboardEnabled ? axis(this.keys.has('KeyS'), this.keys.has('KeyW')) : 0
    const keyboardRoll = motion.keyboardEnabled ? axis(this.keys.has('KeyA'), this.keys.has('KeyD')) : 0
    const keyboardYaw = motion.keyboardEnabled ? axis(this.keys.has('KeyQ'), this.keys.has('KeyE')) : 0
    const keyboardThrottle = motion.keyboardEnabled ? axis(this.keys.has('KeyX'), this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) : 0
    const keyboardBrake = motion.keyboardEnabled && this.keys.has('Space') ? 1 : 0
    const pitchDirection = motion.invertPitch ? -1 : 1
    const touchPitch = motion.touchEnabled ? this.touchPitch : 0
    const touchRoll = motion.touchEnabled ? this.touchRoll : 0
    const touchYaw = motion.touchEnabled ? this.touchYaw : 0
    const touchThrottle = motion.touchEnabled ? this.throttle : 0
    const touchBrake = motion.touchEnabled ? this.brake : 0
    const orientation = this.deviceOrientation.inspect()
    const motionPitch = motion.deviceMotionEnabled && orientation.phase === 'running' ? orientation.pitch : 0
    const motionRoll = motion.deviceMotionEnabled && orientation.phase === 'running' ? orientation.roll : 0

    return {
      throttle: clampAxis(touchThrottle + keyboardThrottle),
      pitch: this.normalize((keyboardPitch + touchPitch + motionPitch) * pitchDirection),
      yaw: this.normalize(keyboardYaw + touchYaw),
      roll: this.normalize(keyboardRoll + touchRoll + motionRoll),
      brake: Math.max(touchBrake, keyboardBrake),
    }
  }

  enableDeviceOrientation(): Promise<DeviceOrientationSnapshot> {
    return this.deviceOrientation.enable()
  }

  disableDeviceOrientation(): DeviceOrientationSnapshot {
    return this.deviceOrientation.disable()
  }

  recenterDeviceOrientation(): DeviceOrientationSnapshot {
    return this.deviceOrientation.recenter()
  }

  inspectDeviceOrientation(): DeviceOrientationSnapshot {
    return this.deviceOrientation.inspect()
  }

  subscribeDeviceOrientationLifecycle(
    subscriber: (snapshot: DeviceOrientationSnapshot) => void,
  ): () => void {
    return this.deviceOrientation.subscribeLifecycle(subscriber)
  }

  pulseHaptic(durationMilliseconds = 18): void {
    if (this.manifest.motion.hapticsEnabled && navigator.vibrate) navigator.vibrate(durationMilliseconds)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    window.removeEventListener('blur', this.clearTransientInput)
    this.deviceOrientation.dispose()
    this.keys.clear()
  }

  private normalize(value: number): number {
    const scaled = clampAxis(value * this.manifest.motion.sensitivity)
    return applyDeadZone(scaled, this.manifest.motion.deadZone)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.manifest.motion.keyboardEnabled) return
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyX', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault()
      this.keys.add(event.code)
    }
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private readonly clearTransientInput = (): void => {
    this.keys.clear()
    this.clearTouchSteering()
    this.brake = 0
  }

}
