export const PROFILE = 'gamexr.usb-diagnostics/v1'
export const STALE_MS = 1500
export type Vector = [number, number, number]
export type ImuStatus = 'ok' | 'not_ready' | 'io_error' | 'wrong_id' | 'config_error'
export type BatteryStatus = 'ok' | 'io_error' | 'no_efuse_calibration' | 'out_of_range'
export type Sample = { profile: typeof PROFILE; type: 'sample'; seq: number; uptime_ms: number;
  motor_gate_command: 'low_held'; imu: { status: ImuStatus; frame: 'sensor'; accel_m_s2: Vector | null; gyro_rad_s: Vector | null };
  battery: { status: BatteryStatus; raw: number | null; adc_mv: number | null; battery_mv: number | null } }
export type Boot = { profile: typeof PROFILE; type: 'boot'; hardware_profile: string; version: string; idf: string;
  motor_gate_command: 'low_held'; physical_isolation_verified: false; imu_status: ImuStatus; who_am_i: number; adc_init_code: number }
export type Fatal = { profile: typeof PROFILE; type: 'fatal'; error: string; code?: number }
export type Frame = Sample | Boot | Fatal
export type Source = 'usb' | 'replay'
export type Snapshot = { kind: 'diagnostics'; source: Source; session: number; transport: string; reason: string;
  ageMs: number | null; state: 'waiting' | 'live' | 'replay' | 'stale' | 'disconnected' | 'error';
  boot: Boot | null; sample: Sample | null; accepted: number; rejected: number; gaps: number; actuationAvailable: false }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join(',') !== expected.sort().join(',')) throw new Error('Unexpected fields')
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}
function vector(value: unknown, limit: number): value is Vector {
  return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit)
}
const imuStates: string[] = ['ok', 'not_ready', 'io_error', 'wrong_id', 'config_error']

/** Parse only the installed firmware contract. No HTML, command or arbitrary field forwarding. */
export function parseFrame(text: string): Frame {
  if (new TextEncoder().encode(text).length > 1024) throw new Error('Frame too large')
  const f = record(JSON.parse(text))
  if (f.profile !== PROFILE) throw new Error('Unsupported diagnostics profile')
  if (f.type === 'sample') {
    keys(f, ['profile', 'type', 'seq', 'uptime_ms', 'motor_gate_command', 'imu', 'battery'])
    const imu = record(f.imu), battery = record(f.battery)
    keys(imu, ['status', 'frame', 'accel_m_s2', 'gyro_rad_s'])
    keys(battery, ['status', 'raw', 'adc_mv', 'battery_mv'])
    if (!integer(f.seq, 0, 0xffffffff) || !integer(f.uptime_ms, 0, Number.MAX_SAFE_INTEGER)
      || f.motor_gate_command !== 'low_held' || imu.frame !== 'sensor'
      || typeof imu.status !== 'string' || !imuStates.includes(imu.status)) throw new Error('Invalid sample')
    if (imu.status === 'ok' ? !vector(imu.accel_m_s2, 45) || !vector(imu.gyro_rad_s, 10)
      : imu.accel_m_s2 !== null || imu.gyro_rad_s !== null) throw new Error('Invalid IMU values')
    if (typeof battery.status !== 'string' || !['ok', 'io_error', 'no_efuse_calibration', 'out_of_range'].includes(battery.status)
      || !(battery.raw === null || integer(battery.raw, 0, 4095))
      || !(battery.adc_mv === null || integer(battery.adc_mv, 0, 5000))) throw new Error('Invalid ADC values')
    if (battery.status === 'ok') {
      if (!integer(battery.adc_mv, 150, 2450) || !integer(battery.raw, 0, 4094)
        || battery.battery_mv !== Math.floor((battery.adc_mv * 43 + 16) / 33)) throw new Error('Invalid battery estimate')
    } else if (battery.battery_mv !== null) throw new Error('Invalid fault voltage')
    if (battery.status === 'io_error' && (battery.raw !== null || battery.adc_mv !== null)) throw new Error('Invalid failed ADC')
    if (battery.status === 'no_efuse_calibration' && battery.adc_mv !== null) throw new Error('Uncalibrated voltage')
    return f as unknown as Sample
  }
  if (f.type === 'boot') {
    keys(f, ['profile', 'type', 'hardware_profile', 'version', 'idf', 'motor_gate_command', 'physical_isolation_verified', 'imu_status', 'who_am_i', 'adc_init_code'])
    if (f.hardware_profile !== 'xw-z1-reference-esp32-mpu6500-v1' || f.motor_gate_command !== 'low_held'
      || f.physical_isolation_verified !== false || typeof f.imu_status !== 'string' || !imuStates.includes(f.imu_status)
      || !integer(f.who_am_i, 0, 255) || !integer(f.adc_init_code, -1, 65535)
      || ![f.version, f.idf].every(v => typeof v === 'string' && /^[\w.+-]{1,32}$/u.test(v))) throw new Error('Invalid boot identity')
    if (f.imu_status === 'ok' && f.who_am_i !== 0x70) throw new Error('Unexpected sensor identity')
    return f as unknown as Boot
  }
  if (f.type === 'fatal') {
    keys(f, f.code === undefined ? ['profile', 'type', 'error'] : ['profile', 'type', 'error', 'code'])
    if (typeof f.error !== 'string' || !['motor_inhibit_failed', 'telemetry_overflow'].includes(f.error)
      || f.code !== undefined && !integer(f.code, -1, 65535)) throw new Error('Invalid fatal record')
    return f as unknown as Fatal
  }
  throw new Error('Unknown frame type')
}

