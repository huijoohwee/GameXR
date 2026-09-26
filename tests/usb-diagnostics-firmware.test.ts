import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { axisRate, throttleTarget } from '../firmware/esp32-usb-diagnostics/web/control-profile.mjs';
import { readTelemetry } from '../firmware/esp32-usb-diagnostics/web/live-telemetry.ts';
import { BenchClient, validateAck } from '../firmware/esp32-usb-diagnostics/web/bench-client.mjs';
import { splitCockpitModes } from '../firmware/esp32-usb-diagnostics/tools/cockpit-modes.mjs';
import { CockpitInput } from '../firmware/esp32-usb-diagnostics/web/cockpit-input.ts';
import { sha256, validateCockpitArtifact } from '../firmware/esp32-usb-diagnostics/tools/cockpit-source.ts';
import '../firmware/esp32-usb-diagnostics/tests/imu-capture.test.ts';

test('cockpit packaging rejects stale builds, modified bytes, extra files and physical execution claims', () => {
  const bytes = Buffer.from('pinned browser chunk');
  const artifact = { path: 'assets/index.js', bytes: bytes.length, sha256: sha256(bytes) };
  const lock = { schema: 'gamexr/cockpit-source-lock/v1', sourceRevision: 'a'.repeat(40),
    artifactDigest: sha256(`${artifact.path}\0${artifact.bytes}\0${artifact.sha256}`),
    physicalAircraft: false, embeddedPathExecution: false, pathExecution: 'host-simulated-receiver-only' };
  const manifest = { schema: 'gamexr-release-artifact/v1', sourceRevision: lock.sourceRevision,
    candidateStatus: 'source-bound-clean', source: { worktree: 'clean' }, basePath: '/gamexr/',
    deploymentAuthorized: false, artifactDigest: lock.artifactDigest, artifacts: [artifact] };
  const fixture = (change = {}) => new Map([
    ['assets/index.js', bytes], ['release-manifest.json', Buffer.from(JSON.stringify({ ...manifest, ...change }))],
  ]);
  assert.equal(validateCockpitArtifact(fixture(), lock).artifactDigest, lock.artifactDigest);
  for (const change of [{ sourceRevision: 'b'.repeat(40) }, { candidateStatus: 'unsealed-dirty-source' },
    { source: { worktree: 'dirty' } }, { deploymentAuthorized: true }, { artifactDigest: 'c'.repeat(64) },
    { artifacts: [artifact, artifact] }, { artifacts: [{ ...artifact, path: '../escape' }] }]) {
    assert.throws(() => validateCockpitArtifact(fixture(change), lock));
  }
  const tampered = fixture(); tampered.set('assets/index.js', Buffer.from('modified browser chunk'));
  assert.throws(() => validateCockpitArtifact(tampered, lock), /bytes changed/);
  const extra = fixture(); extra.set('unsealed.js', bytes);
  assert.throws(() => validateCockpitArtifact(extra, lock), /unlisted/);
  for (const change of [{ physicalAircraft: true }, { embeddedPathExecution: true }, { pathExecution: 'device' }])
    assert.throws(() => validateCockpitArtifact(fixture(), { ...lock, ...change }), /boundary/);
});

test('Wi-Fi ring preserves bounded contiguous batches and rejects stale or invalid cursors', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'gamexr-imu-window-'));
  try {
    const root = resolve('firmware/esp32-usb-diagnostics'), binary = join(temporary, 'window-test');
    const build = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
      '-I', join(root, 'main'), join(root, 'main/imu_window.c'), join(root, 'tests/imu_window_test.c'), '-o', binary],
      { encoding: 'utf8', timeout: 30000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const run = spawnSync(binary, [], {encoding: 'utf8', timeout: 10000});
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});

