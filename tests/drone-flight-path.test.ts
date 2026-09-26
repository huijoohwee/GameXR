import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import https from 'node:https'
import { WebSocket } from 'ws'
import { parseFlightPath, readFlightPath, FlightPathRun } from '../src/drone/FlightPath.ts'
import { PATH_PROFILE, parsePathCommand, neutralAxes, type BridgeStatus } from '../src/drone/protocol.ts'
import { ReceiverState } from '../tools/drone-bridge/receiver-state.ts'
import { startDroneBridge } from '../tools/drone-bridge/server.ts'

const mission = () => ({ schema: 'agentic-drone-flight-path/v1', model: 'kinematic', physicalAircraft: false, tickRate: 60,
  coordinateFrame: 'local-xz-altitude-m-heading-deg', sourceDigest: 'a'.repeat(64), sceneDigest: 'b'.repeat(64),
  samples: Array.from({ length: 121 }, (_, i) => [i, 0, 0, 0, Math.min(i, 120 - i) / 60]) })

test('mission admission rejects unsupported, oversized, discontinuous and unlanded paths', () => {
  assert.equal(parseFlightPath(JSON.stringify(mission())).length, 121)
  for (const change of [{ physicalAircraft: true }, { tickRate: 30 }, { axes: {} }, { schema: 'other' },
    { samples: [] }, { sourceDigest: 'private source' }, { samples: [[0, 0, 0, 0, 0], [2, 0, 0, 0, 0]] },
    { samples: [[0, 0, 0, 0, 0], [1, 1, 0, 0, 0]] }, { samples: [[0, 0, 0, 0, 0], [1, 0, 0, 0, 1]] }])
    assert.throws(() => parseFlightPath(JSON.stringify({ ...mission(), ...change })))
  assert.throws(() => parseFlightPath(' '.repeat(500001)))
  const value = mission(); value.samples[1]![1] = NaN
  assert.throws(() => parseFlightPath(JSON.stringify(value)))
})

test('sample clock starts at origin, retains timing, rejects stalls and requires final receiver acknowledgment', () => {
  const run = new FlightPathRun(parseFlightPath(JSON.stringify(mission())))
  assert.deepEqual(run.next(1000), [0, 0, 0, 0, 0]); assert.equal(run.next(1000), null)
  assert.equal(run.complete([120, 0, 0, 0, 0]), false)
  for (let i = 1; i <= 50; i++) run.next(1000 + 40 * i)
  assert.equal(run.complete([120, 0, 0, 0, 0]), true)
  const stalled = new FlightPathRun(parseFlightPath(JSON.stringify(mission())))
  stalled.next(0); assert.throws(() => stalled.next(251), /stalled/)
})

test('receiver rejects path replay, jumps and mode mixing; exact lease expiry clears path and axes', () => {
  let clock = 0
  const state = new ReceiverState(() => clock), session = 'a'.repeat(32)
  state.accept({ kind: 'enable', session, challenge: state.telemetry().challenge })
  const command = (sequence: number, pose: number[]) => ({ kind: 'path', session, challenge: state.telemetry().challenge, sequence, pose })
  const first = command(1, [0, 0, 0, 0, 0]); state.accept(first)
  assert.throws(() => state.accept(first))
  assert.throws(() => state.accept(command(2, [2, 1, 0, 0, 0])))
  clock = 40; state.accept(command(2, [2, 0, 0, 0, 0.03]))
  assert.deepEqual(state.telemetry().pathPose, [2, 0, 0, 0, 0.03])
  assert.deepEqual(state.telemetry().setpoint, neutralAxes()); assert.equal(state.telemetry().motorOutputs, false)
  assert.throws(() => state.accept({ kind: 'controls', session, challenge: state.telemetry().challenge, sequence: 3, frame: '0'.repeat(32) }))
  clock = 289; assert.equal(state.telemetry().enabled, true)
  clock = 290; assert.equal(state.telemetry().enabled, false); assert.equal(state.telemetry().pathPose, null)
  assert.throws(() => parsePathCommand({ ...command(3, [0, 0, 0, 0, 0]), profile: PATH_PROFILE, motorOutputs: true }))
})

