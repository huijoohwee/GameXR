import http from 'node:http'
import https from 'node:https'
import dgram from 'node:dgram'
import { fork } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { BENCH, exactKeys, object, parseCommand, parsePathCommand, type BridgeStatus,
  type ReceiverTelemetry } from '../../src/drone/protocol.ts'
import { encodeRpyt } from './crtp.ts'
import { seal, unseal } from './wire.ts'

import { staticHandler } from './static.ts'
import { phoneGateway, validateGatewayHost, type GatewayTls } from './phone-gateway.ts'

export async function startDroneBridge(options: { root: string; port?: number; tls?: GatewayTls; graphCanvasRoot?: string }) {
  if (options.tls) validateGatewayHost(options.tls.host)
  const root = await realpath(options.root)
  if (!(await stat(path.join(root, 'index.html'))).isFile()) throw new Error('Build GameXR before starting the bridge')
  const graphRoot = options.graphCanvasRoot ? await realpath(options.graphCanvasRoot) : null
  if (graphRoot) {
    const manifest = JSON.parse(await readFile(path.join(graphRoot, 'graph-canvas-manifest.json'), 'utf8'))
    if (manifest.schema !== 'agentic-graph/learning-canvas-artifact/v1' || manifest.protocol !== 'agentic-graph/learning-canvas/v1'
      || manifest.entry !== 'index.html' || manifest.base !== '/gamexr/graph-canvas/'
      || typeof manifest.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/u.test(manifest.sourceRevision)
      || !(await stat(path.join(graphRoot, 'index.html'))).isFile()) throw new Error('Unsupported Graph Canvas artifact')
  }
  const key = randomBytes(32), udp = dgram.createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    udp.once('error', reject)
    udp.bind(0, '127.0.0.1', () => { udp.off('error', reject); resolve() })
  })
  const child = fork(fileURLToPath(new URL('./receiver.ts', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  let receiverPort: number
  try {
    receiverPort = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bench receiver startup timed out')), 5000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Bench receiver exited during startup')) })
      child.once('message', (value: { port?: number }) => {
        clearTimeout(timeout)
        if (!value.port || !Number.isInteger(value.port)) reject(new Error('Invalid receiver port'))
        else resolve(value.port)
      })
      child.send({ key: key.toString('hex'), port: udp.address().port })
    })
  } catch (error) { udp.close(); child.kill(); throw error }

  let telemetry: ReceiverTelemetry | null = null, receivedAt = -Infinity
  let owner: WebSocket | null = null, epoch: string | null = null, sequence = 0, lastCommand = -Infinity
  let receiverConfirmed = false, lastSample = 0
  const challenges = new Map<string, number>()
  let reason = 'Connected to simulated receiver', stopped = false, origin = ''
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false })
  const sendReceiver = (message: unknown) => {
    if (!stopped) udp.send(seal(message, key), receiverPort, '127.0.0.1', error => {
      if (error) release('Receiver transport error')
    })
  }
  const release = (why: string) => {
    const previousEpoch = epoch
    owner = null; epoch = null; sequence = 0; receiverConfirmed = false; challenges.clear(); reason = why
    if (previousEpoch && !stopped) sendReceiver({ kind: 'disable', session: previousEpoch })
  }
  const fresh = () => telemetry !== null && performance.now() - receivedAt < BENCH.telemetryMaxAgeMs
  const status = (client: WebSocket): BridgeStatus => ({ kind: 'status', backend: 'simulated',
    connected: fresh(), owned: owner === client, session: owner === client ? epoch : null,
    enabled: owner === client && fresh() && telemetry?.enabled === true && telemetry.session === epoch,
    reason, telemetry, telemetryAgeMs: telemetry ? Math.round(performance.now() - receivedAt) : null })
  const sendStatus = (client: WebSocket) => {
    if (client.readyState !== WebSocket.OPEN) return
    if (client.bufferedAmount > 8192) {
      if (client === owner) release('Pilot connection backpressure')
      client.terminate(); return
    }
    client.send(JSON.stringify(status(client)))
  }
  const broadcast = () => { for (const client of sockets.clients) sendStatus(client) }
  udp.on('error', () => release('Receiver socket failed'))
  udp.on('message', (bytes, peer) => {
    if (peer.address !== '127.0.0.1' || peer.port !== receiverPort) return
    try {
      const data = unseal(bytes, key)
      // Only our separately spawned, authenticated fixture can produce these fields.
      if (data.source !== 'simulated' || data.device !== BENCH.device || data.profile !== BENCH.profile
        || data.motorOutputs !== false || typeof data.challenge !== 'string'
        || !Number.isSafeInteger(data.sample) || (data.sample as number) <= lastSample) return
      telemetry = data as unknown as ReceiverTelemetry
      lastSample = telemetry.sample
      receivedAt = performance.now()
      if (owner && telemetry.enabled && telemetry.session === epoch) receiverConfirmed = true
      if (owner && telemetry.session !== epoch && (receiverConfirmed || performance.now() - lastCommand >= BENCH.leaseMs)) {
        release('Receiver did not retain control authority')
      }
      challenges.set(telemetry.challenge, receivedAt)
      for (const [challenge, at] of challenges) if (receivedAt - at >= BENCH.leaseMs) challenges.delete(challenge)
      while (challenges.size > 8) challenges.delete(challenges.keys().next().value!)
      broadcast()
    } catch { /* A malformed or unauthenticated datagram does not refresh telemetry. */ }
  })

  sockets.on('connection', client => {
    let windowAt = performance.now(), messages = 0
    sendStatus(client)
    client.on('error', () => { if (owner === client) release('Pilot socket error') })
    client.on('close', () => { if (owner === client) release('Pilot disconnected'); broadcast() })
    client.on('message', (bytes, binary) => {
      try {
        if (performance.now() - windowAt >= 1000) { windowAt = performance.now(); messages = 0 }
        if (++messages > 80 || binary) throw new Error('Invalid command rate or format')
        const message = object(JSON.parse(bytes.toString()))
        if (message.kind === 'enable') {
          exactKeys(message, ['kind'])
          if (owner) throw new Error('Another control session is already active')
          if (!fresh() || telemetry?.enabled) throw new Error('Wait for an inhibited, fresh receiver')
          owner = client; epoch = randomUUID(); sequence = 0; lastCommand = performance.now()
          receiverConfirmed = false; challenges.clear()
          reason = 'Waiting for simulated receiver acknowledgment'
          sendReceiver({ kind: 'enable', session: epoch, challenge: telemetry!.challenge })
        } else if (message.kind === 'disable') {
          exactKeys(message, ['kind'])
          if (owner === client) release('Pilot disabled bench control')
        } else {
          const command = message.kind === 'path' ? parsePathCommand(message) : parseCommand(message)
          if (owner !== client || command.session !== epoch) throw new Error('Pilot does not own this session')
          if (!fresh() || !telemetry?.enabled || telemetry.session !== epoch) throw new Error('Receiver is not ready')
          if (performance.now() - lastCommand >= BENCH.leaseMs) throw new Error('Pilot lease expired')
          if (command.sequence <= sequence) throw new Error('Duplicate or reordered pilot sequence')
          const challengeAt = challenges.get(command.challenge)
          if (challengeAt === undefined || performance.now() - challengeAt >= BENCH.leaseMs) throw new Error('Stale or replayed receiver challenge')
          challenges.delete(command.challenge)
          sequence = command.sequence; lastCommand = performance.now()
          sendReceiver({ kind: command.kind, session: epoch, challenge: command.challenge,
            sequence, ...(command.kind === 'path' ? { pose: command.pose } : { frame: encodeRpyt(command.axes).toString('hex') }) })
          reason = 'Bench control enabled · simulated receiver · no motor outputs'
        }
        sendStatus(client)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid command'
        if (owner === client) release(message)
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ kind: 'error', message }))
        sendStatus(client)
      }
    })
  })

  const gameFiles = staticHandler(root, () => origin)
  const graphFiles = graphRoot ? staticHandler(graphRoot, () => origin, '/gamexr/graph-canvas/', true) : null
  const files: http.RequestListener = (request, response) => {
    if (request.url?.split('?')[0]?.startsWith('/gamexr/graph-canvas/')) {
      if (graphFiles) return graphFiles(request, response)
      response.writeHead(404).end(); return
    }
    return gameFiles(request, response)
  }
  const gateway = options.tls ? phoneGateway(() => origin, files) : null
  const server = options.tls ? https.createServer(options.tls, gateway!.handler) : http.createServer(files)
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/gamexr/drone-socket' || request.headers.origin !== origin
      || request.headers.host !== new URL(origin).host || sockets.clients.size >= 4 || (gateway && !gateway.authorized(request))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request))
  })
  const timer = setInterval(() => {
    if (gateway && !gateway.alive()) { release('Phone pairing expired'); for (const client of sockets.clients) client.close(1008, 'Pairing expired') }
    if (owner && (!fresh() || performance.now() - lastCommand >= BENCH.leaseMs)) release('Pilot lease expired')
    broadcast()
  }, BENCH.cadenceMs)
  const close = async () => {
    if (stopped) return
    release('Bridge shutdown'); stopped = true; clearInterval(timer)
    for (const client of sockets.clients) client.terminate()
    sockets.close(); udp.close()
    if (child.connected) child.disconnect()
    await Promise.all([
      new Promise<void>(resolve => server.close(() => resolve())),
      new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
        const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1000)
        child.once('exit', () => { clearTimeout(timeout); resolve() })
      }),
    ])
  }
  child.on('exit', () => { if (!stopped) { release('Simulated receiver exited'); telemetry = null; broadcast() } })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 4192, options.tls?.host ?? '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') { reject(new Error('Invalid bridge address')); return }
        origin = `${options.tls ? 'https' : 'http'}://${options.tls?.host ?? '127.0.0.1'}:${address.port}`; resolve()
      })
    })
  } catch (error) { await close(); throw error }
  return { origin, close, receiverPid: child.pid, receiverPort, pairingUrl: gateway ? `${origin}/gamexr/#pair=${gateway.pairing}` : undefined }
}
