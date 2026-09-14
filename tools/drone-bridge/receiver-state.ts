import { randomBytes } from 'node:crypto'
import { BENCH, exactKeys, neutralAxes, token, type Axes, type ReceiverTelemetry } from '../../src/drone/protocol.ts'
import { decodeRpyt } from './crtp.ts'

/** Runs in the receiver process. No GPIO, serial device or motor driver exists here. */
export class ReceiverState {
  private session: string | null = null
  private sequence = 0
  private sample = 0
  private lastCommand: number | null = null
  private axes: Axes = neutralAxes()
  private challenges = new Map<string, number>()
  private reason = 'Bench receiver inhibited'
  private clock: () => number
  constructor(clock: () => number = () => performance.now()) { this.clock = clock }

  disable(reason: string): void {
    this.session = null
    this.sequence = 0
    this.lastCommand = null
    this.axes = neutralAxes()
    this.challenges.clear()
    this.reason = reason
  }

  tick(): void {
    const now = this.clock()
    if (this.session && this.lastCommand !== null && now - this.lastCommand >= BENCH.leaseMs) {
      this.disable('Receiver watchdog expired')
    }
    for (const [nonce, at] of this.challenges) if (now - at >= BENCH.leaseMs) this.challenges.delete(nonce)
  }

  accept(message: Record<string, unknown>): void {
    this.tick()
    if (message.kind === 'disable') {
      exactKeys(message, ['kind', 'session'])
      if (token(message.session) === this.session) this.disable('Pilot session disabled')
      return
    }
    exactKeys(message, message.kind === 'enable'
      ? ['kind', 'session', 'challenge'] : ['kind', 'session', 'challenge', 'sequence', 'frame'])
    const session = token(message.session), challenge = token(message.challenge)
    if (!this.challenges.has(challenge)) throw new Error('Expired or replayed receiver challenge')
    this.challenges.delete(challenge)
    if (message.kind === 'enable') {
      if (this.session) throw new Error('Receiver already owned')
      this.challenges.clear()
      this.session = session
      this.sequence = 0
      this.axes = neutralAxes()
    } else {
      if (message.kind !== 'controls' || session !== this.session) throw new Error('Receiver session mismatch')
      if (!Number.isSafeInteger(message.sequence) || (message.sequence as number) <= this.sequence) {
        throw new Error('Reordered or duplicate command')
      }
      if (typeof message.frame !== 'string' || !/^[a-f0-9]{32}$/u.test(message.frame)) throw new Error('Invalid frame')
      this.axes = decodeRpyt(Buffer.from(message.frame, 'hex'))
      this.sequence = message.sequence as number
    }
    this.lastCommand = this.clock()
    this.reason = 'Simulated receiver accepted command; no motors'
  }

  telemetry(): ReceiverTelemetry {
    this.tick()
    const challenge = randomBytes(12).toString('hex')
    this.challenges.set(challenge, this.clock())
    while (this.challenges.size > 8) this.challenges.delete(this.challenges.keys().next().value!)
    return { source: 'simulated', device: BENCH.device, firmware: 'gamexr-bench-receiver/1',
      profile: BENCH.profile, challenge, sample: ++this.sample, session: this.session, enabled: this.session !== null,
      sequence: this.sequence, commandAgeMs: this.lastCommand === null ? null : Math.round(this.clock() - this.lastCommand),
      setpoint: { ...this.axes }, motorOutputs: false, batteryVolts: null, attitudeDegrees: null, reason: this.reason }
  }
}