test('paired HTTPS → WebSocket → UDP accepts path only for paired origin and inhibits on disconnect', { timeout: 12000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gamexr-path-tls-'))
  let bridge: Awaited<ReturnType<typeof startDroneBridge>> | undefined
  const clients: WebSocket[] = []
  try {
    const config = join(dir, 'openssl.cnf'), cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem')
    await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=GameXR path test\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-config', config, '-keyout', key, '-out', cert], { stdio: 'ignore', timeout: 5000 })
    await writeFile(join(dir, 'index.html'), 'test')
    const ca = await readFile(cert)
    bridge = await startDroneBridge({ root: dir, port: 0, tls: { host: '127.0.0.1', cert: ca, key: await readFile(key) } })
    const origin = bridge.origin
    const request = (route: string, body?: string, cookie?: string) => new Promise<{ status: number; cookie: string }>((resolve, reject) => {
      const req = https.request(origin + route, { ca, method: body ? 'POST' : 'GET',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, response => {
        response.resume(); response.on('end', () => resolve({ status: response.statusCode!, cookie: response.headers['set-cookie']?.[0]?.split(';')[0] ?? '' }))
      }); req.on('error', reject); req.end(body)
    })
    assert.equal((await request('/gamexr/diagnostics-session')).status, 401)
    const denied = new WebSocket(origin.replace('https:', 'wss:') + '/gamexr/drone-socket', { ca, origin }); clients.push(denied)
    denied.on('error', () => {})
    await new Promise<void>(resolve => denied.on('unexpected-response', (_req, response) => { assert.equal(response.statusCode, 403); denied.terminate(); resolve() }))
    const body = JSON.stringify({ token: new URL(bridge.pairingUrl!).hash.slice(6) })
    const paired = await request('/gamexr/diagnostics-pair', body); assert.equal(paired.status, 204)
    assert.equal((await request('/gamexr/diagnostics-pair', body)).status, 403)
    const socket = new WebSocket(origin.replace('https:', 'wss:') + '/gamexr/drone-socket', { ca, origin, headers: { Cookie: paired.cookie } }); clients.push(socket)
    let state: BridgeStatus | undefined
    socket.on('message', data => { const next = JSON.parse(data.toString()); if (next.kind === 'status') state = next })
    const until = async (predicate: () => boolean) => {
      const deadline = performance.now() + 2500
      while (!predicate()) { assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5)) }
    }
    await until(() => !!state?.connected)
    socket.send(JSON.stringify({ kind: 'enable' })); await until(() => !!state?.enabled)
    socket.send(JSON.stringify({ kind: 'path', profile: PATH_PROFILE, session: state!.session, challenge: state!.telemetry!.challenge, sequence: 1, pose: [0, 0, 0, 0, 0] }))
    await until(() => state?.telemetry?.pathPose?.[0] === 0)
    assert.equal(state!.telemetry!.motorOutputs, false); assert.deepEqual(state!.telemetry!.setpoint, neutralAxes())
    socket.send(JSON.stringify({ kind: 'path', profile: PATH_PROFILE, session: state!.session, challenge: state!.telemetry!.challenge, sequence: 2, pose: [3, 0, 0, 0, 0.05] }))
    await until(() => state?.telemetry?.pathPose?.[4] === 0.05)
    socket.send(JSON.stringify({ kind: 'disable' })); await until(() => state?.telemetry?.pathPose === null && !state?.enabled)
  } finally { clients.forEach(c => c.terminate()); await bridge?.close(); await rm(dir, { recursive: true, force: true }) }
})


test('v2 source navigation is explicit and rejects credentials, executable schemes and extra parameters', () => {
  const path = { ...mission(), schema: 'agentic-drone-flight-path/v2', sourceUrl: 'https://example.test/graph/?kgDoc=flight.py' }
  assert.equal(readFlightPath(JSON.stringify(path)).sourceUrl, path.sourceUrl)
  assert.equal(readFlightPath(JSON.stringify(mission())).sourceUrl, null)
  for (const sourceUrl of ['javascript:alert(1)', 'https://user:secret@example.test/?kgDoc=flight.py',
    'https://example.test/?kgDoc=flight.py&token=secret', 'https://example.test/?kgDoc=../private', 'https://example.test/'])
    assert.throws(() => readFlightPath(JSON.stringify({ ...path, sourceUrl })))
})

test('gateway mounts only the explicit Graph build and contains path traversal and symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gamexr-graph-canvas-'))
  let bridge: Awaited<ReturnType<typeof startDroneBridge>> | undefined
  try {
    const graph = join(dir, 'graph'); await mkdir(graph)
    await writeFile(join(dir, 'index.html'), 'GameXR'); await writeFile(join(graph, 'index.html'), 'Graph Canvas')
    await writeFile(join(graph, 'graph-canvas-manifest.json'), JSON.stringify({ schema: 'agentic-graph/learning-canvas-artifact/v1',
      protocol: 'agentic-graph/learning-canvas/v1', sourceRevision: 'a'.repeat(40), entry: 'index.html', base: '/gamexr/graph-canvas/' }))
    await writeFile(join(dir, 'private.txt'), 'private'); await symlink(join(dir, 'private.txt'), join(graph, 'escape.txt'))
    bridge = await startDroneBridge({ root: dir, graphCanvasRoot: graph, port: 0 })
    const response = await fetch(bridge.origin + '/gamexr/graph-canvas/')
    assert.equal(await response.text(), 'Graph Canvas')
    assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'self'/u)
    assert.equal((await fetch(bridge.origin + '/gamexr/graph-canvas/escape.txt')).status, 403)
    assert.equal((await fetch(bridge.origin + '/gamexr/graph-canvas/%2e%2e%2fprivate.txt')).status, 403)
    assert.equal((await fetch(bridge.origin + '/gamexr/graph-canvas/', { method: 'POST' })).status, 405)
    await bridge.close(); bridge = undefined
    await writeFile(join(graph, 'graph-canvas-manifest.json'), '{}')
    await assert.rejects(startDroneBridge({ root: dir, graphCanvasRoot: graph, port: 0 }), /Unsupported Graph/u)
  } finally { await bridge?.close(); await rm(dir, { recursive: true, force: true }) }
})
