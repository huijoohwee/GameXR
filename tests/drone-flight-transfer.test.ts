import test from 'node:test'
import assert from 'node:assert/strict'
import { createFlightLink, readFlightLink } from '../src/drone/FlightPathLink.ts'
import { takeFlightTransfer, validFlightMessage } from '../src/drone/FlightPathTransfer.ts'

const path = JSON.stringify({ schema: 'agentic-drone-flight-path/v2', sourceUrl: 'https://example.test/graph/?kgDoc=flight.py',
  model: 'kinematic', physicalAircraft: false, tickRate: 60, coordinateFrame: 'local-xz-altitude-m-heading-deg',
  sourceDigest: 'a'.repeat(64), sceneDigest: 'b'.repeat(64), samples: [[0, 0, 0, 0, 0], [1, 0, 0, 0, 0]] })

test('phone review link roundtrips exact path bytes and preserves only the supplied one-use pairing token', async () => {
  const pair = 'a'.repeat(64)
  const url = new URL(await createFlightLink(path, `https://192.168.0.2:4196/gamexr/?diagnostics=1#pair=${pair}`))
  assert.equal(url.search, '?drone=1')
  const transfer = takeFlightTransfer(url)
  assert.equal(await readFlightLink(transfer.encoded!), path)
  assert.equal(url.hash, '#pair=' + pair)
  assert.deepEqual(takeFlightTransfer(url), { encoded: null, channel: null, origin: null })
  const plain = new URL(await createFlightLink(path, 'https://192.168.0.2:4196/gamexr/'))
  assert.equal(new URLSearchParams(plain.hash.slice(1)).has('pair'), false)
})

test('reject unsafe phone destinations, malformed paths, ambiguous links and oversized decompression', async () => {
  for (const url of ['http://192.168.0.2/gamexr/', 'https://localhost/gamexr/', 'https://u:p@example.test/',
    'javascript:alert(1)', 'https://example.test/#pair=bad', 'https://example.test/#other=x',
    `https://example.test/#pair=${'a'.repeat(64)}&pair=${'a'.repeat(64)}`])
    await assert.rejects(createFlightLink(path, url))
  await assert.rejects(createFlightLink('{}', 'https://example.test/'))
  for (const value of ['', 'a'.repeat(16001), '%bad', 'not-gzip']) await assert.rejects(readFlightLink(value))
  const zip = new Uint8Array(await new Response(new Blob([' '.repeat(500001)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  await assert.rejects(readFlightLink(Buffer.from(zip).toString('base64url')), /exceeds 500 kB/)
  for (const hash of ['flight=a&flight=b', 'flight=a&flightChannel=b', 'flightOrigin=a&flightOrigin=b']) {
    const url = new URL('https://example.test/#pair=' + 'a'.repeat(64) + '&' + hash)
    assert.throws(() => takeFlightTransfer(url), /Ambiguous/)
    assert.equal(url.hash, '#pair=' + 'a'.repeat(64))
  }
})

test('handoff binds path data to its exact opener, origin, channel and envelope', () => {
  const opener = {} as Window, channel = 'a'.repeat(32), origin = 'https://graph.example.test'
  const data = { protocol: 'agentic-drone-flight-handoff/v1', kind: 'path', channel, text: path }
  const event = { source: opener, origin, data } as unknown as MessageEvent
  assert.equal(validFlightMessage(event, opener, origin, channel), true)
  for (const change of [{ source: {} }, { origin: 'https://evil.test' }, { data: { ...data, channel: 'b'.repeat(32) } },
    { data: { ...data, run: true } }, { data: { ...data, kind: 'enable' } }, { data: { ...data, text: 'x'.repeat(500001) } }])
    assert.equal(validFlightMessage({ ...event, ...change } as MessageEvent, opener, origin, channel), false)
})