/** Host monotonic time defines freshness; device uptime only orders samples. */
export class DiagnosticsState {
  readonly source: Source
  session = 0; transport = 'waiting'; reason = 'Waiting for data'; boot: Boot | null = null
  sample: Sample | null = null; accepted = 0; rejected = 0; gaps = 0
  private at = -Infinity
  private previous: Sample | null = null
  private fault = false
  constructor(source: Source) { this.source = source }
  link(status: string, reason = status) {
    this.transport = status; this.reason = reason
    this.sample = null; this.previous = null; this.at = -Infinity; this.fault = false
    if (status === 'connected') { this.session++; this.boot = null }
  }
  ingest(text: string, now: number): boolean {
    try {
      const f = parseFrame(text)
      if (f.type === 'boot') {
        this.session++; this.boot = f; this.previous = null; this.sample = null; this.at = -Infinity; this.fault = false
        this.reason = 'Device boot observed'; return true
      }
      if (f.type === 'fatal') throw new Error(`Device error: ${f.error}`)
      if (this.previous) {
        if (f.uptime_ms <= this.previous.uptime_ms || f.seq <= this.previous.seq) throw new Error('Out-of-order sample; boot/reconnect required')
        this.gaps += f.seq - this.previous.seq - 1
      }
      this.previous = f; this.sample = f; this.at = now; this.accepted++; this.fault = false
      this.reason = f.imu.status === 'ok' ? 'Receiving telemetry' : `IMU: ${f.imu.status}`
      return true
    } catch (error) {
      this.rejected++; this.sample = null; this.fault = true
      this.reason = error instanceof Error ? error.message : 'Invalid telemetry'; return false
    }
  }
  snapshot(now: number): Snapshot {
    const ageMs = Number.isFinite(this.at) ? Math.max(0, Math.round(now - this.at)) : null
    const state = this.transport !== 'connected' ? (this.transport === 'waiting' ? 'waiting' : 'disconnected')
      : this.fault ? 'error' : ageMs === null ? 'waiting' : ageMs >= STALE_MS ? 'stale' : this.source === 'usb' ? 'live' : 'replay'
    return { kind: 'diagnostics', source: this.source, session: this.session, transport: this.transport, reason: this.reason,
      ageMs, state, boot: this.boot, sample: state === 'live' || state === 'replay' ? this.sample : null,
      accepted: this.accepted, rejected: this.rejected, gaps: this.gaps, actuationAvailable: false }
  }
}
