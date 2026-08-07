import {
  APPLE_SPATIAL_INPUT_SCHEMA,
  DEFAULT_APPLE_SPATIAL_INPUT_PROFILE,
  appleSpatialInputProfilesEqual,
  createAppleSpatialInputProfile,
  finiteSpatialInputNumber,
  projectAppleSpatialInput,
  resetAppleSpatialInputState,
  type AppleSpatialInputProfile,
  type AppleSpatialInputState,
} from '../../shared/apple-spatial-input.ts'

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

interface PermissionedDeviceOrientationEventConstructor {
  requestPermission?: () => Promise<string>
}

export interface DeviceOrientationControllerOptions {
  profile?: AppleSpatialInputProfile
  calibrationTimeoutMilliseconds?: number
}

type LifecycleSubscriber = (snapshot: DeviceOrientationSnapshot) => void

function readScreenAngleDegrees(): number {
  if (typeof screen === 'undefined') return 0
  return finiteSpatialInputNumber(screen.orientation?.angle) ?? 0
}

function readOrientationConstructor(): PermissionedDeviceOrientationEventConstructor | undefined {
  return (globalThis as unknown as {
    DeviceOrientationEvent?: PermissionedDeviceOrientationEventConstructor
  }).DeviceOrientationEvent
}

function requestOrientationPermission(
  constructor: PermissionedDeviceOrientationEventConstructor,
): Promise<'granted' | 'denied'> {
  const requestPermission = constructor.requestPermission
  if (typeof requestPermission !== 'function') return Promise.resolve('granted')
  try {
    return Promise.resolve(requestPermission.call(constructor)).then(
      (result) => result === 'granted' ? 'granted' : 'denied',
      () => 'denied',
    )
  } catch {
    return Promise.resolve('denied')
  }
}

export class DeviceOrientationController {
  private snapshotValue: DeviceOrientationSnapshot = Object.freeze({
    schema: DEVICE_ORIENTATION_SCHEMA,
    spatialInputSchema: APPLE_SPATIAL_INPUT_SCHEMA,
    phase: 'off',
    permission: 'unknown',
    calibrated: false,
    sampleCount: 0,
    pitch: 0,
    roll: 0,
    screenAngleDegrees: 0,
    message: 'Device orientation stays off until enabled by a direct gesture.',
    revision: 0,
  })
  private readonly lifecycleSubscribers = new Set<LifecycleSubscriber>()
  private profile: AppleSpatialInputProfile
  private spatialInputState: AppleSpatialInputState = resetAppleSpatialInputState()
  private intentRevision = 0
  private sensorListenerInstalled = false
  private screenOrientationListenerInstalled = false
  private lifecycleListenersInstalled = false
  private calibrationTimer: ReturnType<typeof setTimeout> | null = null
  private calibrationWaiters = new Set<(snapshot: DeviceOrientationSnapshot) => void>()
  private disposed = false

  constructor(options: DeviceOrientationControllerOptions = {}) {
    const requestedProfile = options.profile ?? DEFAULT_APPLE_SPATIAL_INPUT_PROFILE
    this.profile = createAppleSpatialInputProfile({
      ...requestedProfile,
      calibrationTimeoutMilliseconds: options.calibrationTimeoutMilliseconds
        ?? requestedProfile.calibrationTimeoutMilliseconds,
    })
  }

  inspect(): DeviceOrientationSnapshot {
    return this.snapshotValue
  }

  subscribeLifecycle(subscriber: LifecycleSubscriber): () => void {
    this.lifecycleSubscribers.add(subscriber)
    return () => this.lifecycleSubscribers.delete(subscriber)
  }

  configure(profile: AppleSpatialInputProfile): DeviceOrientationSnapshot {
    const nextProfile = createAppleSpatialInputProfile(profile)
    if (appleSpatialInputProfilesEqual(nextProfile, this.profile)) return this.snapshotValue
    this.profile = nextProfile
    if (this.snapshotValue.phase === 'running' || this.snapshotValue.phase === 'calibrating') {
      this.beginCalibration('Motion profile changed; the next orientation sample sets a fresh neutral pose.')
    }
    return this.snapshotValue
  }

  enable(): Promise<DeviceOrientationSnapshot> {
    if (this.disposed) return Promise.resolve(this.snapshotValue)
    const intent = ++this.intentRevision
    this.removeSensorListener()
    this.removeScreenOrientationListener()
    this.removeLifecycleListeners()
    this.clearCalibrationTimer()
    this.resolveCalibrationWaiters()
    this.resetMeasurements()

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.publishLifecycle({
        phase: 'unavailable',
        permission: 'unavailable',
        message: 'Device orientation is unavailable outside a browser.',
      })
      return Promise.resolve(this.snapshotValue)
    }
    if (String(document.visibilityState) === 'hidden') {
      this.publishLifecycle({
        phase: 'off',
        permission: 'unknown',
        message: 'Device orientation cannot start while the page is hidden.',
      })
      return Promise.resolve(this.snapshotValue)
    }

