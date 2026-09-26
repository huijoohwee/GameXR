import http from 'node:http'
import https from 'node:https'
import { phoneGateway, validateGatewayHost, type GatewayTls } from './phone-gateway.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { realpath, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { DiagnosticsState } from '../../src/drone/diagnostics/protocol.ts'
import { staticHandler } from './static.ts'

export type Input = { kind: 'usb'; port: string; usbId: string; python: string; seconds: number }
  | { kind: 'replay'; path: string; cadenceMs?: number }
export async function startDiagnosticsBridge(options: { root: string; port?: number; input: Input; tls?: GatewayTls }) {
  if (options.tls) validateGatewayHost(options.tls.host)
  const root = await realpath(options.root)
  if (!(await stat(path.join(root, 'index.html'))).isFile()) throw new Error('Build GameXR first')
  const state = new DiagnosticsState(options.input.kind === 'usb' ? 'usb' : 'replay')
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 128, perMessageDeflate: false })
  let origin = '', stopped = false, active = false, generation = 0
  let child: ChildProcess | null = null, playback: ReturnType<typeof setInterval> | null = null
  let stopping: Promise<void> | null = null
  const send = (client: WebSocket) => {
    if (client.readyState !== WebSocket.OPEN) return
    if (client.bufferedAmount > 8192) { client.terminate(); return }
    client.send(JSON.stringify(state.snapshot(performance.now())))
  }
  const broadcast = () => { for (const client of sockets.clients) send(client) }
  const stopInput = (reason: string): Promise<void> => {
    if (stopping) return stopping
    active = false; generation++
    if (playback) { clearInterval(playback); playback = null }
    state.link('disconnected', reason); broadcast()
    const process = child; child = null
    stopping = new Promise<void>(resolve => {
      if (!process || process.exitCode !== null || process.signalCode !== null) { resolve(); return }
      const timeout = setTimeout(() => { process.kill('SIGKILL') }, 1500)
      process.once('close', () => { clearTimeout(timeout); resolve() })
      process.kill('SIGTERM')
    }).finally(() => { stopping = null })
    return stopping
  }
  const startInput = async () => {
    if (active || stopped || stopping) return
    active = true; const own = ++generation
    state.link('waiting', 'Opening observation session'); broadcast()
    const current = () => !stopped && active && generation === own
    try {
      if (options.input.kind === 'replay') {
        if ((await stat(options.input.path)).size > 499999) throw new Error('Replay exceeds 499999-byte limit')
        const raw = await readFile(options.input.path, 'utf8')
        if (!current()) return
        const lines = raw.split(/\r?\n/u).filter(line => line.startsWith('{'))
        if (!lines.length || lines.some(line => Buffer.byteLength(line) > 1024)) throw new Error('Invalid replay framing')
        let index = 0
        state.link('connected', 'Recorded data · not live')
        playback = setInterval(() => {
          if (!current()) return
          if (index === lines.length) { void stopInput('Replay complete'); return }
          state.ingest(lines[index++]!, performance.now()); broadcast()
        }, options.input.cadenceMs ?? 100)
      } else {
        const input = options.input
        const process = spawn(input.python, ['-B', fileURLToPath(new URL('../drone-telemetry/diagnostics_stream.py', import.meta.url)),
          '--port', input.port, '--expect-usb-id', input.usbId, '--seconds', String(input.seconds), '--acknowledge-open-may-reset'],
        { stdio: ['ignore', 'pipe', 'pipe'] })
        child = process
        let pending = '', diagnostic = ''
        process.stderr?.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-2048) })
        process.stdout?.on('data', (data: Buffer) => {
          if (!current()) return
          pending += data.toString('utf8')
          if (Buffer.byteLength(pending) > 16384) { void stopInput('Observer output exceeded limit'); return }
          let split: number
          while ((split = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, split); pending = pending.slice(split + 1)
            try {
              const event = JSON.parse(line)
              if (event.kind === 'line' && typeof event.line === 'string') {
                state.ingest(event.line, performance.now()); broadcast()
              }
              else if (event.kind === 'link' && ['connected', 'disconnected'].includes(event.status) && typeof event.reason === 'string')
                state.link(event.status, event.reason.slice(0, 160))
              else throw new Error('Unknown observer event')
            } catch { void stopInput('Invalid observer output'); return }
          }
          broadcast()
        })
        process.once('error', () => { if (current()) void stopInput('Cannot start Python observer; check the selected environment') })
        process.once('close', code => {
          if (!current()) return
          child = null; active = false
          state.link('disconnected', code ? `Observer stopped (${code}); ${diagnostic.slice(-120)}` : 'Session ended; reconnect to start another bounded capture')
          broadcast()
        })
      }
    } catch (error) {
      if (current()) await stopInput(error instanceof Error ? error.message : 'Observation failed')
    }
  }
  const files = staticHandler(root, () => origin)
  const gateway = options.tls ? phoneGateway(() => origin, files) : null
  const server = options.tls
    ? https.createServer({ cert: options.tls.cert, key: options.tls.key, minVersion: 'TLSv1.2' }, gateway!.handler)
    : http.createServer(files)
  server.headersTimeout = 5000; server.requestTimeout = 10000; server.maxConnections = 32
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/gamexr/diagnostics-socket' || request.headers.origin !== origin
      || request.headers.host !== new URL(origin).host || sockets.clients.size >= 4
      || (gateway && !gateway.authorized(request))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request))
  })
  sockets.on('connection', client => {
    send(client)
    let since = performance.now(), count = 0
    client.on('error', () => {})
    client.on('message', (bytes, binary) => {
      if (performance.now() - since > 1000) { count = 0; since = performance.now() }
      try {
        const command = JSON.parse(bytes.toString())
        if (binary || ++count > 5 || Object.keys(command).join(',') !== 'action') throw new Error('Invalid request')
        if (command.action === 'start') void startInput()
        else if (command.action === 'stop') void stopInput('Observation stopped')
        else throw new Error('Observation-only endpoint')
      } catch { client.close(1008, 'Observation requests only') }
    })
    client.on('close', () => { if (!sockets.clients.size) void stopInput('Dashboard disconnected; serial port released') })
  })
  const timer = setInterval(() => {
    if (gateway && !gateway.alive()) {
      for (const client of sockets.clients) client.terminate()
      if (active) void stopInput('Phone session expired; restart gateway to pair again')
    } else broadcast()
  }, 200)
  const close = async () => {
    if (stopped) return
    stopped = true; clearInterval(timer); await stopInput('Bridge stopped')
    for (const client of sockets.clients) client.terminate()
    sockets.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? (options.tls ? 4196 : 4194), options.tls?.host ?? '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') { reject(new Error('Invalid address')); return }
        origin = `${options.tls ? 'https' : 'http'}://${options.tls?.host ?? '127.0.0.1'}:${address.port}`; resolve()
      })
    })
  } catch (error) { await close(); throw error }
  return { origin, close, pairingUrl: gateway ? `${origin}/gamexr/?diagnostics=1#pair=${gateway.pairing}` : null }
}
