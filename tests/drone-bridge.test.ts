import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { WebSocket } from 'ws'
import { startDroneBridge } from '../tools/drone-bridge/server.ts'
import { BENCH, neutralAxes, type BridgeStatus } from '../src/drone/protocol.ts'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'gamexr-drone-'))
  await writeFile(path.join(root, 'index.html'), '<h1>Bench test</h1>')
  const bridge = await startDroneBridge({ root, port: 0 })
  const clients: WebSocket[] = []
  return { ...bridge, root,
    async connect() {
      const socket = new WebSocket(bridge.origin.replace('http:', 'ws:') + '/gamexr/drone-socket', { origin: bridge.origin })
      clients.push(socket)
      let latest: BridgeStatus | null = null
      socket.on('message', data => {
        const value = JSON.parse(data.toString()) as BridgeStatus
        if (value.kind === 'status') latest = value
      })
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
      const wait = async (predicate: (value: BridgeStatus) => boolean, timeout = 2500) => {
        const start = performance.now()
        while (!latest || !predicate(latest)) {
          if (performance.now() - start > timeout) throw new Error(`Status timeout: ${JSON.stringify(latest)}`)
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        return latest
      }
      await wait(value => value.connected)
      return { socket, wait, send: (value: object) => socket.send(JSON.stringify(value)) }
    },
    async cleanup() {
      clients.forEach(client => client.terminate())
      await bridge.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('real WS → UDP → separate receiver accepts setpoints; silence inhibits within the host scheduling allowance', async t => {
  const bridge = await fixture(); t.after(() => bridge.cleanup())
  const pilot = await bridge.connect()
  pilot.send({ kind: 'enable' })
  const enabled = await pilot.wait(value => value.enabled)
  pilot.send({ kind: 'controls', profile: BENCH.profile, session: enabled.session,
    challenge: enabled.telemetry!.challenge, sequence: 1, axes: { roll: 1, pitch: 0, yaw: 0, throttle: 0.5 } })
  const accepted = await pilot.wait(value => value.telemetry?.sequence === 1)
  assert.deepEqual(accepted.telemetry!.setpoint, { roll: 1, pitch: 0, yaw: 0, throttle: 0.5 })
  assert.equal(accepted.telemetry!.motorOutputs, false)
  const at = performance.now()
  await pilot.wait(value => !value.owned && value.telemetry?.enabled === false, 1200)
  assert.ok(performance.now() - at < 1000, 'Host transport settled within 1 s; this is not a flight deadline')
})

test('only one owner; socket loss requires explicit re-enable and never preserves throttle', async t => {
  const bridge = await fixture(); t.after(() => bridge.cleanup())
  const first = await bridge.connect(), second = await bridge.connect()
  first.send({ kind: 'enable' })
  const enabled = await first.wait(value => value.enabled)
  second.send({ kind: 'enable' })
  assert.equal((await second.wait(value => value.reason.includes('acknowledgment'))).owned, false)
  first.send({ kind: 'controls', profile: BENCH.profile, session: enabled.session,
    challenge: enabled.telemetry!.challenge, sequence: 1, axes: { ...neutralAxes(), throttle: 1 } })
  await first.wait(value => value.telemetry?.sequence === 1)
  first.socket.close()
  await second.wait(value => value.telemetry?.enabled === false)
  second.send({ kind: 'enable' })
  const newOwner = await second.wait(value => value.enabled)
  assert.notEqual(newOwner.session, enabled.session)
  assert.deepEqual(newOwner.telemetry!.setpoint, neutralAxes())
})

test('replayed challenge with higher sequence revokes ownership', async t => {
  const bridge = await fixture(); t.after(() => bridge.cleanup())
  const pilot = await bridge.connect()
  pilot.send({ kind: 'enable' })
  const enabled = await pilot.wait(value => value.enabled)
  const command = { kind: 'controls', profile: BENCH.profile, session: enabled.session,
    challenge: enabled.telemetry!.challenge, sequence: 1, axes: neutralAxes() }
  pilot.send(command)
  await pilot.wait(value => value.telemetry?.sequence === 1)
  pilot.send({ ...command, sequence: 2 })
  await pilot.wait(value => !value.owned && value.reason.includes('replayed'))
  await pilot.wait(value => value.telemetry?.enabled === false)
})

test('wrong profile and malformed owner input revoke control; receiver death removes telemetry', async t => {
  const bridge = await fixture(); t.after(() => bridge.cleanup())
  const pilot = await bridge.connect()
  for (const command of [{ kind: 'controls', profile: 'wrong' }, { kind: 'enable', motor: true }]) {
    pilot.send({ kind: 'enable' })
    await pilot.wait(value => value.enabled)
    pilot.send(command)
    await pilot.wait(value => !value.owned && value.telemetry?.enabled === false)
  }
  process.kill(bridge.receiverPid!, 'SIGKILL')
  await pilot.wait(value => !value.connected && value.telemetry === null)
})

test('bridge restricts origin, Host, paths, symlinks, methods and payload size', async t => {
  const bridge = await fixture(); t.after(() => bridge.cleanup())
  assert.equal((await fetch(`${bridge.origin}/gamexr/`)).status, 200)
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    http.get(`${bridge.origin}/gamexr/`, { headers: { Host: 'evil.test' } }, response => {
      response.resume(); resolve(response.statusCode)
    }).once('error', reject)
  })
  assert.equal(wrongHost, 403)
  assert.equal((await fetch(`${bridge.origin}/gamexr/`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${bridge.origin}/outside.json`)).status, 404)
  await symlink('/etc/hosts', path.join(bridge.root, 'escape.json'))
  assert.equal((await fetch(`${bridge.origin}/gamexr/escape.json`)).status, 403)
  for (const origin of ['http://evil.test', undefined]) {
    const socket = new WebSocket(bridge.origin.replace('http:', 'ws:') + '/gamexr/drone-socket', { origin })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => { socket.terminate(); reject(new Error('Untrusted origin connected')) })
      socket.once('error', error => { assert.match(error.message, /403/); resolve() })
    })
  }
  const pilot = await bridge.connect()
  const closed = new Promise<number>(resolve => pilot.socket.once('close', resolve))
  pilot.socket.send('x'.repeat(1025))
  assert.equal(await closed, 1009)
})
