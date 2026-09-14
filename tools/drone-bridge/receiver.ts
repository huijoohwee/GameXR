import dgram from 'node:dgram'
import { BENCH } from '../../src/drone/protocol.ts'
import { ReceiverState } from './receiver-state.ts'
import { seal, unseal } from './wire.ts'

// Child-process fixture, reachable only over loopback UDP with a per-run secret.
if (!process.send) throw new Error('Start the receiver through the local bench bridge')
process.once('message', (raw: { key: string; port: number }) => {
  if (!/^[a-f0-9]{64}$/u.test(raw.key) || !Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) {
    process.exit(2)
  }
  const key = Buffer.from(raw.key, 'hex'), state = new ReceiverState(), socket = dgram.createSocket('udp4')
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    state.disable('Receiver shutdown')
    clearInterval(timer)
    socket.close()
    if (process.connected) process.disconnect?.()
  }
  socket.on('error', () => { clearInterval(timer); process.exit(2) })
  socket.on('message', (bytes, peer) => {
    if (peer.address !== '127.0.0.1' || peer.port !== raw.port) return
    try { state.accept(unseal(bytes, key)) } catch { /* Invalid packets never refresh the watchdog. */ }
  })
  socket.bind(0, '127.0.0.1', () => {
    process.send?.({ port: socket.address().port })
    timer = setInterval(() => socket.send(seal(state.telemetry(), key), raw.port, '127.0.0.1'), BENCH.cadenceMs)
  })
  process.once('disconnect', close)
  process.once('SIGTERM', close)
})
