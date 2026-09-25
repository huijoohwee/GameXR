import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { startDroneBridge } from './server.ts'

// There is deliberately no arbitrary UDP peer or flight-enable CLI switch.
const args = new Map<string, string>()
for (const argument of process.argv.slice(2)) {
  const match = /^--(port|listen|tls-cert|tls-key)=(.+)$/u.exec(argument)
  if (!match || args.has(match[1]!)) throw new Error('Use --port=4192 and optional --listen=PRIVATE_IP --tls-cert=FILE --tls-key=FILE. Simulated receiver only.')
  args.set(match[1]!, match[2]!)
}
const port = Number(args.get('port') ?? 4192)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid loopback port')
const tlsFlags = ['listen', 'tls-cert', 'tls-key'].filter(key => args.has(key)).length
if (tlsFlags !== 0 && tlsFlags !== 3) throw new Error('Phone gateway needs listen, tls-cert and tls-key together')
let tls
if (tlsFlags) {
  const keyPath = path.resolve(args.get('tls-key')!)
  if ((await stat(keyPath)).mode & 0o077) throw new Error('TLS key must be private: chmod 600')
  tls = { host: args.get('listen')!, cert: await readFile(path.resolve(args.get('tls-cert')!)), key: await readFile(keyPath) }
}
const bridge = await startDroneBridge({ root: path.resolve(import.meta.dirname, '../../dist/gamexr'), port, tls })
console.log(`GameXR drone bench: ${bridge.origin}/gamexr/`)
if (bridge.pairingUrl) console.log(`Private one-use phone pairing link (15 minutes): ${bridge.pairingUrl}`)
console.log('SIMULATED RECEIVER · loopback UDP · no physical device or motor outputs')
const close = () => { void bridge.close().then(() => process.exit(0)) }
process.once('SIGINT', close)
process.once('SIGTERM', close)
