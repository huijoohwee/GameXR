import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, RequestListener } from 'node:http'
import { networkInterfaces } from 'node:os'

export type GatewayTls = { host: string; cert: Buffer; key: Buffer }
const token = () => randomBytes(32).toString('hex')
const same = (value: string | undefined, expected: string) => !!value && /^[a-f0-9]{64}$/u.test(value)
  && timingSafeEqual(Buffer.from(value), Buffer.from(expected))
export function validateGatewayHost(host: string): void {
  const bytes = host.split('.').map(Number)
  if (bytes.length !== 4 || bytes.some((n, i) => !Number.isInteger(n) || n < 0 || n > 255 || String(n) !== host.split('.')[i])
    || !(host === '127.0.0.1' || bytes[0] === 10 || (bytes[0] === 172 && bytes[1]! >= 16 && bytes[1]! <= 31)
      || (bytes[0] === 192 && bytes[1] === 168))) throw new Error('Gateway needs an explicit private IPv4 interface')
  if (!Object.values(networkInterfaces()).flat().some(item => item?.address === host)) throw new Error('Gateway address is not assigned to this Mac')
}

/** One paired browser per process; secrets remain in memory and expire after one hour. */
export function phoneGateway(origin: () => string, files: RequestListener) {
  const pairing = token(), session = token(), started = Date.now()
  let paired = false, attempts = 0
  const alive = () => Date.now() - started < 3600000
  const authorized = (request: IncomingMessage) => alive() && paired
    && same(request.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('__Host-gamexr='))?.slice(14), session)
  const handler: RequestListener = (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()')
    if (request.headers.host !== new URL(origin()).host) { response.writeHead(403).end(); return }
    if (request.url === '/gamexr/diagnostics-session') {
      response.writeHead(request.method === 'GET' && authorized(request) ? 204 : 401).end(); return
    }
    if (request.url !== '/gamexr/diagnostics-pair') { files(request, response); return }
    if (request.method !== 'POST' || request.headers.origin !== origin()
      || request.headers['content-type'] !== 'application/json' || !alive() || paired
      || Date.now() - started > 900000 || ++attempts > 32) { response.writeHead(403).end(); return }
    let body = '', failed = false
    const deadline = setTimeout(() => { failed = true; response.writeHead(408).end(); request.destroy() }, 5000)
    request.on('error', () => { failed = true; clearTimeout(deadline) })
    request.on('data', (chunk: Buffer) => {
      if (failed) return
      body += chunk.toString('utf8')
      if (Buffer.byteLength(body) > 128) { failed = true; clearTimeout(deadline); response.writeHead(413).end(); request.destroy() }
    })
    request.on('end', () => {
      clearTimeout(deadline); if (failed) return
      try {
        const value = JSON.parse(body)
        if (paired || !alive() || Date.now() - started > 900000 || !same(value.token, pairing) || Object.keys(value).join(',') !== 'token') throw new Error('Invalid pair')
        paired = true
        response.setHeader('Set-Cookie', `__Host-gamexr=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`)
        response.writeHead(204).end()
      } catch { response.writeHead(403).end() }
    })
  }
  return { handler, authorized, alive, pairing }
}
