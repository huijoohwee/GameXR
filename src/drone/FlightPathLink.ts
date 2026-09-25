import { readFlightPath } from './FlightPath.ts'

const MAX_LINK_DATA = 16000

/** Portable review data in the fragment: no upload service, storage, or control grant. */
export async function createFlightLink(text: string, destination: string): Promise<string> {
  readFlightPath(text)
  const url = new URL(destination), params = new URLSearchParams(url.hash.slice(1))
  if (url.protocol !== 'https:' || url.username || url.password || destination.length > 4096
    || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || [...params.keys()].some(key => key !== 'pair') || params.getAll('pair').length > 1
    || (params.has('pair') && !/^[a-f0-9]{64}$/u.test(params.get('pair')!)))
    throw new Error('Use the Mac’s trusted HTTPS GameXR address or its unused phone pairing link.')
  if (typeof CompressionStream === 'undefined') throw new Error('Link compression unavailable. Use Copy flight path.')
  const compressed = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  if (compressed.length > MAX_LINK_DATA * 3 / 4) throw new Error('Path is too large for a phone link. Use copy/paste or export the file.')
  params.set('flight', btoa(String.fromCharCode(...compressed)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, ''))
  url.search = '?drone=1'; url.hash = params.toString()
  return url.href
}

export async function readFlightLink(encoded: string): Promise<string> {
  if (!encoded || encoded.length > MAX_LINK_DATA || !/^[\w-]+$/u.test(encoded)) throw new Error('Invalid or oversized flight link')
  if (typeof DecompressionStream === 'undefined') throw new Error('Link compression unavailable. Use Paste flight path or import a file.')
  const bytes = Uint8Array.from(atob(encoded.replace(/-/gu, '+').replace(/_/gu, '/')), c => c.charCodeAt(0))
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break
      size += next.value.length
      if (size > 500000) throw new Error('Flight path exceeds 500 kB')
      chunks.push(next.value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const decoded = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { decoded.set(chunk, offset); offset += chunk.length }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  readFlightPath(text)
  return text
}
