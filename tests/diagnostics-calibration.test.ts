import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitGyro, poseMean, fitSixFace, validatePose, correctedAccel, tilt, G, type Pose } from '../src/drone/diagnostics/calibration.ts'
import { PROFILE, type Sample, type Vector } from '../src/drone/diagnostics/protocol.ts'
function samples(accel: Vector = [0, 0, G], count = 200): Sample[] {
  return Array.from({ length: count }, (_, seq) => ({ profile: PROFILE, type: 'sample', seq, uptime_ms: seq * 100,
    motor_gate_command: 'low_held', imu: { status: 'ok', frame: 'sensor', accel_m_s2: accel,
      gyro_rad_s: [0.05 + (seq % 2 ? 0.0001 : -0.0001), -0.01, 0.02] },
    battery: { status: 'out_of_range', raw: 4095, adc_mv: 3100, battery_mv: null } }))
}
test('gyro bias requires user confirmation and an independent quiet validation window', () => {
  assert.throws(() => fitGyro(samples(), false), /confirmation/)
  assert.throws(() => fitGyro(samples().slice(0, 50), true), /More/)
  const fit = fitGyro(samples(), true)
  assert.ok(Math.abs(fit.biasRadS[0] - 0.05) < 1e-10)
  assert.ok(Math.abs(fit.heldOutResidualRadS[0]) < 1e-10)
  const drift = samples(); for (const s of drift.slice(100)) s.imu.gyro_rad_s![0] += 0.02
  assert.throws(() => fitGyro(drift, true), /validation/)
  const missing = samples(); missing[120]!.seq++
  assert.throws(() => fitGyro(missing, true), /interrupted/)
  const moving = samples(); moving[100]!.imu.accel_m_s2 = [0, 3, 9]
  assert.throws(() => fitGyro(moving, true), /Movement/)
})
test('six-face fit maps a rotated sensor frame and stays candidate until a new known pose passes', () => {
  const sensor = ([x, y, z]: Vector): Vector => [-y * 0.97 + 0.1, x * 1.02 - 0.2, z * 0.96 + 0.3]
  const poses: Partial<Record<Pose, Vector>> = {}
  for (const [pose, vector] of Object.entries({ '+X': [G, 0, 0], '-X': [-G, 0, 0], '+Y': [0, G, 0], '-Y': [0, -G, 0], '+Z': [0, 0, G], '-Z': [0, 0, -G] })) {
    poses[pose as Pose] = poseMean(samples(sensor(vector as Vector), 50), true)
  }
  const fit = fitSixFace(poses); assert.equal(fit.validated, false)
  const restored = correctedAccel(fit, sensor([1, 2, 3]))
  restored.forEach((v, i) => assert.ok(Math.abs(v - [1, 2, 3][i]!) < 1e-10))
  assert.ok(validatePose(fit, '+Z', samples(sensor([0, 0, G]), 50), true) < 1e-8)
  assert.throws(() => validatePose(fit, '+Z', samples(sensor([G, 0, 0]), 50), true), /failed/)
  assert.throws(() => fitSixFace({ ...poses, '+Z': poses['+X'] }), /scale|axes|handed|disagree/)
  assert.throws(() => fitSixFace({}), /six/)
  assert.equal(tilt([0, 0, G])?.yaw, null)
  assert.equal(tilt([0, 0, 20]), null)
})
