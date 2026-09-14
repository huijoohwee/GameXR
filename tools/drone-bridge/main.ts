import path from 'node:path'
import { startDroneBridge } from './server.ts'

// There is deliberately no arbitrary UDP peer or flight-enable CLI switch.
const args = process.argv.slice(2)
if (args.some(value => !/^--port=\d+$/u.test(value)) || args.length > 1) {
  throw new Error('Usage: npm run drone:bench -- [--port=4192]. Physical aircraft mode needs the reviewed board/receiver contract.')
}
const port = args[0] ? Number(args[0].split('=')[1]) : 4192
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid loopback port')
const bridge = await startDroneBridge({ root: path.resolve(import.meta.dirname, '../../dist/gamexr'), port })
console.log(`GameXR drone bench: ${bridge.origin}/gamexr/`)
console.log('SIMULATED RECEIVER · loopback UDP · no physical device or motor outputs')
const close = () => { void bridge.close().then(() => process.exit(0)) }
process.once('SIGINT', close)
process.once('SIGTERM', close)
