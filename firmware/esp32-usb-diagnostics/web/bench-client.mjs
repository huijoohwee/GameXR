// SPDX-License-Identifier: MIT
export function validateAck(value, expected) {
  if (value?.profile !== 'gamexr.usb-bench/v1' || value.type !== 'ack'
    || value.outputs_enabled !== false || value.lease_ms !== 250
    || !Array.isArray(value.motor_outputs) || value.motor_outputs.length !== 4
    || !value.motor_outputs.every(n => n === 0)
    || !Array.isArray(value.virtual_motors) || value.virtual_motors.length !== 4
    || !value.virtual_motors.every(n => Number.isInteger(n) && n >= 0 && n <= 200)
    || !Number.isInteger(value.session) || value.session < 1 || value.session > 0xffffffff
    || value.status !== expected.status || value.seq !== expected.seq
    || value.active !== (expected.status === 'accepted')
    || (expected.session && value.session !== expected.session)) throw new Error('Device acknowledgment rejected');
  return value;
}
export class BenchClient {
  constructor(key, { request = (...args) => globalThis.fetch(...args), report = () => {}, axes = () => [0, 0, 0, 0] } = {}) {
    this.key = key; this.request = request; this.report = report; this.axes = axes;
    this.epoch = 0; this.active = false; this.busy = false; this.timer = null;
  }
  async send(command, expected, epoch) {
    const controller = new AbortController();
    const budget = expected.status === 'ready' ? 1500 : 180;
    const timeout = setTimeout(() => controller.abort(), budget);
    const started = performance.now();
    try {
      const response = await this.request('/api/bench', { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain', 'X-GXR-Key': this.key }, body: command,
        signal: controller.signal });
      if (!response.ok) throw new Error(`Device HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 1024 || performance.now() - started >= budget) throw new Error('Acknowledgment expired');
      const ack = validateAck(JSON.parse(text), expected);
      if (epoch !== this.epoch) throw new Error('Session cancelled');
      return ack;
    } finally { clearTimeout(timeout); }
  }
  async enable() {
    if (this.busy || this.active) return;
    if (!/^[a-f0-9]{64}$/.test(this.key)) throw new Error('Open your private device pairing link');
    this.axes(); // Check input readiness before HELLO.
    this.busy = true; const epoch = ++this.epoch;
    try {
      const ack = await this.send('GXR1 HELLO', { status: 'ready', seq: 0 }, epoch);
      this.session = ack.session; this.seq = 0; this.active = true;
      this.report('Ready · virtual motors only', ack);
      this.timer = setTimeout(() => this.step(epoch), 100);
    } catch (error) { if (epoch === this.epoch) this.stop(error.message); }
    finally { this.busy = false; }
  }
  async step(epoch) {
    if (!this.active || epoch !== this.epoch) return;
    const started = performance.now();
    try {
      const values = this.axes();
      if (values.length !== 4 || !values.every(Number.isInteger)
        || values[0] < 0 || values[0] > 200 || values.slice(1).some(n => Math.abs(n) > 1000)) throw new Error('Invalid setpoint');
      const seq = ++this.seq;
      const ack = await this.send(`GXR1 SET ${this.session} ${seq} ${values.join(' ')}`,
        { status: 'accepted', session: this.session, seq }, epoch);
      this.report('Board accepted setpoint · physical outputs disabled', ack);
      this.timer = setTimeout(() => this.step(epoch), Math.max(50, 100 - (performance.now() - started)));
    } catch (error) { if (epoch === this.epoch) this.stop(error.message); }
  }
  stop(reason = 'Stopped') {
    const wasRunning = this.active || this.busy;
    this.active = false; this.epoch++; clearTimeout(this.timer);
    this.report(reason, null);
    // Best effort; the board independently expires the lease after 250 ms.
    if (wasRunning) void this.request('/api/bench', { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'text/plain', 'X-GXR-Key': this.key },
      body: 'GXR1 STOP', keepalive: true }).catch(() => {});
  }
}