test('main cockpit mode changes and stops clear throttle and steering; motion is explicit and fresh', () => {
  const input = new CockpitInput();
  const motion = { calibrated: true, phase: 'running', roll: .5, pitch: -.5 };
  assert.equal(input.mode, 'motion');
  assert.throws(() => input.axes(motion, 250));
  assert.throws(() => input.axes({ ...motion, calibrated: false }, 0));
  input.setThrottle(.8); assert.equal(input.throttle, 0);
  input.active = true; input.setThrottle(.8);
  assert.deepEqual(input.axes(motion, 10), [160, 262, -262, 0]);
  assert.equal(input.select('touch'), true);
  assert.equal(input.active, false); assert.deepEqual(input.axes(motion, Infinity), [0, 0, 0, 0]);
  input.active = true; input.steer(1, -1); input.setThrottle(.5);
  assert.ok(input.roll > .7 && input.roll < .71); assert.equal(input.pitch, input.roll);
  assert.equal(input.select('touch'), false); assert.equal(input.throttle, .5);
  input.steer(0, 0); assert.deepEqual(input.axes(motion, Infinity), [100, 0, 0, 0]);
  input.stop(); assert.deepEqual(input.axes(motion, Infinity), [0, 0, 0, 0]);
  assert.throws(() => input.setThrottle(-1)); assert.throws(() => input.steer(NaN, 0));
});

test('historical input response stays symmetric, monotonic, dead-zoned and bench-bounded', () => {
  assert.equal(axisRate(1), 850); assert.equal(axisRate(-1), -850);
  assert.equal(axisRate(1, true), 680); assert.equal(axisRate(.06), 0);
  assert.equal(axisRate(.5), 262); assert.equal(throttleTarget(.05), 0);
  assert.equal(throttleTarget(1), 200);
  let previous = -1000;
  for (let i = -1000; i <= 1000; i++) { const n = axisRate(i / 1000); assert.ok(n >= previous && Math.abs(n) <= 850); previous = n; }
  assert.throws(() => axisRate(NaN)); assert.throws(() => throttleTarget(1.1));
});
const benchAck = (status = 'ready', seq = 0) => ({ profile: 'gamexr.usb-bench/v1', type: 'ack',
  session: 9, seq, status, active: status === 'accepted', lease_ms: 250,
  outputs_enabled: false, motor_outputs: [0, 0, 0, 0], virtual_motors: [0, 0, 0, 0] });
test('default bench transport retains the browser fetch receiver for HELLO and STOP', async t => {
  const commands: string[] = [];
  t.mock.method(globalThis, 'fetch', async function(this: unknown, _url: unknown, options: any) {
    assert.equal(this, globalThis); commands.push(options.body);
    return { ok: true, text: async () => JSON.stringify(benchAck()) };
  });
  const client = new BenchClient('a'.repeat(64));
  await client.enable(); assert.equal(client.active, true);
  client.stop(); assert.deepEqual(commands, ['GXR1 HELLO', 'GXR1 STOP']);
});
test('wire acknowledgment rejects actuation claims, replay, wrong sessions and invalid mixer values', () => {
  const expected = { status: 'accepted', session: 9, seq: 1 };
  validateAck(benchAck('accepted', 1), expected);
  for (const patch of [{ outputs_enabled: true }, { motor_outputs: [1, 0, 0, 0] },
    { seq: 0 }, { session: 8 }, { active: false }, { virtual_motors: [201, 0, 0, 0] }])
    assert.throws(() => validateAck({ ...benchAck('accepted', 1), ...patch }, expected));
});
test('stopping during pending HELLO cannot reactivate a browser session', async () => {
  let reply: (value: any) => void = () => {};
  const commands: string[] = [], reports: string[] = [];
  const client = new BenchClient('a'.repeat(64), { report: message => reports.push(message),
    request: async (_url, options) => {
      commands.push(options.body);
      if (options.body === 'GXR1 STOP') return { ok: true, text: async () => '' };
      return new Promise(resolve => { reply = resolve; });
    } });
  const pending = client.enable();
  client.stop('Hidden');
  reply({ ok: true, text: async () => JSON.stringify(benchAck()) });
  await pending;
  assert.equal(client.active, false); assert.equal(client.timer, null);
  assert.deepEqual(commands, ['GXR1 HELLO', 'GXR1 STOP']);
  assert.deepEqual(reports, ['Hidden']);
});
test('input failure stops streaming without forwarding a stale setpoint', async () => {
  const commands: string[] = [];
  let valid = true;
  const client = new BenchClient('b'.repeat(64), { axes: () => {
    if (!valid) throw new Error('Motion stale'); return [0, 0, 0, 0];
  }, request: async (_url, options) => {
    commands.push(options.body); return { ok: true, text: async () => JSON.stringify(benchAck()) };
  } });
  await client.enable(); if (client.timer) clearTimeout(client.timer); valid = false;
  await client.step(client.epoch);
  assert.equal(client.active, false); assert.deepEqual(commands, ['GXR1 HELLO', 'GXR1 STOP']);
});

