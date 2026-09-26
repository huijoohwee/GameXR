import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import https from 'node:https'
import { readFile } from 'node:fs/promises'
import { validateGatewayHost } from '../tools/drone-bridge/phone-gateway.ts'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { startDiagnosticsBridge } from '../tools/drone-bridge/diagnostics.ts'
import { PROFILE, type Snapshot } from '../src/drone/diagnostics/protocol.ts'

test('loopback bridge replays, stops, reconnects, rejects controls and foreign origins', { timeout: 12000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gamexr-diagnostics-test-'))
  let bridge: Awaited<ReturnType<typeof startDiagnosticsBridge>> | undefined
  const clients: WebSocket[] = []
  try {
    const root = join(dir, 'web'); await mkdir(root); await writeFile(join(root, 'index.html'), 'test page')
    await writeFile(join(dir, 'private.txt'), 'private'); await symlink(join(dir, 'private.txt'), join(root, 'escape.txt'))
    const line = (seq: number) => JSON.stringify({ profile: PROFILE, type: 'sample', seq, uptime_ms: seq * 100,
      motor_gate_command: 'low_held', imu: { status: 'ok', frame: 'sensor', accel_m_s2: [0, 0, 9.8], gyro_rad_s: [0, 0, 0] },
      battery: { status: 'no_efuse_calibration', raw: 100, adc_mv: null, battery_mv: null } })
    const capture = join(dir, 'capture.jsonl'); await writeFile(capture, Array.from({ length: 20 }, (_, i) => line(i)).join('\n'))
    bridge = await startDiagnosticsBridge({ root, port: 0, input: { kind: 'replay', path: capture, cadenceMs: 15 } })
    assert.equal((await fetch(bridge.origin + '/gamexr/escape.txt')).status, 403)
    assert.equal((await fetch(bridge.origin + '/gamexr/', { method: 'POST' })).status, 405)
    const socket = new WebSocket(bridge.origin.replace('http:', 'ws:') + '/gamexr/diagnostics-socket', { origin: bridge.origin }); clients.push(socket)
    const seen: Snapshot[] = []; socket.on('message', data => seen.push(JSON.parse(data.toString())))
    await once(socket, 'open')
    const until = (predicate: () => boolean) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(interval); reject(new Error('Expected observation missing')) }, 2000)
      const interval = setInterval(() => { if (predicate()) { clearTimeout(timeout); clearInterval(interval); resolve() } }, 10)
    })
    socket.send(JSON.stringify({ action: 'start' })); await until(() => seen.some(s => s.sample && s.state === 'replay'))
    assert.ok(seen.every(s => s.source === 'replay' && s.actuationAvailable === false))
    socket.send(JSON.stringify({ action: 'stop' })); await until(() => seen.at(-1)?.state === 'disconnected')
    assert.equal(seen.at(-1)?.sample, null)
    const previous = seen.at(-1)!.session
    socket.send(JSON.stringify({ action: 'start' })); await until(() => seen.some(s => s.session > previous && s.sample))
    socket.send(JSON.stringify({ action: 'arm' })); const [code] = await once(socket, 'close'); assert.equal(code, 1008)
    const denied = new WebSocket(bridge.origin.replace('http:', 'ws:') + '/gamexr/diagnostics-socket', { origin: 'http://example.com' }); clients.push(denied)
    denied.on('error', () => {})
    const [, response] = await once(denied, 'unexpected-response'); assert.equal(response.statusCode, 403); denied.terminate()
  } finally { for (const client of clients) client.terminate(); await bridge?.close(); await rm(dir, { recursive: true, force: true }) }
})

