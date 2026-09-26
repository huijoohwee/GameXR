import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startDiagnosticsBridge } from '../tools/drone-bridge/diagnostics.ts'
import { PROFILE } from '../src/drone/diagnostics/protocol.ts'

const temporary = await mkdtemp(join(tmpdir(), 'gamexr-synthetic-diagnostics-'))
const capture = join(temporary, 'synthetic.jsonl')
const frames = Array.from({ length: 300 }, (_, seq) => JSON.stringify({ profile: PROFILE,
  type: 'sample', seq, uptime_ms: seq * 100, motor_gate_command: 'low_held',
  imu: { status: 'ok', frame: 'sensor', accel_m_s2: [0.1, 0.2, 9.8], gyro_rad_s: [0.01, 0.02, 0.03] },
  battery: { status: 'out_of_range', raw: 4095, adc_mv: 3100, battery_mv: null } }))
await writeFile(capture, frames.join('\n'))
const bridge = await startDiagnosticsBridge({ root: resolve('dist/gamexr'), port: 4195,
  input: { kind: 'replay', path: capture } })
const close = async () => { await bridge.close(); await rm(temporary, { recursive: true, force: true }) }
process.once('SIGTERM', close); process.once('SIGINT', close)
