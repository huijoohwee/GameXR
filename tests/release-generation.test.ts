import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('release generation streams bounded artifacts and reuses identical manifest bytes', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gamexr-release-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const script = fileURLToPath(new URL('../scripts/prepare-release.mjs', import.meta.url))
  const run = () => spawnSync(process.execPath, [script, `--root=${root}`], { encoding: 'utf8', timeout: 30000 })
  fs.writeFileSync(path.join(root, 'index.html'), 'app')
  const first = run(); assert.equal(first.status, 0, first.stderr)
  const manifest = path.join(root, 'release-manifest.json'), before = fs.readFileSync(manifest)
  const time = fs.statSync(manifest).mtimeMs
  const second = run(); assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(fs.readFileSync(manifest), before); assert.equal(fs.statSync(manifest).mtimeMs, time)
  assert.equal(JSON.parse(before.toString()).deploymentAuthorized, false)
  fs.truncateSync(path.join(root, 'index.html'), 16 * 1024 * 1024 + 1)
  const large = run(); assert.notEqual(large.status, 0); assert.match(large.stderr, /byte-budget/)
  assert.deepEqual(fs.readFileSync(manifest), before)
})