test('diagnostics core rejects wrong sensors, stale data and invalid battery voltage', () => {
  const project = resolve('firmware/esp32-usb-diagnostics');
  const temporary = mkdtempSync(join(tmpdir(), 'gamexr-diagnostics-'));
  try {
    const binary = join(temporary, 'core-test');
    const build = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror',
      '-I', join(project, 'main'), join(project, 'main/mpu6500.c'),
      join(project, 'main/telemetry.c'), join(project, 'tests/core_test.c'), '-o', binary],
      { encoding: 'utf8', timeout: 30000 });
    assert.equal(build.error, undefined);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const frames = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(frames.length, 4);
    assert.equal(frames[0].imu.frame, 'sensor');
    assert.ok(Math.abs(frames[0].imu.accel_m_s2[0] - 9.80665) < 0.000001);
    assert.ok(Math.abs(frames[0].imu.gyro_rad_s[0] - Math.PI * 100 / 180) < 0.000001);
    assert.equal(frames[0].battery.battery_mv, 2606);
    assert.equal(frames[1].imu.accel_m_s2, null);
    assert.equal(frames[1].battery.status, 'no_efuse_calibration');
    assert.equal(frames[1].battery.battery_mv, null);
    assert.equal(frames[2].imu.gyro_rad_s, null);
    assert.equal(frames[2].battery.status, 'out_of_range');
    assert.equal(frames[2].battery.battery_mv, null);
    assert.equal(frames[3].battery.raw, null);
    assert.ok(frames.every(f => f.motor_gate_command === 'low_held'));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

const frame = (seq = 1, session = 1) => ({
  schema: 'gamexr.direct-wifi/v1', session, age_ms: 20, actuation_available: false,
  sample: { profile: 'gamexr.usb-diagnostics/v1', type: 'sample', seq,
    motor_gate_command: 'low_held', imu: { status: 'ok', accel_m_s2: [0, 0, 9.81],
      gyro_rad_s: [0, 0, 0] }, battery: { status: 'ok', battery_mv: 3100 } },
});

test('USB bench expires authority, rejects replay/faults, and only computes bounded virtual motors', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'gamexr-bench-'));
  try {
    const binary = join(temporary, 'bench-test');
    const root = resolve('firmware/esp32-usb-diagnostics');
    const build = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror',
      '-fsanitize=address,undefined', '-I', join(root, 'main'), join(root, 'main/bench.c'),
      join(root, 'tests/bench_test.c'), '-lm', '-o', binary], { encoding: 'utf8', timeout: 30000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const frame = JSON.parse(run.stdout.trim());
    assert.equal(frame.outputs_enabled, false);
    assert.deepEqual(frame.motor_outputs, [0, 0, 0, 0]);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function browser({ secure = true, media = async () => { throw new Error('No camera'); } }:
  { secure?: boolean; media?: () => Promise<any> } = {}) {
  const nodes: Record<string, any> = {};
  const listeners: Record<string, () => void> = {};
  const events: Record<string, () => void> = {};
  const requests: any[] = [];
  let now = 0, response: any = frame(), rawResponse: string | null = null, nextTimer = 0;
  const timers = new Map<number, () => void>();
  const document = { hidden: false, getElementById(id: string) {
    return nodes[id] ??= { textContent: '', hidden: false, disabled: false,
      style: {}, srcObject: null, play: async () => {} };
  }, addEventListener(name: string, fn: () => void) { listeners[name] = fn; } };
  const context = createContext({ document, window: { addEventListener(name: string, fn: () => void) { events[name] = fn; } },
    navigator: { mediaDevices: { getUserMedia: media } }, isSecureContext: secure,
    performance: { now: () => now }, AbortController,
    setTimeout(fn: () => void) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id: number) { timers.delete(id); }, setInterval: () => 1, clearInterval: () => {},
    fetch: async (url: string, options: any) => {
      requests.push({ url, options });
      return { ok: true, text: async () => rawResponse ?? JSON.stringify(response) };
    },
  });
  runInContext(readFileSync('firmware/esp32-usb-diagnostics/web/device.js', 'utf8'), context);
  return { nodes, listeners, events, requests, document, timers,
    evaluate: (code: string) => runInContext(code, context),
    response(value: any) { response = value; rawResponse = null; },
    rawResponse(value: string) { rawResponse = value; }, advance(ms: number) { now += ms; } };
}

