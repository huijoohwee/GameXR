import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { BENCH, neutralAxes, parseAxes, parseCommand, shapeAxis } from '../src/drone/protocol.ts'
import { encodeRpyt, decodeRpyt } from '../tools/drone-bridge/crtp.ts'
import { ReceiverState } from '../tools/drone-bridge/receiver-state.ts'
import { seal, unseal } from '../tools/drone-bridge/wire.ts'

const session = '01234567-89ab-cdef-0123-456789abcdef'
const frame = (throttle = 0.5) => encodeRpyt({ ...neutralAxes(), throttle }).toString('hex')

test('drone axes reject invalid values and fields; steering axes remain independent', () => {
  for (const value of [NaN, Infinity, -Infinity, 1.1, -1.1, '0', null]) {
    assert.throws(() => parseAxes({ ...neutralAxes(), roll: value }))
  }
  assert.throws(() => parseAxes({ ...neutralAxes(), throttle: -0.1 }))
  assert.throws(() => parseAxes({ ...neutralAxes(), arm: true }))
  assert.throws(() => parseAxes([]))
  assert.deepEqual(parseAxes({ ...neutralAxes(), roll: 1 }), { roll: 1, pitch: 0, yaw: 0, throttle: 0 })
  assert.equal(shapeAxis(0.05), 0)
  assert.equal(shapeAxis(-1), -1)
  assert.equal(shapeAxis(1), 1)
  assert.throws(() => shapeAxis(NaN))
  const command = { kind: 'controls', profile: BENCH.profile, session,
    challenge: session, sequence: 1, axes: neutralAxes() }
  assert.deepEqual(parseCommand(command), command)
  for (const change of [{ profile: 'aircraft/v1' }, { sequence: 0 }, { sequence: 1.5 }, { session: 'bad' }, { motors: [1] }]) {
    assert.throws(() => parseCommand({ ...command, ...change }))
  }
})

test('CRTP codec matches the legacy packed little-endian wire layout and checks checksum', () => {
  assert.equal(encodeRpyt(neutralAxes()).toString('hex'), '3c00000000000000000000000000003c')
  const packet = encodeRpyt({ roll: 1, pitch: -1, yaw: 1, throttle: 1 })
  assert.equal(packet.subarray(0, 15).toString('hex'), '3c00002041000020c1000034421027')
  assert.equal(packet[15], 0x2b)
  assert.deepEqual(decodeRpyt(packet), { roll: 1, pitch: -1, yaw: 1, throttle: 1 })
  packet[4] = 0
  assert.throws(() => decodeRpyt(packet), /checksum/)
  assert.throws(() => decodeRpyt(Buffer.alloc(17)))
})

test('fixture envelope rejects tampering, wrong key, extra fields and oversized packets', () => {
  const key = randomBytes(32), bytes = seal({ kind: 'probe' }, key)
  assert.deepEqual(unseal(bytes, key), { kind: 'probe' })
  assert.throws(() => unseal(bytes, randomBytes(32)))
  assert.throws(() => unseal(Buffer.from(bytes.toString().replace('probe', 'other')), key))
  assert.throws(() => unseal(Buffer.alloc(2049), key))
  assert.throws(() => unseal(Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString()), extra: true })), key))
})

test('receiver independently expires control at 250 ms and requires a fresh enable', () => {
  for (let trial = 0; trial < 20; trial++) {
    let now = 0
    const receiver = new ReceiverState(() => now)
    receiver.accept({ kind: 'enable', session, challenge: receiver.telemetry().challenge })
    receiver.accept({ kind: 'controls', session, challenge: receiver.telemetry().challenge, sequence: 1, frame: frame() })
    now = BENCH.leaseMs - 1
    assert.equal(receiver.telemetry().setpoint.throttle, 0.5)
    now++
    const expired = receiver.telemetry()
    assert.equal(expired.enabled, false)
    assert.equal(expired.motorOutputs, false)
    assert.deepEqual(expired.setpoint, neutralAxes())
    assert.throws(() => receiver.accept({ kind: 'controls', session, challenge: expired.challenge, sequence: 2, frame: frame() }))
    assert.equal(receiver.telemetry().enabled, false)
  }
})

test('replay, reordered commands, wrong owner and malformed frame never renew the receiver lease (20 each)', () => {
  for (const fault of ['replay', 'sequence', 'owner', 'frame']) for (let trial = 0; trial < 20; trial++) {
    let now = 0
    const receiver = new ReceiverState(() => now)
    receiver.accept({ kind: 'enable', session, challenge: receiver.telemetry().challenge })
    const command = { kind: 'controls', session, challenge: receiver.telemetry().challenge, sequence: 1, frame: frame() }
    receiver.accept(command)
    now = 200
    const bad = { ...command, challenge: receiver.telemetry().challenge, sequence: 2 }
    if (fault === 'replay') bad.challenge = command.challenge
    if (fault === 'sequence') bad.sequence = 1
    if (fault === 'owner') bad.session = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    if (fault === 'frame') bad.frame = '00'
    assert.throws(() => receiver.accept(bad))
    now = 250
    assert.equal(receiver.telemetry().enabled, false)
  }
})

test('receiver rejects delayed fresh-sequence packets and session takeover; new session starts neutral', () => {
  let now = 0
  const receiver = new ReceiverState(() => now)
  const oldChallenge = receiver.telemetry().challenge
  now = 250
  assert.throws(() => receiver.accept({ kind: 'enable', session, challenge: oldChallenge }))
  receiver.accept({ kind: 'enable', session, challenge: receiver.telemetry().challenge })
  assert.throws(() => receiver.accept({ kind: 'enable', session: 'ffffffffffffffff', challenge: receiver.telemetry().challenge }))
  receiver.accept({ kind: 'disable', session })
  receiver.accept({ kind: 'enable', session: 'ffffffffffffffff', challenge: receiver.telemetry().challenge })
  assert.deepEqual(receiver.telemetry().setpoint, neutralAxes())
  assert.equal(receiver.telemetry().batteryVolts, null)
  assert.equal(receiver.telemetry().attitudeDegrees, null)
})
