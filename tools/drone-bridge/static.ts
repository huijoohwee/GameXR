import type { RequestListener } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' }

/** Shared GameXR file surface; network access is owned by the caller. The caller binds the exact listening origin. */
export function staticHandler(root: string, origin: () => string, base = '/gamexr/', framed = false): RequestListener {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', framed ? "frame-ancestors 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'" : "frame-ancestors 'none'")
    if (request.headers.host !== new URL(origin()).host) { response.writeHead(403).end(); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return }
    try {
      const pathname = decodeURIComponent(new URL(request.url!, origin()).pathname)
      if (pathname === '/') { response.writeHead(302, { Location: base }).end(); return }
      if (!pathname.startsWith(base)) { response.writeHead(404).end(); return }
      const relative = pathname.slice(base.length) || 'index.html'
      const filename = await realpath(path.resolve(root, relative))
      if (!filename.startsWith(root + path.sep) || !mime[path.extname(filename)]) { response.writeHead(403).end(); return }
      const data = await readFile(filename)
      response.setHeader('Content-Type', mime[path.extname(filename)]!)
      response.writeHead(200).end(request.method === 'HEAD' ? undefined : data)
    } catch { response.writeHead(404).end() }
  }
}
