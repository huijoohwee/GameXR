import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import {
  mapDeviceOrientationDeltaToScreen,
} from '../shared/apple-spatial-input.ts'
import { DeviceOrientationController } from '../src/runtime/DeviceOrientationController.ts'
import { InputController } from '../src/runtime/InputController.ts'

class TrackedEventTarget extends EventTarget {
  readonly activeListeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, callback, options)
    if (!callback) return
    const listeners = this.activeListeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(callback)
    this.activeListeners.set(type, listeners)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, callback, options)
    if (callback) this.activeListeners.get(type)?.delete(callback)
  }

  listenerCount(type: string): number {
    return this.activeListeners.get(type)?.size ?? 0
  }
}

interface FakeDocument extends TrackedEventTarget {
  visibilityState: DocumentVisibilityState
}

interface FakeScreenOrientation extends TrackedEventTarget {
  angle: number
}

interface TestEnvironment {
  fakeDocument: FakeDocument
  fakeScreenOrientation: FakeScreenOrientation
  fakeWindow: TrackedEventTarget
  restore: () => void
}

function installEnvironment(deviceOrientationConstructor: unknown): TestEnvironment {
  const keys = ['window', 'document', 'screen', 'DeviceOrientationEvent'] as const
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const fakeWindow = new TrackedEventTarget()
  const fakeDocument = Object.assign(new TrackedEventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  })
  const fakeScreenOrientation = Object.assign(new TrackedEventTarget(), { angle: 0 })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: { orientation: fakeScreenOrientation },
  })
  Object.defineProperty(globalThis, 'DeviceOrientationEvent', {
    configurable: true,
    value: deviceOrientationConstructor,
  })
  return {
    fakeDocument,
    fakeScreenOrientation,
    fakeWindow,
    restore: () => {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

function orientationEvent(beta: number | null, gamma: number | null, timestamp: number): DeviceOrientationEvent {
  const event = new Event('deviceorientation')
  Object.defineProperties(event, {
    alpha: { value: 0 },
    beta: { value: beta },
    gamma: { value: gamma },
    absolute: { value: false },
    timeStamp: { value: timestamp },
  })
  return event as DeviceOrientationEvent
}

async function waitForListener(target: TrackedEventTarget, type: string): Promise<void> {
  for (let attempt = 0; attempt < 12 && target.listenerCount(type) === 0; attempt += 1) {
    await Promise.resolve()
  }
  assert.equal(target.listenerCount(type), 1, `expected one ${type} listener`)
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be close to ${expected}`)
}

test('permission is requested synchronously and sensor listeners wait for the grant', async () => {
  const permissionCalls: string[] = []
  let grantPermission: (permission: string) => void = () => undefined
  const permission = new Promise<string>((resolve) => { grantPermission = resolve })
  const environment = installEnvironment({
    requestPermission: () => {
      permissionCalls.push('orientation')
      return permission
    },
  })
  const manifest = getDefaultSceneManifest()
  manifest.motion.deviceMotionEnabled = true
  const input = new InputController(manifest)
  const phases: string[] = []
  const unsubscribe = input.subscribeDeviceOrientationLifecycle((snapshot) => phases.push(snapshot.phase))

  try {
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)
    const enabling = input.enableDeviceOrientation()
    assert.deepEqual(permissionCalls, ['orientation'])
    assert.equal(input.inspectDeviceOrientation().phase, 'requesting-permission')
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)

    grantPermission('granted')
    await waitForListener(environment.fakeWindow, 'deviceorientation')
    assert.equal(input.inspectDeviceOrientation().phase, 'calibrating')
    assert.equal(environment.fakeScreenOrientation.listenerCount('change'), 1)
    environment.fakeWindow.dispatchEvent(orientationEvent(18, -4, 1_000))
    const enabled = await enabling
    assert.equal(enabled.phase, 'running')
    assert.equal(enabled.permission, 'granted')
    assert.equal(enabled.calibrated, true)
    assert.equal(enabled.sampleCount, 1)
    assert.deepEqual(phases.slice(0, 3), ['requesting-permission', 'calibrating', 'running'])
  } finally {
    unsubscribe()
    input.dispose()
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)
    assert.equal(environment.fakeScreenOrientation.listenerCount('change'), 0)
    environment.restore()
  }
})

test('a denied permission never starts orientation or screen listeners', async () => {
  const environment = installEnvironment({ requestPermission: () => Promise.resolve('denied') })
  const controller = new DeviceOrientationController()
  try {
    const denied = await controller.enable()
    assert.equal(denied.phase, 'denied')
    assert.equal(denied.permission, 'denied')
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)
    assert.equal(environment.fakeWindow.listenerCount('pagehide'), 0)
    assert.equal(environment.fakeScreenOrientation.listenerCount('change'), 0)
  } finally {
    controller.dispose()
    environment.restore()
  }
})

test('portrait and both landscape rotations map pitch into screen-relative axes', () => {
  const portrait = mapDeviceOrientationDeltaToScreen(35, 0, 0)
  assertClose(portrait.pitchDegrees, 35)
  assertClose(portrait.rollDegrees, 0)

  const landscapeLeft = mapDeviceOrientationDeltaToScreen(35, 0, 90)
  assertClose(landscapeLeft.pitchDegrees, 0)
  assertClose(landscapeLeft.rollDegrees, -35)

  const landscapeRight = mapDeviceOrientationDeltaToScreen(35, 0, 270)
  assertClose(landscapeRight.pitchDegrees, 0)
  assertClose(landscapeRight.rollDegrees, 35)
})

test('first reliable sample calibrates, jitter is suppressed, and recenter resets neutral', async () => {
  const environment = installEnvironment({})
  const manifest = getDefaultSceneManifest()
  manifest.motion.deviceMotionEnabled = true
  const input = new InputController(manifest)

  try {
    const enabling = input.enableDeviceOrientation()
    await waitForListener(environment.fakeWindow, 'deviceorientation')
    environment.fakeWindow.dispatchEvent(orientationEvent(null, 4, 1_000))
    assert.equal(input.inspectDeviceOrientation().phase, 'calibrating')
    environment.fakeWindow.dispatchEvent(orientationEvent(10, 5, 1_016))
    await enabling
    assert.deepEqual(input.snapshot(), { throttle: 0, pitch: 0, yaw: 0, roll: 0, brake: 0 })

    environment.fakeWindow.dispatchEvent(orientationEvent(10.4, 5.4, 1_032))
    assert.equal(input.inspectDeviceOrientation().pitch, 0)
    assert.equal(input.inspectDeviceOrientation().roll, 0)

    environment.fakeWindow.dispatchEvent(orientationEvent(45, 5, 1_048))
    const steered = input.snapshot()
    assert.ok(steered.pitch > 0 && steered.pitch < 1, 'elapsed-time smoothing must avoid a one-sample jump')
    assert.equal(steered.roll, 0)

    const recentering = input.recenterDeviceOrientation()
    assert.equal(recentering.phase, 'calibrating')
    assert.equal(input.snapshot().pitch, 0)
    environment.fakeWindow.dispatchEvent(orientationEvent(45, 5, 1_064))
    assert.equal(input.inspectDeviceOrientation().phase, 'running')
    assert.equal(input.snapshot().pitch, 0)

    const disabledManifest = getDefaultSceneManifest()
    disabledManifest.motion.touchEnabled = false
    disabledManifest.motion.deviceMotionEnabled = false
    input.setThrottle(0.7)
    input.setTouchSteering(0.5, -0.4)
    input.configure(disabledManifest)
    assert.deepEqual(input.snapshot(), { throttle: 0, pitch: 0, yaw: 0, roll: 0, brake: 0 })
    assert.equal(input.inspectDeviceOrientation().phase, 'off')
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)
  } finally {
    input.dispose()
    environment.restore()
  }
})

test('screen rotation starts a fresh calibration and the next sample becomes neutral', async () => {
  const environment = installEnvironment({})
  const controller = new DeviceOrientationController()
  try {
    const enabling = controller.enable()
    await waitForListener(environment.fakeWindow, 'deviceorientation')
    environment.fakeWindow.dispatchEvent(orientationEvent(20, 2, 1_000))
    await enabling
    environment.fakeWindow.dispatchEvent(orientationEvent(35, 2, 1_016))
    assert.ok(controller.inspect().pitch > 0)

    environment.fakeScreenOrientation.angle = 90
    environment.fakeScreenOrientation.dispatchEvent(new Event('change'))
    assert.equal(controller.inspect().phase, 'calibrating')
    assert.equal(controller.inspect().pitch, 0)
    environment.fakeWindow.dispatchEvent(orientationEvent(35, 2, 1_032))
    const recalibrated = controller.inspect()
    assert.equal(recalibrated.phase, 'running')
    assert.equal(recalibrated.screenAngleDegrees, 90)
    assert.equal(recalibrated.pitch, 0)
    assert.equal(recalibrated.roll, 0)
  } finally {
    controller.dispose()
    environment.restore()
  }
})

test('no-sample timeout and page lifecycle remove every active listener', async () => {
  const environment = installEnvironment({})
  const controller = new DeviceOrientationController({ calibrationTimeoutMilliseconds: 250 })
  try {
    const unavailable = await controller.enable()
    assert.equal(unavailable.phase, 'unavailable')
    assert.equal(unavailable.permission, 'granted')
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)
    assert.equal(environment.fakeWindow.listenerCount('pagehide'), 0)
    assert.equal(environment.fakeDocument.listenerCount('visibilitychange'), 0)
    assert.equal(environment.fakeScreenOrientation.listenerCount('change'), 0)

    const enabling = controller.enable()
    await waitForListener(environment.fakeWindow, 'deviceorientation')
    environment.fakeWindow.dispatchEvent(orientationEvent(0, 0, 2_000))
    await enabling
    await new Promise((resolve) => setTimeout(resolve, 275))
    assert.equal(controller.inspect().phase, 'running', 'the first sample must clear the calibration timer')

    environment.fakeDocument.visibilityState = 'hidden'
    environment.fakeDocument.dispatchEvent(new Event('visibilitychange'))
    assert.equal(controller.inspect().phase, 'off')
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)
    assert.equal(environment.fakeScreenOrientation.listenerCount('change'), 0)

    environment.fakeDocument.visibilityState = 'visible'
    const enablingAgain = controller.enable()
    await waitForListener(environment.fakeWindow, 'deviceorientation')
    environment.fakeWindow.dispatchEvent(orientationEvent(0, 0, 3_000))
    await enablingAgain
    environment.fakeWindow.dispatchEvent(new Event('pagehide'))
    assert.equal(controller.inspect().phase, 'off')
    assert.equal(environment.fakeWindow.listenerCount('deviceorientation'), 0)
    assert.equal(environment.fakeWindow.listenerCount('pagehide'), 0)
  } finally {
    controller.dispose()
    environment.restore()
  }
})

test('device orientation runtime has no persistence or network egress path', () => {
  const source = readFileSync(new URL('../src/runtime/DeviceOrientationController.ts', import.meta.url), 'utf8')
  for (const forbidden of ['fetch(', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB']) {
    assert.equal(source.includes(forbidden), false, `device orientation runtime must not contain ${forbidden}`)
  }
})
