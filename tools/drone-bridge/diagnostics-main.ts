import path from 'node:path'
import { startDiagnosticsBridge, type Input } from './diagnostics.ts'
const args = new Map<string, string>()
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.+)$/u.exec(argument)
  if (!match || args.has(match[1]!) || !['port', 'serial', 'usb-id', 'python', 'seconds', 'replay', 'physical-ready'].includes(match[1]!)) throw new Error('Invalid or duplicate option')
  args.set(match[1]!, match[2]!)
}
const port = Number(args.get('port') ?? 4194), seconds = Number(args.get('seconds') ?? 60)
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(seconds) || seconds < 10 || seconds > 600) throw new Error('Invalid port or duration (10..600 seconds)')
if (args.has('serial') === args.has('replay')) throw new Error('Select exactly one: --serial=/dev/... or --replay=/path/to/capture')
let input: Input
if (args.has('serial')) {
  if (args.get('physical-ready') !== 'yes' || !/^\/dev\/[^/]+$/u.test(args.get('serial')!)
    || !/^[\da-f]{4}:[\da-f]{4}$/iu.test(args.get('usb-id') ?? '')) throw new Error('USB mode requires explicit port, --usb-id=VID:PID and --physical-ready=yes (existing props/motor isolation)')
  input = { kind: 'usb', port: args.get('serial')!, usbId: args.get('usb-id')!, python: args.get('python') ?? 'python3', seconds }
} else input = { kind: 'replay', path: path.resolve(args.get('replay')!) }
const bridge = await startDiagnosticsBridge({ root: path.resolve(import.meta.dirname, '../../dist/gamexr'), port, input })
console.log(`GameXR diagnostics: ${bridge.origin}/gamexr/?diagnostics=1`)
console.log(`${input.kind === 'usb' ? 'USB observation' : 'Recorded replay'} · read-only · start a bounded session in the dashboard`)
const close = () => { void bridge.close().then(() => process.exit(0)) }
process.once('SIGTERM', close); process.once('SIGINT', close)
