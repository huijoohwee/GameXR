import { BENCH, parseAxes, type Axes } from '../../src/drone/protocol.ts'

// Independently implemented from the documented legacy CRTP RPYT wire layout:
// port 3/channel 0, three little-endian float32 values, uint16 thrust, UDP sum8.
// These bench signs/limits are NOT an approved profile for an unidentified aircraft.
export function encodeRpyt(axes: Axes): Buffer {
  const values = parseAxes(axes)
  const frame = Buffer.alloc(16)
  frame[0] = 0x3c
  frame.writeFloatLE(values.roll * BENCH.maxTiltDegrees, 1)
  frame.writeFloatLE(values.pitch * BENCH.maxTiltDegrees, 5)
  frame.writeFloatLE(values.yaw * BENCH.maxYawDegreesPerSecond, 9)
  frame.writeUInt16LE(Math.round(values.throttle * BENCH.maxThrust), 13)
  frame[15] = frame.subarray(0, 15).reduce((sum, byte) => (sum + byte) & 255, 0)
  return frame
}

export function decodeRpyt(frame: Buffer): Axes {
  if (frame.length !== 16 || frame[0] !== 0x3c
    || frame[15] !== frame.subarray(0, 15).reduce((sum, byte) => (sum + byte) & 255, 0)) {
    throw new Error('Invalid CRTP RPYT frame/checksum')
  }
  return parseAxes({ roll: frame.readFloatLE(1) / BENCH.maxTiltDegrees,
    pitch: frame.readFloatLE(5) / BENCH.maxTiltDegrees,
    yaw: frame.readFloatLE(9) / BENCH.maxYawDegreesPerSecond,
    throttle: frame.readUInt16LE(13) / BENCH.maxThrust })
}
