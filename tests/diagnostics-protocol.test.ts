import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DiagnosticsState, parseFrame, PROFILE, STALE_MS } from '../src/drone/diagnostics/protocol.ts'
const sample = (seq = 0) => ({ profile: PROFILE, type: 'sample', seq, uptime_ms: seq * 100 + 300,
  motor_gate_command: 'low_held', imu: { status: 'ok', frame: 'sensor', accel_m_s2: [0, 0, 9.81], gyro_rad_s: [0, 0, 0] },
  battery: { status: 'ok', raw: 2830, adc_mv: 2437, battery_mv: Math.floor((2437 * 43 + 16) / 33) } })
const boot = { profile: PROFILE, type: 'boot', hardware_profile: 'xw-z1-reference-esp32-mpu6500-v1',
  version: '0.1.0', idf: 'v6.1', motor_gate_command: 'low_held', physical_isolation_verified: false,
  imu_status: 'ok', who_am_i: 112, adc_init_code: 0 }

test('diagnostics rejects unsupported identity, actuation values and invented fault voltage', () => {
  assert.equal(parseFrame(JSON.stringify(sample())).type, 'sample')
  for (const altered of [{ ...sample(), profile: 'legacy' }, { ...sample(), motor_gate_command: 'armed' },
    { ...boot, who_am_i: 113 }, { ...sample(), extra: true }, { ...sample(), uptime_ms: -1 },
    { ...sample(), imu: { ...sample().imu, gyro_rad_s: [1e100, 0, 0] } },
    { ...sample(), battery: { ...sample().battery, status: 'out_of_range' } },
    { ...sample(), battery: { ...sample().battery, status: ['out_of_range'], battery_mv: null } },
    { ...sample(), imu: { ...sample().imu, status: ['io_error'], accel_m_s2: null, gyro_rad_s: null } },
    { ...boot, imu_status: ['ok'] },
    { ...sample(), battery: { ...sample().battery, battery_mv: 9999 } }]) {
    assert.throws(() => parseFrame(JSON.stringify(altered)))
  }
  assert.throws(() => parseFrame('{"profile":NaN}'))
  assert.throws(() => parseFrame('x'.repeat(1025)))
  const bad = sample(); bad.imu.status = 'io_error'
  assert.throws(() => parseFrame(JSON.stringify(bad)))
})
test('stale, duplicate, missing and rebooted samples cannot silently refresh the display', () => {
  const state = new DiagnosticsState('usb'); state.link('connected')
  state.ingest(JSON.stringify(boot), 0)
  assert.ok(state.ingest(JSON.stringify(sample()), 10))
  assert.equal(state.snapshot(11).state, 'live')
  assert.equal(state.snapshot(10 + STALE_MS).sample, null)
  assert.equal(state.snapshot(10 + STALE_MS).state, 'stale')
  assert.equal(state.ingest(JSON.stringify(sample()), 2000), false)
  assert.equal(state.snapshot(2000).state, 'error')
  assert.ok(state.ingest(JSON.stringify(sample(3)), 2100)); assert.equal(state.gaps, 2)
  const session = state.session
  state.ingest(JSON.stringify(boot), 2200)
  assert.ok(state.session > session); assert.equal(state.snapshot(2200).sample, null)
  assert.ok(state.ingest(JSON.stringify(sample()), 2300))
  state.link('disconnected'); assert.equal(state.snapshot(2301).sample, null)
  state.link('connected'); assert.ok(state.ingest(JSON.stringify(sample()), 2400))
})
test('replay keeps explicit historical provenance and no actuation capability', () => {
  const state = new DiagnosticsState('replay'); state.link('connected')
  state.ingest(JSON.stringify(sample()), 0)
  const s = state.snapshot(10)
  assert.equal(s.state, 'replay'); assert.equal(s.source, 'replay'); assert.equal(s.actuationAvailable, false)
})
