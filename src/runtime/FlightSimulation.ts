import {
  createFlightSimModelProfile,
  integrateFlightModel,
  type FlightSimAircraftState,
  type FlightSimModelProfile,
} from '@agenticgraph/apple-spatial-input/flight'
import { Euler, Quaternion, Vector3 } from 'three'
import type { ControlState, SceneManifest, Vector3Tuple } from '../config/types.ts'

const EPSILON = 1e-6

export interface FlightState {
  position: Vector3
  rotation: Quaternion
  velocity: Vector3
}

function createProfile(manifest: SceneManifest): FlightSimModelProfile {
  const flight = manifest.ship.flight
  return createFlightSimModelProfile({
    maximumRollRadians: flight.bankAngle,
    stableRollRadians: Math.min(0.35, flight.bankAngle),
    pitchRateRadiansPerSecond: flight.pitchRate,
    yawRateRadiansPerSecond: flight.yawRate,
    rollRateRadiansPerSecond: flight.rollRate,
    thrustAcceleration: flight.acceleration,
    baseDrag: flight.drag,
    maximumAirspeedMetersPerSecond: flight.maxForwardSpeed,
    fullControlSpeedMetersPerSecond: Math.min(12, flight.maxForwardSpeed),
    stallSpeedMetersPerSecond: Math.min(7, Math.max(EPSILON, flight.maxForwardSpeed / 2)),
    velocityAlignmentRate: Math.min(1, flight.lateralAssist / 30),
  })
}

export class FlightSimulation {
  readonly state: FlightState = {
    position: new Vector3(),
    rotation: new Quaternion(),
    velocity: new Vector3(),
  }

  private manifest: SceneManifest
  private profile: FlightSimModelProfile
  private aircraft: FlightSimAircraftState

  constructor(manifest: SceneManifest) {
    this.manifest = manifest
    this.profile = createProfile(manifest)
    this.aircraft = this.initialAircraft(manifest)
    this.projectState()
  }

  configure(manifest: SceneManifest): void {
    this.manifest = manifest
    this.profile = createProfile(manifest)
  }

  reset(manifest = this.manifest): void {
    this.manifest = manifest
    this.profile = createProfile(manifest)
    this.aircraft = this.initialAircraft(manifest)
    this.projectState()
  }

  step(deltaSeconds: number, controls: ControlState): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
    const requestedThrottle = controls.brake > 0 ? 0 : Math.max(0, Math.min(1, controls.throttle))
    this.aircraft = integrateFlightModel(this.aircraft, {
      pitch: controls.pitch,
      roll: controls.roll,
      yaw: controls.yaw,
      throttleDelta: Math.max(-1, Math.min(1, requestedThrottle - this.aircraft.throttle)),
    }, deltaSeconds, this.profile)
    this.wrapAtBounds(this.manifest.scene.boundsRadius)
    this.projectState()
  }

  private initialAircraft(manifest: SceneManifest): FlightSimAircraftState {
    return Object.freeze({
      position: Object.freeze([...manifest.ship.position]) as Vector3Tuple,
      velocity: Object.freeze([0, 0, 0]) as Vector3Tuple,
      pitch: manifest.ship.rotation[0],
      yaw: manifest.ship.rotation[1],
      roll: -manifest.ship.rotation[2],
      throttle: 0,
    })
  }

  private wrapAtBounds(radius: number): void {
    const position = new Vector3().fromArray(this.aircraft.position)
    const distance = position.length()
    if (distance <= radius || distance < EPSILON) return
    position.multiplyScalar(-(radius - 1) / distance)
    this.aircraft = Object.freeze({
      ...this.aircraft,
      position: Object.freeze(position.toArray()) as Vector3Tuple,
    })
  }

  private projectState(): void {
    this.state.position.fromArray(this.aircraft.position)
    this.state.velocity.fromArray(this.aircraft.velocity)
    this.state.rotation.setFromEuler(new Euler(this.aircraft.pitch, this.aircraft.yaw, -this.aircraft.roll, 'YXZ')).normalize()
  }

  get canonicalAircraft(): FlightSimAircraftState {
    return this.aircraft
  }

  get speed(): number {
    return this.state.velocity.length()
  }

  get positionTuple(): Vector3Tuple {
    return this.state.position.toArray() as Vector3Tuple
  }

  get rotationTuple(): Vector3Tuple {
    return [this.aircraft.pitch, this.aircraft.yaw, -this.aircraft.roll]
  }
}