    const constructor = readOrientationConstructor()
    if (!constructor) {
      this.publishLifecycle({
        phase: 'unavailable',
        permission: 'unavailable',
        message: 'This browser does not expose device orientation.',
      })
      return Promise.resolve(this.snapshotValue)
    }

    this.publishLifecycle({
      phase: 'requesting-permission',
      permission: 'prompting',
      message: 'Waiting for device orientation permission.',
    })
    this.installLifecycleListeners()

    // Safari requires this call to remain in the synchronous direct-gesture stack.
    const permissionRequest = requestOrientationPermission(constructor)
    return this.finishEnable(intent, permissionRequest)
  }

  disable(message = 'Device orientation is disabled.'): DeviceOrientationSnapshot {
    if (this.disposed) return this.snapshotValue
    ++this.intentRevision
    this.removeSensorListener()
    this.removeScreenOrientationListener()
    this.removeLifecycleListeners()
    this.clearCalibrationTimer()
    this.resetMeasurements()
    const permission = this.snapshotValue.permission === 'prompting' ? 'unknown' : this.snapshotValue.permission
    this.publishLifecycle({ phase: 'off', permission, message })
    this.resolveCalibrationWaiters()
    return this.snapshotValue
  }

  recenter(): DeviceOrientationSnapshot {
    if (this.disposed || (this.snapshotValue.phase !== 'running' && this.snapshotValue.phase !== 'calibrating')) {
      return this.snapshotValue
    }
    this.beginCalibration('Hold the phone comfortably; the next orientation sample sets neutral.')
    return this.snapshotValue
  }

  dispose(): void {
    if (this.disposed) return
    ++this.intentRevision
    this.removeSensorListener()
    this.removeScreenOrientationListener()
    this.removeLifecycleListeners()
    this.clearCalibrationTimer()
    this.resetMeasurements()
    this.disposed = true
    this.publishLifecycle({
      phase: 'disposed',
      message: 'Device orientation resources were released.',
    })
    this.resolveCalibrationWaiters()
    this.lifecycleSubscribers.clear()
  }

  private async finishEnable(
    intent: number,
    permissionRequest: Promise<'granted' | 'denied'>,
  ): Promise<DeviceOrientationSnapshot> {
    const permission = await permissionRequest
    if (intent !== this.intentRevision || this.disposed) return this.snapshotValue
    if (permission !== 'granted') {
      this.removeLifecycleListeners()
      this.publishLifecycle({
        phase: 'denied',
        permission: 'denied',
        message: 'Device orientation permission was denied; no sensor listener was started.',
      })
      return this.snapshotValue
    }
    if (String(document.visibilityState) === 'hidden') {
      return this.disable('Device orientation did not start because the page became hidden.')
    }

    this.beginCalibration('Hold the phone comfortably; the first orientation sample sets neutral.', 'granted')
    const calibrated = new Promise<DeviceOrientationSnapshot>((resolve) => {
      this.calibrationWaiters.add(resolve)
    })
    this.installSensorListener()
    this.installScreenOrientationListener()
    return calibrated
  }

  private beginCalibration(
    message: string,
    permission: DeviceOrientationPermission = this.snapshotValue.permission,
  ): void {
    this.clearCalibrationTimer()
    this.resetMeasurements()
    this.publishLifecycle({ phase: 'calibrating', permission, message })
    const calibrationIntent = this.intentRevision
    this.calibrationTimer = setTimeout(() => {
      if (calibrationIntent !== this.intentRevision || this.snapshotValue.phase !== 'calibrating') return
      this.calibrationTimer = null
      this.removeSensorListener()
      this.removeScreenOrientationListener()
      this.removeLifecycleListeners()
      this.resetMeasurements()
      this.publishLifecycle({
        phase: 'unavailable',
        message: 'No device orientation sample arrived; motion control was stopped.',
      })
      this.resolveCalibrationWaiters()
    }, this.profile.calibrationTimeoutMilliseconds)
  }

  private resetMeasurements(): void {
    this.spatialInputState = resetAppleSpatialInputState()
    this.snapshotValue = Object.freeze({
      ...this.snapshotValue,
      calibrated: false,
      sampleCount: 0,
      pitch: 0,
      roll: 0,
      screenAngleDegrees: readScreenAngleDegrees(),
    })
  }

  private publishLifecycle(
    update: Partial<Omit<DeviceOrientationSnapshot, 'schema' | 'spatialInputSchema' | 'revision'>>,
  ): void {
    this.snapshotValue = Object.freeze({
      ...this.snapshotValue,
      ...update,
      revision: this.snapshotValue.revision + 1,
    })
    for (const subscriber of this.lifecycleSubscribers) {
      try {
        subscriber(this.snapshotValue)
      } catch (error) {
        console.error('[GameXR] device orientation lifecycle subscriber failed', error)
      }
    }
  }

  private updateMeasurements(update: Pick<DeviceOrientationSnapshot,
    'sampleCount' | 'pitch' | 'roll' | 'screenAngleDegrees'>): void {
    this.snapshotValue = Object.freeze({
      ...this.snapshotValue,
      ...update,
      revision: this.snapshotValue.revision + 1,
    })
  }

  private resolveCalibrationWaiters(): void {
    const waiters = this.calibrationWaiters
    this.calibrationWaiters = new Set()
    for (const resolve of waiters) resolve(this.snapshotValue)
  }

  private clearCalibrationTimer(): void {
    if (this.calibrationTimer === null) return
    clearTimeout(this.calibrationTimer)
    this.calibrationTimer = null
  }

  private installSensorListener(): void {
    this.removeSensorListener()
    if (typeof window === 'undefined') return
    window.addEventListener('deviceorientation', this.handleOrientation)
    this.sensorListenerInstalled = true
  }

  private removeSensorListener(): void {
    if (!this.sensorListenerInstalled || typeof window === 'undefined') {
      this.sensorListenerInstalled = false
      return
    }
    window.removeEventListener('deviceorientation', this.handleOrientation)
    this.sensorListenerInstalled = false
  }

  private installScreenOrientationListener(): void {
    this.removeScreenOrientationListener()
    if (typeof screen === 'undefined' || !screen.orientation) return
    screen.orientation.addEventListener('change', this.handleScreenOrientationChange)
    this.screenOrientationListenerInstalled = true
  }

  private removeScreenOrientationListener(): void {
    if (!this.screenOrientationListenerInstalled || typeof screen === 'undefined' || !screen.orientation) {
      this.screenOrientationListenerInstalled = false
      return
    }
    screen.orientation.removeEventListener('change', this.handleScreenOrientationChange)
    this.screenOrientationListenerInstalled = false
  }

  private installLifecycleListeners(): void {
    this.removeLifecycleListeners()
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    window.addEventListener('pagehide', this.handlePageLifecycle)
    document.addEventListener('visibilitychange', this.handlePageLifecycle)
    this.lifecycleListenersInstalled = true
  }

  private removeLifecycleListeners(): void {
    if (!this.lifecycleListenersInstalled || typeof window === 'undefined' || typeof document === 'undefined') {
      this.lifecycleListenersInstalled = false
      return
    }
    window.removeEventListener('pagehide', this.handlePageLifecycle)
    document.removeEventListener('visibilitychange', this.handlePageLifecycle)
    this.lifecycleListenersInstalled = false
  }

  private readonly handlePageLifecycle = (event: Event): void => {
    if (event.type === 'visibilitychange' && document.visibilityState !== 'hidden') return
    this.disable('Device orientation stopped because the page is no longer active.')
  }

  private readonly handleScreenOrientationChange = (): void => {
    if (this.snapshotValue.phase !== 'running' && this.snapshotValue.phase !== 'calibrating') return
    this.beginCalibration('Screen orientation changed; the next sample sets a fresh neutral pose.')
  }

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    if (this.snapshotValue.phase !== 'calibrating' && this.snapshotValue.phase !== 'running') return
    const betaDegrees = finiteSpatialInputNumber(event.beta)
    const gammaDegrees = finiteSpatialInputNumber(event.gamma)
    if (betaDegrees === null || gammaDegrees === null) return
    const screenAngleDegrees = readScreenAngleDegrees()
    const projection = projectAppleSpatialInput(this.spatialInputState, {
      betaDegrees,
      gammaDegrees,
      screenAngleDegrees,
      timestampMilliseconds: event.timeStamp,
    }, this.profile)
    this.spatialInputState = projection.state

    if (projection.calibratedNow) {
      this.clearCalibrationTimer()
      this.snapshotValue = Object.freeze({
        ...this.snapshotValue,
        calibrated: true,
        sampleCount: 1,
        pitch: 0,
        roll: 0,
        screenAngleDegrees,
      })
      this.publishLifecycle({
        phase: 'running',
        message: 'Device orientation is calibrated and controlling flight locally.',
      })
      this.resolveCalibrationWaiters()
      return
    }

    this.updateMeasurements({
      sampleCount: this.snapshotValue.sampleCount + 1,
      pitch: projection.state.pitch,
      roll: projection.state.roll,
      screenAngleDegrees,
    })
  }
}
