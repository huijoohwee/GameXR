import { clampSpatialInputAxis } from '@agenticgraph/apple-spatial-input/filter'

/** Host bench contract. This is not a flight-qualified aircraft profile. */
export const BENCH = Object.freeze({
  profile: 'esp-drone-rpyt-bench/v1', device: 'simulated-esp32',
  cadenceMs: 40, leaseMs: 250, telemetryMaxAgeMs: 300,
  maxTiltDegrees: 10, maxYawDegreesPerSecond: 45, maxThrust: 10000,
})

export type Axes = { roll: number; pitch: number; yaw: number; throttle: number }
export const PATH_PROFILE = 'simulated-drone-path/v1'
export type PathPose = [tick: number, x: number, z: number, heading: number, altitude: number]
export type PathCommand = { kind: 'path'; profile: typeof PATH_PROFILE; session: string; challenge: string; sequence: number; pose: PathPose }
export const neutralAxes = (): Axes => ({ roll: 0, pitch: 0, yaw: 0, throttle: 0 })
export type ReceiverTelemetry = {
  source: 'simulated'; device: string; firmware: string; profile: string
  challenge: string; sample: number; session: string | null; enabled: boolean; sequence: number
  commandAgeMs: number | null; setpoint: Axes; motorOutputs: false
  batteryVolts: null; attitudeDegrees: null; reason: string
  pathProfile?: typeof PATH_PROFILE; pathPose?: PathPose | null
}
export type PilotCommand = {
  kind: 'controls'; profile: string; session: string; challenge: string; sequence: number; axes: Axes
}
export type BridgeStatus = {
  kind: 'status'; backend: 'simulated'; connected: boolean; owned: boolean
  session: string | null; enabled: boolean; reason: string
  telemetry: ReceiverTelemetry | null; telemetryAgeMs: number | null
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required')
  return value as Record<string, unknown>
}

export function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Unsupported or missing command fields')
  }
}

export function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{16,64}$/u.test(value)) throw new Error('Invalid session or challenge')
  return value
}

export function parseAxes(value: unknown): Axes {
  const axes = object(value)
  exactKeys(axes, ['roll', 'pitch', 'yaw', 'throttle'])
  for (const name of ['roll', 'pitch', 'yaw', 'throttle']) {
    const number = axes[name]
    if (typeof number !== 'number' || !Number.isFinite(number)
      || number < (name === 'throttle' ? 0 : -1) || number > 1) throw new Error(`Invalid ${name}`)
  }
  return { roll: axes.roll as number, pitch: axes.pitch as number,
    yaw: axes.yaw as number, throttle: axes.throttle as number }
}

export function parseCommand(value: unknown): PilotCommand {
  const message = object(value)
  exactKeys(message, ['kind', 'profile', 'session', 'challenge', 'sequence', 'axes'])
  if (message.kind !== 'controls' || message.profile !== BENCH.profile) throw new Error('Wrong command/profile')
  if (!Number.isSafeInteger(message.sequence) || (message.sequence as number) < 1) throw new Error('Invalid sequence')
  return { kind: 'controls', profile: BENCH.profile, session: token(message.session),
    challenge: token(message.challenge), sequence: message.sequence as number, axes: parseAxes(message.axes) }
}

export function parsePathPose(value: unknown): PathPose {
  if (!Array.isArray(value) || value.length !== 5 || !value.every(n => typeof n === 'number' && Number.isFinite(n))
    || !Number.isInteger(value[0]) || value[0] < 0 || value[0] > 7200 || Math.abs(value[1]) > 8 || Math.abs(value[2]) > 8
    || value[3] < 0 || value[3] >= 360 || value[4] < 0 || value[4] > 4) throw new Error('Invalid path pose')
  return [...value] as PathPose
}
export function parsePathCommand(value: unknown): PathCommand {
  const message = object(value)
  exactKeys(message, ['kind', 'profile', 'session', 'challenge', 'sequence', 'pose'])
  if (message.kind !== 'path' || message.profile !== PATH_PROFILE || !Number.isSafeInteger(message.sequence)
    || (message.sequence as number) < 1) throw new Error('Wrong path command/profile')
  return { kind: 'path', profile: PATH_PROFILE, session: token(message.session), challenge: token(message.challenge),
    sequence: message.sequence as number, pose: parsePathPose(message.pose) }
}

/** Independent axes: no game throttle accumulation, yaw coupling or Brake mapping. */
export function shapeAxis(value: number, deadZone = 0.06): number {
  if (!Number.isFinite(value) || !Number.isFinite(deadZone) || deadZone < 0 || deadZone >= 1) {
    throw new Error('Invalid axis calibration')
  }
  const magnitude = Math.abs(clampSpatialInputAxis(value))
  return magnitude <= deadZone ? 0 : Math.sign(value) * (magnitude - deadZone) / (1 - deadZone)
}