test('observer chunks preserve every sample and failed spawn releases the session', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gamexr-observer-test-'))
  let bridge: Awaited<ReturnType<typeof startDiagnosticsBridge>> | undefined
  let socket: WebSocket | undefined
  try {
    await writeFile(join(dir, 'index.html'), 'fixture')
    const events = [{ kind: 'link', status: 'connected', reason: 'synthetic reader' },
      ...[0, 1, 2].map(seq => ({ kind: 'line', line: JSON.stringify({ profile: PROFILE, type: 'sample', seq,
        uptime_ms: seq * 100, motor_gate_command: 'low_held',
        imu: { status: 'ok', frame: 'sensor', accel_m_s2: [0, 0, 9.8], gyro_rad_s: [0, 0, 0] },
        battery: { status: 'no_efuse_calibration', raw: 100, adc_mv: null, battery_mv: null } }) }))]
    const script = join(dir, 'synthetic-observer')
    await writeFile(script, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(events.map(e => JSON.stringify(e)).join('\n') + '\n')});\n`, { mode: 0o700 })
    for (const python of [script, join(dir, 'missing-python')]) {
      bridge = await startDiagnosticsBridge({ root: dir, port: 0, input: { kind: 'usb', python, port: '/dev/test-only', usbId: '0000:0000', seconds: 10 } })
      socket = new WebSocket(bridge.origin.replace('http:', 'ws:') + '/gamexr/diagnostics-socket', { origin: bridge.origin })
      const samples = new Set<number>()
      const finished = new Promise<void>(resolve => socket!.on('message', data => {
        const s: Snapshot = JSON.parse(data.toString()); if (s.sample) samples.add(s.sample.seq)
        if (s.state === 'disconnected') resolve()
      }))
      await once(socket, 'open'); socket.send(JSON.stringify({ action: 'start' })); await finished
      assert.deepEqual([...samples], python === script ? [0, 1, 2] : [])
      socket.terminate(); await bridge.close(); bridge = undefined
    }
  } finally { socket?.terminate(); await bridge?.close(); await rm(dir, { recursive: true, force: true }) }
})


test('paired HTTPS gateway requires valid TLS trust, single-use pairing, exact origin and a private host', { timeout: 10000 }, async () => {
  for (const address of ['0.0.0.0', '8.8.8.8', 'localhost', '192.168.999.2']) assert.throws(() => validateGatewayHost(address))
  const dir = await mkdtemp(join(tmpdir(), 'gamexr-phone-test-'))
  let bridge: Awaited<ReturnType<typeof startDiagnosticsBridge>> | undefined
  const clients: WebSocket[] = []
  try {
    const config = join(dir, 'openssl.cnf'), key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem')
    await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=GameXR test\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1', '-config', config, '-keyout', key, '-out', cert], { stdio: 'ignore', timeout: 5000 })
    await writeFile(join(dir, 'index.html'), 'phone fixture')
    const ca = await readFile(cert)
    bridge = await startDiagnosticsBridge({ root: dir, port: 0, tls: { host: '127.0.0.1', cert: ca, key: await readFile(key) }, input: { kind: 'replay', path: join(dir, 'unused') } })
    const origin = bridge.origin, pairing = new URL(bridge.pairingUrl!).hash.slice('#pair='.length)
    const request = (route: string, method = 'GET', body = '', headers: Record<string, string> = {}, trust = true) => new Promise<{ status: number; cookies: string[] }>((resolve, reject) => {
      const req = https.request(origin + route, { method, ca: trust ? ca : undefined, headers: { ...headers, ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) } }, res => {
        res.resume(); res.on('end', () => resolve({ status: res.statusCode!, cookies: res.headers['set-cookie'] ?? [] }))
      }); req.on('error', reject); req.end(body)
    })
    await assert.rejects(request('/gamexr/', 'GET', '', {}, false), /self-signed|certificate/iu)
    assert.equal((await request('/gamexr/')).status, 200)
    assert.equal((await request('/gamexr/diagnostics-session')).status, 401)
    const payload = JSON.stringify({ token: pairing })
    const pairHeaders = { Origin: origin, 'Content-Type': 'application/json' }
    assert.equal((await request('/gamexr/diagnostics-pair', 'POST', payload, { ...pairHeaders, Origin: 'https://example.com' })).status, 403)
    assert.equal((await request('/gamexr/diagnostics-pair', 'POST', JSON.stringify({ token: '0'.repeat(64) }), pairHeaders)).status, 403)
    const denied = new WebSocket(origin.replace('https:', 'wss:') + '/gamexr/diagnostics-socket', { origin, ca }); clients.push(denied)
    denied.on('error', () => {})
    const [, rejected] = await once(denied, 'unexpected-response'); assert.equal(rejected.statusCode, 403); denied.terminate()
    const paired = await request('/gamexr/diagnostics-pair', 'POST', payload, pairHeaders)
    assert.equal(paired.status, 204); assert.match(paired.cookies[0]!, /Secure; HttpOnly; SameSite=Strict/u)
    const cookie = paired.cookies[0]!.split(';')[0]!
    assert.equal((await request('/gamexr/diagnostics-session', 'GET', '', { Cookie: cookie })).status, 204)
    assert.equal((await request('/gamexr/diagnostics-pair', 'POST', payload, pairHeaders)).status, 403)
    const socket = new WebSocket(origin.replace('https:', 'wss:') + '/gamexr/diagnostics-socket', { origin, ca, headers: { Cookie: cookie } }); clients.push(socket)
    await once(socket, 'open'); socket.send(JSON.stringify({ action: 'arm' }))
    const [code] = await once(socket, 'close'); assert.equal(code, 1008)
  } finally { clients.forEach(client => client.terminate()); await bridge?.close(); await rm(dir, { recursive: true, force: true }) }
})
