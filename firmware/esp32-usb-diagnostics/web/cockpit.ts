// SPDX-License-Identifier: MIT
import { DeviceOrientationController } from '@gamexr/motion';
import { CameraView } from '@gamexr/camera';
import { DEFAULT_APPLE_SPATIAL_INPUT_PROFILE } from '@agenticgraph/apple-spatial-input';
import { BenchClient } from './bench-client.mjs';
import { CockpitInput } from './cockpit-input.ts';
import { CockpitControls } from './cockpit-controls.ts';
import { readTelemetry } from './live-telemetry.ts';
import { renderDroneShell } from './drone-shell.ts';
import { CalibrationPanel } from './calibration-panel.ts';
import { OtaPanel } from './ota-panel.ts';
import './cockpit.css';

renderDroneShell(document.getElementById('app')!);

const key = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';
history.replaceState(null, '', location.pathname + location.search);
const root = document.createElement('aside'); root.id = 'wifi-cockpit';
root.innerHTML = `<button class="wifi-open">Connection</button><section class="wifi-panel" aria-label="Direct Wi-Fi drone connection" hidden>
  <header><div><small>GAMEXR · DIRECT WI-FI</small><h2>Drone connection</h2></div><button data-close>Close</button></header>
  <p class="wifi-boundary">Real board · virtual motors · physical outputs disabled</p>
  <p data-status role="status">Motion is the default input.</p>
  <p>Use the main joystick, throttle, Start/Pause and BRAKE. Touch the joystick to select Touch; Enable Motion selects phone tilt. Switching inputs stops the session.</p>
  <p data-motion-status>Tap Enable Motion and hold your phone comfortably to calibrate.</p>
  <p data-ack>No command session · virtual outputs 0 / 0 / 0 / 0</p>
  <p data-telemetry>Waiting for live IMU</p><div data-camera></div>
  <details><summary>Input response and limits</summary><p>Historical input curve: 40% expo, 6% dead zone, roll/pitch ×0.85. Motion spans ±30° from neutral. Bench targets are rates, capped at 1 rad/s; virtual throttle is capped at 20%. Yaw stays zero. Historical flight PID gains are reference-only.</p></details>
  <p class="wifi-small">Start begins a motor-disabled bench session at zero throttle. After Wi-Fi loss or switching apps, press Start again.</p>
</section>`;
document.body.append(root);
document.getElementById('connection-button')!.append(root.querySelector('.wifi-open')!);
const el = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
const panel = root.querySelector<HTMLElement>('.wifi-panel')!;
const input = new CockpitInput();
const motion = new DeviceOrientationController({ profile: { ...DEFAULT_APPLE_SPATIAL_INPUT_PROFILE,
  controlRangeDegrees: 30, jitterThresholdDegrees: 0, settledAxisThreshold: 0 } });
