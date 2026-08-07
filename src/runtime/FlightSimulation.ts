import { Euler, Quaternion, Vector3 } from 'three'
import type { ControlState, SceneManifest, Vector3Tuple } from '../config/types.ts'

const FORWARD = new Vector3(0, 0, -1)
const EPSILON = 1e-6

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export interface FlightState {
  position: Vector3
  rotation: Quaternion
  velocity: Vector3
}

export class FlightSimulation {
  readonly state: FlightState = {
    position: new Vector3(),
    rotation: new Quaternion(),
    velocity: new Vector3(),
  }

  private manifest: SceneManifest
  private readonly forward = new Vector3()
  private readonly lateralVelocity = new Vector3()
  private readonly rotationDelta = new Quaternion()
  private readonly eulerDelta = new Euler(0, 0, 0, 'YXZ')
  private readonly boundedOrientation = new Euler(0, 0, 0, 'YXZ')

  constructor(manifest: SceneManifest) {
    this.manifest = manifest
    this.reset(manifest)
  }

  configure(manifest: SceneManifest): void {
    this.manifest = manifest
  }

  reset(manifest = this.manifest): void {
    this.manifest = manifest
    this.state.position.fromArray(manifest.ship.position)
    this.state.rotation.setFromEuler(new Euler(...manifest.ship.rotation, 'YXZ')).normalize()
    this.state.velocity.set(0, 0, 0)
  }

  step(deltaSeconds: number, controls: ControlState): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return
    const flight = this.manifest.ship.flight
    const pitch = clamp(controls.pitch, -1, 1) * flight.pitchRate * deltaSeconds
    const yaw = clamp(controls.yaw, -1, 1) * flight.yawRate * deltaSeconds
    const roll = clamp(controls.roll, -1, 1) * flight.rollRate * deltaSeconds

    this.eulerDelta.set(pitch, yaw, -roll, 'YXZ')
    this.rotationDelta.setFromEuler(this.eulerDelta)
    this.state.rotation.multiply(this.rotationDelta).normalize()
    this.boundedOrientation.setFromQuaternion(this.state.rotation, 'YXZ')
    this.boundedOrientation.z = clamp(this.boundedOrientation.z, -flight.bankAngle, flight.bankAngle)
    this.state.rotation.setFromEuler(this.boundedOrientation).normalize()

    this.forward.copy(FORWARD).applyQuaternion(this.state.rotation).normalize()
    const throttle = clamp(controls.throttle, -1, 1)
    const acceleration = throttle >= 0 ? flight.acceleration : flight.braking
    this.state.velocity.addScaledVector(this.forward, throttle * acceleration * deltaSeconds)

    const forwardSpeed = this.state.velocity.dot(this.forward)
    this.lateralVelocity.copy(this.state.velocity).addScaledVector(this.forward, -forwardSpeed)
    const lateralRetention = Math.exp(-flight.lateralAssist * deltaSeconds)
    this.state.velocity.addScaledVector(this.lateralVelocity, lateralRetention - 1)

    const dragRetention = Math.exp(-flight.drag * deltaSeconds)
    this.state.velocity.multiplyScalar(dragRetention)
    const brake = clamp(controls.brake, 0, 1)
    if (brake > 0) this.state.velocity.multiplyScalar(Math.exp(-flight.braking * brake * deltaSeconds))

    const currentForwardSpeed = this.state.velocity.dot(this.forward)
    if (currentForwardSpeed > flight.maxForwardSpeed) {
      this.state.velocity.addScaledVector(this.forward, flight.maxForwardSpeed - currentForwardSpeed)
    } else if (currentForwardSpeed < -flight.maxReverseSpeed) {
      this.state.velocity.addScaledVector(this.forward, -flight.maxReverseSpeed - currentForwardSpeed)
    }

    this.state.position.addScaledVector(this.state.velocity, deltaSeconds)
    this.wrapAtBounds(this.manifest.scene.boundsRadius)
  }

  private wrapAtBounds(radius: number): void {
    const distance = this.state.position.length()
    if (distance <= radius || distance < EPSILON) return
    this.state.position.multiplyScalar(-(radius - 1) / distance)
  }

  get speed(): number {
    return this.state.velocity.length()
  }

  get positionTuple(): Vector3Tuple {
    return this.state.position.toArray() as Vector3Tuple
  }

  get rotationTuple(): Vector3Tuple {
    const euler = new Euler().setFromQuaternion(this.state.rotation, 'YXZ')
    return [euler.x, euler.y, euler.z]
  }
}
