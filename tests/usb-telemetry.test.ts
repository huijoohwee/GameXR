import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('USB observation rejects protocol drift and keeps replay separate from live evidence', () => {
  const result = spawnSync('python3', ['-B', 'tests/test_usb_telemetry.py'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