let camera: CameraView | null = null;
let calibration: CalibrationPanel | null = null;
let ota: OtaPanel | null = null;
let sampleCount = -1, motionAt = -Infinity, telemetryAt = -Infinity, telemetrySeq = -1, bootSession = 0;
let disposed = false, controlsReady = false, pollTimer: ReturnType<typeof setTimeout>, pollGeneration = 0;
const controls = new CockpitControls({ input,
  start() {
    if (ota?.busy) { controls.report('Firmware update in progress', false); return; }
    if (calibration?.busy) { controls.report('Finish or cancel IMU capture before Start', false); return; }
    if (client.busy) { controls.report('Previous request finishing · press Start again', false); return; }
    input.clear(); controls.report('Connecting · motors disabled', false, true);
    void client.enable().catch(error => stop(error.message));
  },
  stop,
  touch() {
    if (input.select('touch')) { stop('Touch selected · press Start'); motion.disable(); }
  },
  motion() {
    stop('Motion changed · press Start after calibration');
    const phase = motion.inspect().phase;
    if (phase === 'running' || phase === 'calibrating') { input.select('touch'); motion.disable(); }
    else { input.select('motion'); void motion.enable().catch(error => stop(error.message)); }
    controls.render();
  },
  recenter() { stop('Recentering · press Start after calibration'); motion.recenter(); },
});
const client = new BenchClient(key, {
  report(message, ack) {
    el('status').textContent = message;
    controls.report(message, Boolean(ack?.active || ack?.status === 'ready'));
    const text = ack ? `ACK ${ack.seq} · virtual outputs ${ack.virtual_motors.join(' / ')} · physical outputs 0 / 0 / 0 / 0` : 'No command session · virtual outputs 0 / 0 / 0 / 0';
    el('ack').textContent = text; controls.ack(text);
  },
  axes() {
    if (!controlsReady || document.hidden || performance.now() - telemetryAt >= 500) throw new Error('Fresh live telemetry required');
    return input.axes(motion.inspect(), performance.now() - motionAt);
  },
});
function stop(reason: string) { input.stop(); client.stop(reason); controls.report(reason, false); }
motion.subscribeLifecycle(state => {
  if (state.sampleCount !== sampleCount) { sampleCount = state.sampleCount; motionAt = performance.now(); }
  el('motion-status').textContent = state.message; controls.motionState(state.phase);
  if (input.mode === 'motion' && (client.active || client.busy) && state.phase !== 'running') stop('Motion unavailable');
});
el('close').onclick = () => { ota?.cancel(); calibration?.cancel('Connection panel closed; start a new run'); panel.hidden = true; camera?.dispose(); camera = null; };
document.querySelector<HTMLButtonElement>('.wifi-open')!.onclick = () => {
  stop('Connection panel opened · press Start when ready'); panel.hidden = false;
  camera?.dispose(); camera = new CameraView(el('camera'));
  calibration ??= new CalibrationPanel(panel, () => { stop('Stationary capture · bench stopped'); motion.disable(); }, () => !ota?.busy);
  ota ??= new OtaPanel(panel, key, () => { calibration?.cancel('Firmware update started'); stop('Firmware update · bench stopped'); motion.disable(); });
};
window.addEventListener('blur', () => stop('Browser lost focus'));
window.addEventListener('pagehide', event => {
  disposed = true; pollGeneration++; clearTimeout(pollTimer); stop('Page closed'); motion.disable();
  ota?.cancel(); calibration?.cancel('Page closed; start a new run');
  if (!event.persisted) { calibration?.dispose(); motion.dispose(); camera?.dispose(); controls.dispose(); clearInterval(freshnessTimer); }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { disposed = false; clearTelemetry('Reconnect explicitly'); void poll(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { ota?.cancel(); calibration?.cancel('Page hidden; start a new run'); stop('Page hidden'); motion.disable(); clearTelemetry('Page hidden'); } });
function clearTelemetry(message: string) {
  telemetryAt = -Infinity; el('telemetry').textContent = message; controls.telemetry(message);
  camera?.setTelemetry('No fresh device telemetry', 'Attitude unavailable', message);
}
async function poll() {
  const generation = ++pollGeneration;
  if (disposed) return;
  if (document.hidden) { pollTimer = setTimeout(poll, 250); return; }
  if (calibration?.busy || ota?.busy) { pollTimer = setTimeout(poll, 250); return; }
  const requestedAt = performance.now();
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 1500);
  try {
    const response = await fetch('/api/telemetry', { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error('Live telemetry unavailable');
    const text = await response.text();
    if (text.length > 1500) throw new Error('Oversized telemetry');
    if (generation !== pollGeneration || document.hidden) return;
    const data = readTelemetry(JSON.parse(text), requestedAt, performance.now(), { session: bootSession, seq: telemetrySeq });
    if (data.restarted && (client.active || client.busy)) stop('Device restarted');
    bootSession = data.session; telemetrySeq = data.seq; telemetryAt = data.at;
    const s = data.sample;
    const reading = `Gyro ${s.imu.gyro_rad_s.map((n: number) => n.toFixed(3)).join(' / ')} rad/s`;
    const message = `Live IMU #${s.seq} · ${reading}`;
    el('telemetry').textContent = message; controls.telemetry(message, s.seq);
    camera?.setTelemetry('ESP32 live IMU · motors disabled', reading, 'Battery calibration KIV');
  } catch (error) { clearTelemetry((error as Error).message); if (client.active || client.busy) stop('Telemetry lost · press Start again'); }
  finally { clearTimeout(timeout); if (!disposed) pollTimer = setTimeout(poll, 200); }
}
const freshnessTimer = setInterval(() => {
  if (Number.isFinite(telemetryAt) && performance.now() - telemetryAt >= 500) {
    clearTelemetry('Telemetry stale'); if (client.active || client.busy) stop('Telemetry stale · press Start again');
  }
}, 100);
document.getElementById('game-mode')!.addEventListener('click', () => stop('Opening Game Mode'));
document.getElementById('fullscreen')!.onclick = () => {
  const action = document.fullscreenElement ? document.exitFullscreen() : document.getElementById('drone-stage')!.requestFullscreen();
  void action.catch(() => controls.report('Full screen unavailable', client.active));
};
controls.attach(); controlsReady = true;
if (!/^[a-f0-9]{64}$/.test(key)) stop('Open your private pairing link to enable Start');
void poll();
// Reuse the verified cache owner; its drone manifest excludes every game asset.
const offline = document.getElementById('offline-status')!;
if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
  void navigator.serviceWorker.register('/gamexr/sw.js', { scope: '/gamexr/' })
    .then(() => { offline.textContent = 'Drone offline cache requested'; })
    .catch(() => { offline.textContent = 'Offline cache unavailable · keep Wi-Fi connected'; });
}
