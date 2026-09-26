// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImuCapture } from '../web/imu-capture.ts';
const sample = (seq: number) => ({ seq, uptime_ms: seq * 100, motor_gate_command: 'low_held', imu: { status: 'ok' } });
const window = (first: number, n = 1, extra = {}) => JSON.stringify({ schema: 'gamexr.imu-window/v1',
  session: 9, actuation_available: false, age_ms: 0, samples: Array.from({length: n}, (_, i) => sample(first + i)), ...extra });
const make = (fit = (_samples: any[], confirmed: boolean): unknown => ({ validated: confirmed })) => new ImuCapture(JSON.parse, fit);
const baseline = (c: ImuCapture<any>) => { c.start(true, 0); c.ingest(window(0), 0, 10); };

test('Wi-Fi capture discards baseline, batches 200 consecutive future frames, fits once and exports no authority', () => {
  let calls = 0;
  const c = make((samples, confirmed) => { calls++; assert.equal(confirmed, true); assert.equal(samples.length, 200); return { bias: [1, 2, 3] }; });
  assert.throws(() => c.start(false, 0)); baseline(c);
  assert.equal(c.samples.length, 0); assert.equal(c.path(), '/api/imu-window?session=9&after=0');
  for (let first = 1; first <= 193; first += 8) c.ingest(window(first, 8), (first + 7) * 100, (first + 7) * 100 + 10);
  assert.equal(calls, 1); assert.equal(c.active, false); assert.equal(c.status, 'validated');
  assert.equal(c.samples[0].seq, 1); assert.equal(c.samples.at(-1).seq, 200);
  c.ingest(window(201), 21000, 21001); assert.equal(calls, 1);
  const evidence = c.evidence('http://localhost', true);
  assert.equal(evidence.calibration_activated, false); assert.equal(evidence.physical_outputs_enabled, false);
  assert.equal(evidence.synthetic, true);
  c.start(true, 30000); assert.equal(c.session, null); assert.equal(c.samples.length, 0); assert.equal(c.result, null);
});

test('Wi-Fi capture rejects gaps, repeats, reboot, staleness, malformed frames and output changes without fitting', () => {
  const broken = [window(2), window(0), window(1, 1, {session: 10}), window(1, 1, {age_ms: 1500}),
    window(1, 1, {actuation_available: true}), window(1, 9), '{', 'x'.repeat(6001),
    window(1, 1, { samples: [{...sample(1), motor_gate_command: 'high'}] }),
    window(1, 1, { samples: [{...sample(1), imu: {status: 'not_ready'}}] }),
    window(1, 1, { samples: [{...sample(1), uptime_ms: 201}] })];
  for (const text of broken) {
    const c = make(() => assert.fail('Invalid run reached fitter')); baseline(c);
    assert.throws(() => c.ingest(text, 100, 101)); assert.equal(c.active, false); assert.equal(c.result, null);
  }
});

test('Wi-Fi capture treats empty batches as waiting, bounds stall/duration and ignores replies after cancellation', () => {
  const c = make(() => assert.fail('Incomplete run reached fitter')); baseline(c);
  c.ingest(window(1, 0), 100, 110); assert.equal(c.active, true);
  assert.throws(() => c.ingest(window(1, 0), 1600, 1610), /stalled/);
  baseline(c); assert.throws(() => c.ingest(window(1), 34000, 35000), /timed out/);
  baseline(c); c.cancel('Page hidden'); c.ingest(window(1), 100, 110);
  assert.equal(c.samples.length, 0); assert.equal(c.status, 'Page hidden');
  assert.throws(() => { baseline(c); c.ingest(window(1), 100, 1600); }, /stale/);
});

test('Wi-Fi fit rejection preserves raw evidence and cannot mark a calibration validated', () => {
  const c = make(() => { throw new Error('Movement detected'); }); baseline(c);
  for (let first = 1; first < 193; first += 8) c.ingest(window(first, 8), (first + 7) * 100, (first + 7) * 100 + 10);
  assert.throws(() => c.ingest(window(193, 8), 20000, 20010), /Movement/);
  assert.equal(c.samples.length, 200); assert.equal(c.active, false); assert.equal(c.result, null);
  assert.match(c.status, /Movement/);
});