test('direct Wi-Fi clears expired telemetry and accepts a new device boot', async () => {
  const b = browser(); await settle();
  assert.match(b.nodes.link.textContent, /Connected/);
  assert.equal(b.nodes.sequence.textContent, '#1');
  assert.ok(b.requests.every(r => r.url === '/api/telemetry' && !r.options.method && !r.options.body));
  b.advance(1500); b.evaluate('render()');
  assert.equal(b.nodes.accel.textContent, '—');
  assert.match(b.nodes.link.textContent, /stale/);
  b.response(frame(0, 2)); await b.evaluate('poll()');
  assert.equal(b.nodes.sequence.textContent, '#0');
});

test('direct Wi-Fi rejects duplicates, invalid sensors and unexpected actuation', async () => {
  const b = browser(); await settle();
  await b.evaluate('poll()'); assert.equal(b.nodes.accel.textContent, '—');
  for (const mutate of [
    (f: any) => { f.actuation_available = true; },
    (f: any) => { f.sample.motor_gate_command = 'enabled'; },
    (f: any) => { f.sample.imu.accel_m_s2 = [null, 0, 0]; },
    (f: any) => { f.age_ms = 1500; },
  ]) {
    const f = frame(2); mutate(f); b.response(f); await b.evaluate('poll()');
    assert.equal(b.nodes.accel.textContent, '—');
  }
  assert.equal(b.evaluate('failures'), 5);
});

test('HTTP cannot start the phone camera', async () => {
  let calls = 0;
  const b = browser({ secure: false, media: async () => { calls++; throw new Error(); } });
  await settle(); await b.evaluate('startCamera()');
  assert.equal(calls, 0); assert.equal(b.nodes['start-camera'].disabled, true);
  assert.equal(b.nodes['secure-help'].hidden, false);
});

test('late camera permissions are released after navigation, and BFCache resumes telemetry', async () => {
  let grant: (value: any) => void = () => {};
  let stopped = 0;
  const b = browser({ media: () => new Promise<any>(resolve => { grant = resolve; }) });
  await settle(); const pending = b.evaluate('startCamera()');
  b.events.pagehide!();
  grant({ getTracks: () => [{ stop() { stopped++; } }] }); await pending;
  assert.equal(stopped, 1); assert.equal(b.nodes.camera.srcObject, null);
  b.response(frame(2)); b.events.pageshow!(); await settle();
  assert.equal(b.nodes.sequence.textContent, '#2');
  assert.equal(b.nodes.camera.srcObject, null);
});

test('hiding the page stops all camera tracks and clears displayed readings', async () => {
  let stopped = 0;
  const track = { stop() { stopped++; }, addEventListener() {} };
  const stream: any = { getTracks: () => [track], getVideoTracks: () => [track] };
  const b = browser({ media: async () => stream }); await settle();
  await b.evaluate('startCamera()'); assert.equal(b.nodes.camera.srcObject, stream);
  b.document.hidden = true; b.listeners.visibilitychange!();
  assert.equal(stopped, 1); assert.equal(b.nodes.camera.srcObject, null);
  assert.equal(b.nodes.gyro.textContent, '—');
});

// Independent diagnostics samples 120 and 1179, retained from the 2026-09-25
// passive capture. Wrap their exact damaged sample bytes in the Wi-Fi envelope
// to test UI rejection; this is replay, not evidence of corruption over Wi-Fi.
const capturedMalformedSamples = [
  "{\"profile\":\"gamexr.usb-diagnostics/v1\",\"type\":\"sample\",\"seq\":120,\"uptime_ms\":12694,\"motor_gate_command\":\"low_held\",\"imu\":{\"statuok\",\"frame\":\"sensor\",\"accel_m_s2\":[0.203507,0.065841,9.440337],\"gyro_rad_s\":[-0.050894,0.006662,0.019452]},\"battery\":{\"status\":\"out_of_range\",\"raw\":3011,\"adc_mv\":2564,\"battery_mv\":null}}",
  "{\"profile\":\"gamexr.usb-diagnostics/v1\",\"type\":\"sample\",\"seq\":1179,\"uptime_ms\":118604,\"motor_gate_command\":\"low_held\",\"imu\":{\"status\":\"ok\",\"frame\":\"sensor\",\"accel_m_s2\":[0.104148,0.038307,9.350yro_rad_s\":[-0.049296,0.007461,0.021051]},\"battery\":{\"status\":\"out_of_range\",\"raw\":3024,\"adc_mv\":2573,\"battery_mv\":null}}"
];

