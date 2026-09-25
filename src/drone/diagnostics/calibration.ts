import type { Sample, Vector } from './protocol.ts'
export const G = 9.80665
export type GyroCalibration = { schema: 'gamexr/gyro-bias/v1'; biasRadS: Vector; heldOutResidualRadS: Vector;
  fitSamples: number; validationSamples: number; firstSeq: number; lastSeq: number; stationaryConfirmed: true }
export type Pose = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z'
export const POSES: Pose[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']
export type Matrix = [Vector, Vector, Vector]
export type AccelCalibration = { schema: 'gamexr/accel-six-face/v1'; offset: Vector; correction: Matrix;
  validated: false; frame: 'board-x-forward-y-left-z-up' }
const mean = (rows: Vector[]): Vector => [0, 1, 2].map(i => rows.reduce((sum, v) => sum + v[i]!, 0) / rows.length) as Vector
export const norm = (v: Vector) => Math.hypot(...v)
export const subtract = (a: Vector, b: Vector): Vector => a.map((n, i) => n - b[i]!) as Vector
const deviation = (rows: Vector[], center = mean(rows)): number => Math.max(...[0, 1, 2].map(i =>
  Math.sqrt(rows.reduce((sum, v) => sum + (v[i]! - center[i]!) ** 2, 0) / rows.length)))

function stationary(samples: Sample[], minimum: number) {
  if (samples.length < minimum || samples.some(s => s.imu.status !== 'ok' || !s.imu.accel_m_s2 || !s.imu.gyro_rad_s)) throw new Error('More valid IMU samples needed')
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!
    if (b.seq !== a.seq + 1 || b.uptime_ms - a.uptime_ms < 50 || b.uptime_ms - a.uptime_ms > 200) throw new Error('Sampling interrupted; restart capture')
  }
  if (samples.at(-1)!.uptime_ms - samples[0]!.uptime_ms < (minimum - 1) * 90) throw new Error('Capture too short')
  const accel = samples.map(s => s.imu.accel_m_s2!), gyro = samples.map(s => s.imu.gyro_rad_s!)
  if (deviation(gyro) > 0.02 || deviation(accel) > 0.12 || norm(mean(gyro)) > 0.25
    || norm(mean(accel)) < 8.5 || norm(mean(accel)) > 11.1) throw new Error('Movement or implausible readings; retry while stationary')
  return { accel, gyro }
}

/** Fit the first half; validate on a later, independent stationary window. */
export function fitGyro(samples: Sample[], confirmed: boolean): GyroCalibration {
  if (!confirmed) throw new Error('Stationary confirmation required')
  const { gyro } = stationary(samples, 200), middle = Math.floor(gyro.length / 2)
  const bias = mean(gyro.slice(0, middle))
  const residual = subtract(mean(gyro.slice(middle)), bias)
  if (norm(residual) > 0.01 || deviation(gyro.slice(middle)) > 0.01) throw new Error('Independent bias validation failed')
  return { schema: 'gamexr/gyro-bias/v1', biasRadS: bias, heldOutResidualRadS: residual,
    fitSamples: middle, validationSamples: gyro.length - middle, firstSeq: samples[0]!.seq,
    lastSeq: samples.at(-1)!.seq, stationaryConfirmed: true }
}

export function poseMean(samples: Sample[], confirmed: boolean): Vector {
  if (!confirmed) throw new Error('Known pose confirmation required')
  return mean(stationary(samples, 50).accel)
}
const multiply = (m: Matrix, v: Vector): Vector => m.map(row => row.reduce((sum, n, i) => sum + n * v[i]!, 0)) as Vector
function inverse(m: Matrix): Matrix {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (det < 0.5 || det > 1.8) throw new Error('Poses do not define the expected right-handed axes')
  return [[e*i-f*h, c*h-b*i, b*f-c*e], [f*g-d*i, a*i-c*g, c*d-a*f], [d*h-e*g, b*g-a*h, a*e-b*d]]
    .map(row => row.map(n => n / det)) as Matrix
}
export function fitSixFace(poses: Partial<Record<Pose, Vector>>): AccelCalibration {
  if (POSES.some(p => !poses[p] || !poses[p]!.every(Number.isFinite))) throw new Error('All six known poses are required')
  const centers: Vector[] = [], columns: Vector[] = []
  for (const axis of ['X', 'Y', 'Z']) {
    const plus = poses[`+${axis}` as Pose]!, minus = poses[`-${axis}` as Pose]!
    const column = subtract(plus, minus).map(n => n / (2 * G)) as Vector
    if (norm(column) < 0.8 || norm(column) > 1.2) throw new Error('Pose scale is implausible')
    columns.push(column); centers.push(plus.map((n, i) => (n + minus[i]!) / 2) as Vector)
  }
  const offset = mean(centers)
  if (norm(offset) > 1.5 || centers.some(v => norm(subtract(v, offset)) > 0.25)) throw new Error('Opposite poses disagree')
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    if (Math.abs(columns[i]!.reduce((sum, n, k) => sum + n * columns[j]![k]!, 0)) > 0.15) throw new Error('Pose axes are not orthogonal')
  }
  const forward = [0, 1, 2].map(i => columns.map(col => col[i]!)) as Matrix
  return { schema: 'gamexr/accel-six-face/v1', offset, correction: inverse(forward), validated: false,
    frame: 'board-x-forward-y-left-z-up' }
}
export function correctedAccel(calibration: AccelCalibration, sample: Vector): Vector {
  return multiply(calibration.correction, subtract(sample, calibration.offset))
}
export function validatePose(calibration: AccelCalibration, pose: Pose, samples: Sample[], confirmed: boolean): number {
  const value = correctedAccel(calibration, poseMean(samples, confirmed))
  const expected: Vector = [0, 0, 0]
  expected['XYZ'.indexOf(pose[1]!)] = pose[0] === '+' ? G : -G
  const error = norm(subtract(value, expected))
  if (error > 0.3) throw new Error('Independent pose check failed; calibration remains inactive')
  return error
}
export function tilt(accel: Vector): { roll: number; pitch: number; yaw: null } | null {
  if (Math.abs(norm(accel) - G) > 1.5) return null
  return { roll: Math.atan2(accel[1], accel[2]) * 180 / Math.PI,
    pitch: Math.atan2(-accel[0], Math.hypot(accel[1], accel[2])) * 180 / Math.PI, yaw: null }
}
