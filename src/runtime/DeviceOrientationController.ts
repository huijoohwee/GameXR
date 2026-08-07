import {
  APPLE_SPATIAL_INPUT_SCHEMA,
  BrowserAppleSensorController,
  DEFAULT_APPLE_SPATIAL_INPUT_PROFILE,
  createAppleSpatialInputProfile,
  type AppleSensorSnapshot,
  type AppleSpatialInputProfile,
} from '@knowgrph/apple-spatial-input'

export const DEVICE_ORIENTATION_SCHEMA = 'gamexr.device-orientation/v2' as const

export type DeviceOrientationPhase =
  | 'off'
  | 'requesting-permission'
  | 'calibrating'
  | 'running'
  | 'denied'
  | 'unavailable'
  | 'disposed'

export type DeviceOrientationPermission = 'unknown' | 'prompting' | 'granted' | 'denied' | 'unavailable'

export interface DeviceOrientationSnapshot {
  readonly schema: typeof DEVICE_ORIENTATION_SCHEMA
  readonly spatialInputSchema: typeof APPLE_SPATIAL_INPUT_SCHEMA
  readonly phase: DeviceOrientationPhase
  readonly permission: DeviceOrientationPermission
  readonly calibrated: boolean
  readonly sampleCount: number
  readonly pitch: number
  readonly roll: number
  readonly screenAngleDegrees: number
  readonly message: string
  readonly revision: number
}

export interface DeviceOrientationControllerOptions {
  profile?: AppleSpatialInputProfile
  calibrationTimeoutMilliseconds?: number
}

type LifecycleSubscriber = (snapshot: DeviceOrientationSnapshot) => void

export class DeviceOrientationController {
  private readonly controller: BrowserAppleSensorController
  private readonly lifecycleSubscribers = new Set<LifecycleSubscriber>()
  private snapshotValue: DeviceOrientationSnapshot
  private disposed = false

  constructor(options: DeviceOrientationControllerOptions = {}) {
    const requestedProfile = options.profile ?? DEFAULT_APPLE_SPATIAL_INPUT_PROFILE
    const profile = createAppleSpatialInputProfile({
      ...requestedProfile,
      calibrationTimeoutMilliseconds: options.calibrationTimeoutMilliseconds
        ?? requestedProfile.calibrationTimeoutMilliseconds,
    })
    this.controller = new BrowserAppleSensorController({
      profile,
      enableMotion: false,
      enableOrientation: true,
    })
    this.snapshotValue = this.project(this.controller.readSnapshot())
    this.controller.subscribe(() => this.publish(this.controller.readSnapshot()))
  }

  inspect(): DeviceOrientationSnapshot {
    return this.snapshotValue
  }

  subscribeLifecycle(subscriber: LifecycleSubscriber): () => void {
    this.lifecycleSubscribers.add(subscriber)
    return () => this.lifecycleSubscribers.delete(subscriber)
  }

  configure(profile: AppleSpatialInputProfile): DeviceOrientationSnapshot {
    this.controller.configureProfile(profile)
    return this.snapshotValue
  }

  async enable(): Promise<DeviceOrientationSnapshot> {
    if (this.disposed) return this.snapshotValue
    const enabled = await this.controller.enable()
    if (enabled.phase !== 'running' || enabled.calibrated) return this.snapshotValue
    return new Promise((resolve) => {
      const unsubscribe = this.subscribeLifecycle((snapshot) => {
        if (snapshot.phase === 'calibrating') return
        unsubscribe()
        resolve(snapshot)
      })
    })
  }

  disable(message = 'Device orientation is disabled.'): DeviceOrientationSnapshot {
    if (!this.disposed) this.controller.disable(message)
    return this.snapshotValue
  }

  recenter(): DeviceOrientationSnapshot {
    if (!this.disposed) this.controller.recenter()
    return this.snapshotValue
  }

  dispose(): void {
    if (this.disposed) return
    this.controller.dispose()
    this.disposed = true
    this.snapshotValue = Object.freeze({
      ...this.snapshotValue,
      phase: 'disposed',
      message: 'Device orientation resources were released.',
      revision: this.snapshotValue.revision + 1,
    })
    for (const subscriber of this.lifecycleSubscribers) subscriber(this.snapshotValue)
    this.lifecycleSubscribers.clear()
  }

  private project(snapshot: AppleSensorSnapshot): DeviceOrientationSnapshot {
    const timedOut = snapshot.message.startsWith('No orientation sample arrived')
    const phase: DeviceOrientationPhase = timedOut
      ? 'unavailable'
      : snapshot.phase === 'running' && !snapshot.calibrated
      ? 'calibrating'
      : snapshot.phase === 'error' ? 'unavailable' : snapshot.phase
    return Object.freeze({
      schema: DEVICE_ORIENTATION_SCHEMA,
      spatialInputSchema: snapshot.spatialInputSchema,
      phase,
      permission: snapshot.permission,
      calibrated: snapshot.calibrated,
      sampleCount: snapshot.sampleCount,
      pitch: snapshot.pitch,
      roll: snapshot.roll,
      screenAngleDegrees: snapshot.screenAngleDegrees,
      message: snapshot.message,
      revision: snapshot.revision,
    })
  }

  private publish(snapshot: AppleSensorSnapshot): void {
    if (snapshot.phase === 'running'
      && !snapshot.calibrated
      && snapshot.message.startsWith('No orientation sample arrived')) {
      this.controller.disable(snapshot.message)
      return
    }
    this.snapshotValue = this.project(snapshot)
    for (const subscriber of this.lifecycleSubscribers) subscriber(this.snapshotValue)
  }
}
