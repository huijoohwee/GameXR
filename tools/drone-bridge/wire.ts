import { createHmac, timingSafeEqual } from 'node:crypto'
import { object } from '../../src/drone/protocol.ts'

/** Authenticated loopback fixture envelope; stock ESP-Drone does not implement it. */
export function seal(value: unknown, key: Buffer): Buffer {
  const payload = JSON.stringify(value)
  const mac = createHmac('sha256', key).update(payload).digest('hex')
  return Buffer.from(JSON.stringify({ payload, mac }))
}

export function unseal(bytes: Buffer, key: Buffer): Record<string, unknown> {
  if (bytes.length > 2048) throw new Error('Oversized receiver packet')
  const envelope = object(JSON.parse(bytes.toString()))
  if (Object.keys(envelope).length !== 2 || typeof envelope.payload !== 'string'
    || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/u.test(envelope.mac)) throw new Error('Invalid envelope')
  const expected = createHmac('sha256', key).update(envelope.payload).digest()
  if (!timingSafeEqual(expected, Buffer.from(envelope.mac, 'hex'))) throw new Error('Packet authentication failed')
  return object(JSON.parse(envelope.payload))
}
