// SPDX-License-Identifier: MIT
export type CaptureSample = { seq: number; uptime_ms: number; motor_gate_command: string; imu: { status: string } };
export const CAPTURE_SAMPLES = 200, CAPTURE_LIMIT_MS = 35000, WINDOW_LIMIT_BYTES = 6000;
/** Transport owns cancellation; this bounded accumulator owns continuity and fit admission. */
export class ImuCapture<S extends CaptureSample> {
  samples: S[] = [];
  session: number | null = null;
  after = -1;
  active = false;
  status = 'idle';
  result: unknown = null;
  private started = 0;
  private progressed = 0;
  private previous: S | null = null;
  private parse: (text: string) => S;
  private fit: (samples: S[], confirmed: boolean) => unknown;
  constructor(parse: (text: string) => S, fit: (samples: S[], confirmed: boolean) => unknown) { this.parse = parse; this.fit = fit; }
  start(confirmed: boolean, now: number) {
    if (this.active) throw new Error('Capture already active');
    if (!confirmed || !Number.isFinite(now)) throw new Error('Confirm the board is stationary first');
    this.samples = []; this.session = null; this.after = -1; this.previous = null;
    this.result = null; this.started = this.progressed = now; this.active = true; this.status = 'capturing';
  }
  cancel(reason: string) { if (this.active) { this.active = false; this.status = reason; this.result = null; } }
  path() {
    return '/api/imu-window' + (this.session === null ? '' : `?session=${this.session}&after=${this.after}`);
  }
  ingest(text: string, requestedAt: number, now: number) {
    if (!this.active) return;
    try {
      if (!Number.isFinite(now) || !Number.isFinite(requestedAt) || requestedAt < this.started || now < requestedAt
        || now - this.started >= CAPTURE_LIMIT_MS) throw new Error('Capture timed out; start a new run');
      if (new TextEncoder().encode(text).length > WINDOW_LIMIT_BYTES) throw new Error('Oversized capture window');
      const w = JSON.parse(text);
      if (!w || Object.keys(w).sort().join(',') !== 'actuation_available,age_ms,samples,schema,session'
        || w.schema !== 'gamexr.imu-window/v1' || w.actuation_available !== false
        || !Number.isSafeInteger(w.session) || w.session < 0 || w.session > 0xffffffff
        || !Number.isFinite(w.age_ms) || w.age_ms < 0 || w.age_ms + now - requestedAt >= 1500
        || !Array.isArray(w.samples) || w.samples.length > 8) throw new Error('Invalid or stale capture window');
      if (this.session !== null && this.session !== w.session) throw new Error('Device restarted; start a new run');
      const parsed: S[] = w.samples.map((s: unknown) => this.parse(JSON.stringify(s)));
      if (parsed.some(s => s.motor_gate_command !== 'low_held' || s.imu.status !== 'ok')) throw new Error('Healthy IMU with motors disabled required');
      if (this.session === null) {
        if (parsed.length !== 1) throw new Error('Fresh capture baseline required');
        this.session = w.session; this.after = parsed[0]!.seq; this.previous = parsed[0]!;
        this.progressed = now; return; // Never fit samples collected before the operator starts.
      }
      for (const s of parsed) {
        if (s.seq !== this.after + 1 || !this.previous || s.uptime_ms - this.previous.uptime_ms < 50
          || s.uptime_ms - this.previous.uptime_ms > 200) throw new Error('Sampling interrupted; start a new run');
        this.after = s.seq; this.previous = s; this.progressed = now;
        this.samples.push(s);
        if (this.samples.length === CAPTURE_SAMPLES) {
          this.result = this.fit(this.samples, true);
          this.active = false; this.status = 'validated'; break;
        }
      }
      if (this.active && now - this.progressed >= 1500) throw new Error('Capture stalled; start a new run');
    } catch (error) { this.cancel((error as Error).message); throw error; }
  }
  evidence(origin: string, synthetic: boolean) {
    return { schema: 'gamexr.wifi-imu-capture/v1', created_at: new Date().toISOString(),
      transport: 'direct-wifi', origin, synthetic, session: this.session, status: this.status,
      stationary_confirmed: this.status !== 'idle', samples: this.samples,
      calibration: this.result, calibration_activated: false, physical_outputs_enabled: false,
      target_samples: CAPTURE_SAMPLES, deadline_ms: CAPTURE_LIMIT_MS,
      sensor_frame: 'sensor', physical_axis_mapping_verified: false };
  }
}
