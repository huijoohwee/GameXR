// SPDX-License-Identifier: MIT
export interface TelemetrySample {
  profile: string; type: string; seq: number; motor_gate_command: string;
  imu: { status: string; accel_m_s2: number[]; gyro_rad_s: number[] };
}
export function readTelemetry(value: unknown, requestedAt: number, now: number,
  previous: { session: number; seq: number }) {
  const data = value as { schema: string; actuation_available: boolean; session: number;
    age_ms: number; sample: TelemetrySample };
  const s = data?.sample;
  if (data?.schema !== 'gamexr.direct-wifi/v1' || data.actuation_available !== false
    || !Number.isInteger(data.session) || data.session < 0 || data.session > 0xffffffff
    || !Number.isFinite(data.age_ms) || data.age_ms < 0 || now < requestedAt
    || data.age_ms + now - requestedAt >= 1500
    || s?.profile !== 'gamexr.usb-diagnostics/v1' || s.type !== 'sample'
    || s.motor_gate_command !== 'low_held' || s.imu?.status !== 'ok'
    || !Number.isInteger(s.seq) || s.seq < 0 || s.seq > 0xffffffff
    || !['gyro_rad_s', 'accel_m_s2'].every(k => {
      const vector = s.imu[k as keyof typeof s.imu];
      return Array.isArray(vector) && vector.length === 3 && vector.every(n =>
        Number.isFinite(n) && Math.abs(n) <= (k === 'gyro_rad_s' ? 35 : 80));
    })) throw new Error('Telemetry rejected');
  const restarted = data.session !== previous.session;
  if (!restarted && s.seq <= previous.seq) throw new Error('Telemetry replayed or stalled');
  // Conservatively count the entire round trip toward age, including TLS setup.
  return { sample: s, seq: s.seq, session: data.session, restarted, at: requestedAt - data.age_ms };
}
