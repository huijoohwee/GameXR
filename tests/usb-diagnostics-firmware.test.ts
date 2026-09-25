import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