test('phone telemetry clears readings on captured malformed samples and recovers on fresh data', async () => {
  for (const damaged of capturedMalformedSamples) {
    const b = browser(); await settle();
    assert.equal(b.nodes.sequence.textContent, '#1');
    b.rawResponse('{"schema":"gamexr.direct-wifi/v1","session":1,"age_ms":0,"actuation_available":false,"sample":' + damaged + '}');
    await b.evaluate('poll()');
    for (const id of ['sequence', 'accel', 'gyro', 'battery']) assert.equal(b.nodes[id].textContent, '—');
    assert.equal(b.evaluate('latest'), null);
    assert.equal(b.evaluate('failures'), 1);
    b.response(frame(2)); await b.evaluate('poll()');
    assert.equal(b.nodes.sequence.textContent, '#2');
    assert.equal(b.evaluate('failures'), 0);
  }
});

test('phone telemetry stops automatic retries after five malformed responses and permits explicit retry', async () => {
  const b = browser(); await settle();
  b.rawResponse('{"broken":');
  for (let failure = 1; failure <= 5; failure++) {
    b.timers.clear(); // Consume the previously scheduled poll in the test clock.
    await b.evaluate('poll()');
    assert.equal(b.evaluate('failures'), failure);
    assert.equal(b.timers.size, failure < 5 ? 1 : 0);
  }
  assert.equal(b.nodes.sequence.textContent, '—');
  b.response(frame(2)); b.nodes.retry.onclick(); await settle();
  assert.equal(b.nodes.sequence.textContent, '#2');
  assert.equal(b.evaluate('failures'), 0);
  assert.ok(b.requests.every(r => r.url === '/api/telemetry' && !r.options.method && !r.options.body));
});


test('HTTPS handler enforces key, origin, framing, exclusive lease and replay rejection', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'gamexr-wifi-http-'));
  try {
    const root = resolve('firmware/esp32-usb-diagnostics');
    const binary = join(temporary, 'http-test');
    const build = spawnSync('cc', ['-std=gnu11', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
      '-I', join(root, 'tests/http-stubs'), '-I', join(root, 'main'), join(root, 'tests/wifi_http_test.c'),
      join(root, 'main/bench.c'), join(root, 'main/device_auth.c'), '-DDEVICE_TLS_AVAILABLE=1', '-lm', '-o', binary], { encoding: 'utf8', timeout: 30000 });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});


test('operator-captured Wi-Fi packet passes, while stale transport time and replay fail closed', () => {
  const captured = {schema:'gamexr.direct-wifi/v1',session:3667260253,age_ms:101,actuation_available:false,
    sample:{profile:'gamexr.usb-diagnostics/v1',type:'sample',seq:2880,uptime_ms:314634,motor_gate_command:'low_held',
      imu:{status:'ok',frame:'sensor',accel_m_s2:[.130484,.080206,9.392453],gyro_rad_s:[-.052493,.002132,.019185]},
      battery:{status:'out_of_range',raw:3007,adc_mv:2562,battery_mv:null}}};
  const previous = { session: captured.session, seq: 2879 };
  const accepted = readTelemetry(captured, 1000, 1080, previous);
  assert.equal(accepted.at, 899); assert.equal(accepted.seq, 2880);
  assert.equal(accepted.restarted, false);
  const cold = readTelemetry(captured, 1000, 1800, previous);
  assert.ok(1800 - cold.at >= 500, 'cold response cannot satisfy the control freshness gate');
  assert.throws(() => readTelemetry(captured, 1000, 2500, previous));
  assert.throws(() => readTelemetry(captured, 1000, 1080, { session: captured.session, seq: 2880 }));
  assert.throws(() => readTelemetry({ ...captured, actuation_available: true }, 1000, 1080, previous));
});

