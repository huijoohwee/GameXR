import test from 'node:test'
import assert from 'node:assert/strict'
import { CameraSession, type CameraState } from '../src/drone/CameraSession.ts'
function fixture() {
  let stops = 0
  const track = Object.assign(new EventTarget(), { stop: () => { stops++ } })
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  return { stream, track, get stops() { return stops } }
}
test('camera permission resolved after stop cannot reactivate capture', async () => {
  let resolve!: (stream: MediaStream) => void
  const states: CameraState[] = [], device = fixture()
  const camera = new CameraSession(() => new Promise(done => { resolve = done }), state => states.push(state))
  const pending = camera.start(); camera.stop(); resolve(device.stream); await pending
  assert.equal(device.stops, 1)
  assert.equal(states.at(-1)?.phase, 'off')
  assert.ok(states.every(state => state.phase !== 'active'))
})
test('camera bounds video, requests no microphone, and releases old tracks on switch and disposal', async () => {
  const first = fixture(), next = fixture(), constraints: MediaStreamConstraints[] = [], states: CameraState[] = []
  const camera = new CameraSession(async options => { constraints.push(options); return constraints.length === 1 ? first.stream : next.stream }, state => states.push(state))
  await camera.start(); await camera.start('user')
  assert.equal(first.stops, 1)
  assert.deepEqual(constraints[1], { audio: false, video: { facingMode: { ideal: 'user' }, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 30 } } })
  camera.dispose(); await camera.start()
  assert.equal(next.stops, 1); assert.equal(constraints.length, 2)
  assert.equal(states.at(-1)?.stream, null)
})
test('denied permission can be retried and externally ended tracks clear the camera', async () => {
  let attempt = 0; const device = fixture(), states: CameraState[] = []
  const camera = new CameraSession(async () => {
    if (++attempt === 1) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    return device.stream
  }, state => states.push(state))
  await camera.start(); assert.match(states.at(-1)!.message, /denied/)
  await camera.start(); assert.equal(states.at(-1)?.phase, 'active')
  device.track.dispatchEvent(new Event('ended'))
  assert.equal(device.stops, 1); assert.equal(states.at(-1)?.phase, 'off')
})

test('phone pairing consumes the URL secret once and fails closed without a paired session', async () => {
  const { diagnosticsSocket } = await import('../src/drone/PhoneGateway.ts')
  const originals = new Map(['location', 'history', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const token = 'a'.repeat(64), requests: { url: string; options: RequestInit }[] = []
  const location = { protocol: 'https:', hostname: '192.168.0.105', host: '192.168.0.105:4196', pathname: '/gamexr/', search: '?diagnostics=1', hash: '#pair=' + token }
  let replaced = ''
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: location })
    Object.defineProperty(globalThis, 'history', { configurable: true, value: { replaceState: (_a: unknown, _b: string, url: string) => { replaced = url; location.hash = '' } } })
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, options: RequestInit) => { requests.push({ url, options }); return { ok: true } } })
    assert.equal(await diagnosticsSocket(), 'wss://192.168.0.105:4196/gamexr/diagnostics-socket')
    assert.equal(replaced, '/gamexr/?diagnostics=1'); assert.equal(location.hash, '')
    assert.deepEqual(requests.map(r => r.url), ['/gamexr/diagnostics-pair', '/gamexr/diagnostics-session'])
    assert.equal(requests[0]!.options.body, JSON.stringify({ token })); assert.equal(requests[0]!.options.credentials, 'same-origin')
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: false }) })
    await assert.rejects(diagnosticsSocket(), /private pairing link/u)
    location.protocol = 'http:'
    await assert.rejects(diagnosticsSocket(), /trusted HTTPS/u)
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