test('cold HTTPS setup gets a longer deadline but setpoint acknowledgments stay time bounded', async () => {
  const sent: string[] = [];
  const client = new BenchClient('c'.repeat(64), { request: async (_url, options) => {
    sent.push(options.body);
    if (options.body === 'GXR1 STOP') return { ok: true, text: async () => '' };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, text: async () => JSON.stringify(benchAck()) }), 300);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Request timed out')); }, { once: true });
    });
  } });
  await client.enable();
  assert.equal(client.active, true, 'initial TLS setup can exceed 180ms');
  if (client.timer) clearTimeout(client.timer);
  await client.step(client.epoch);
  assert.equal(client.active, false, 'slow setpoint acknowledgment revokes authority');
  assert.equal(sent.at(-1), 'GXR1 STOP');
});

test('drone entry and cache never preload gaming; explicit Game Mode keeps its separate entry', () => {
  const game = '<head><link rel="modulepreload" href="/gamexr/assets/three-renderer.js"><script src="/gamexr/assets/game.js"></script><link href="./manifest.webmanifest"></head><body></body>';
  const entries = new Map([['index.html', Buffer.from(game)], ['manifest.webmanifest', Buffer.from('{"name":"GameXR"}')]]);
  const drone = splitCockpitModes(entries, ['wifi-cockpit.123.js', 'wifi-cockpit.456.css']);
  const html = entries.get('index.html')!.toString();
  assert.doesNotMatch(html, /modulepreload|three-|assets\/game|canvas|game\.html/);
  assert.match(html, /wifi-cockpit\.123\.js/);
  assert.deepEqual(drone.sort(), ['icons/gamexr.svg', 'index.html', 'manifest.webmanifest', 'wifi-cockpit.123.js', 'wifi-cockpit.456.css'].sort());
  assert.match(entries.get('game.html')!.toString(), /three-renderer/);
  assert.doesNotMatch(entries.get('game.html')!.toString(), /wifi-cockpit/);
  assert.equal(JSON.parse(entries.get('manifest.webmanifest')!.toString()).name, 'GameXR Wi-Fi Drone');
  assert.equal(JSON.parse(entries.get('game.webmanifest')!.toString()).name, 'GameXR');
});


import '../firmware/esp32-usb-diagnostics/tests/ota-client.test.ts';
import '../firmware/esp32-usb-diagnostics/tests/ota-package.test.ts';

test('OTA receiver retains the running image on interrupted, invalid or corrupt updates and health failures', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'gamexr-ota-'));
  try {
    const root = resolve('firmware/esp32-usb-diagnostics'), binary = join(temporary, 'ota-test');
    const args = ['-std=c11', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
      '-DOTA_BOOTLOADER_SHA256="' + 'a'.repeat(64) + '"', '-DOTA_PARTITIONS_SHA256="' + 'b'.repeat(64) + '"',
      '-I', join(root,'tests/ota-stubs'), '-I', join(root,'main'), join(root,'tests/ota_update_test.c'),
      join(root,'main/ota_policy.c'), '-o', binary];
    const build = spawnSync('cc', args, {encoding:'utf8',timeout:30000});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run = spawnSync(binary,[],{encoding:'utf8',timeout:10000});
    assert.equal(run.status,0,run.stdout+run.stderr);
  } finally { rmSync(temporary,{recursive:true,force:true}); }
});


test('OTA boot guard requires health and paired observation, resets unconfirmed boots and restricts recovery', () => {
  const temporary=mkdtempSync(join(tmpdir(),'gamexr-ota-guard-'));
  try {
    const root=resolve('firmware/esp32-usb-diagnostics'), binary=join(temporary,'guard-test');
    const build=spawnSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',
      '-DOTA_BOOTLOADER_SHA256="'+'0'.repeat(64)+'"','-DOTA_PARTITIONS_SHA256="'+'0'.repeat(64)+'"',
      '-I',join(root,'tests/ota-stubs'),'-I',join(root,'main'),join(root,'tests/ota-guard-test.c'),join(root,'main/ota_policy.c'),'-o',binary],{encoding:'utf8',timeout:30000});
    assert.equal(build.status,0,build.stdout+build.stderr);
    const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stdout+run.stderr);
  } finally {rmSync(temporary,{recursive:true,force:true});}
});
