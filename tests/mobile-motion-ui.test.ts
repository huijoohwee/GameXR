import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const shellSource = readFileSync(new URL('../src/ui/shell.ts', import.meta.url), 'utf8')
const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const headersSource = readFileSync(new URL('../deployment/cloudflare/headers.fragment', import.meta.url), 'utf8')

test('mobile keeps explicit motion and recenter controls visible', () => {
  assert.match(shellSource, /id="motion-control"[^>]*>Enable Motion<\/button>/)
  assert.match(shellSource, /id="motion-recenter"[^>]*>Recenter<\/button>/)
  assert.doesNotMatch(styleSource, /\.transport button:nth-child/)
  assert.match(styleSource, /#fullscreen \{ display: none; \}/)
  assert.match(styleSource, /\.stage-status \{[^}]*display: block;/)
  assert.match(styleSource, /@media \(orientation: landscape\) and \(max-height: 560px\)/)
})

test('production header fragment delegates only same-origin motion sensors', () => {
  assert.match(headersSource, /\/gamexr\/\*[\s\S]*?\n  ! X-Frame-Options\n  X-Frame-Options: SAMEORIGIN\n/)
  assert.match(headersSource, /\/gamexr\/\*[\s\S]*?\n  ! Permissions-Policy\n/)
  assert.match(headersSource, /\/gamexr\/\*[\s\S]*?\n  ! Referrer-Policy\n  Referrer-Policy: no-referrer\n/)
  assert.match(headersSource, /\/gamexr\/\*[\s\S]*?\n  ! X-Content-Type-Options\n  X-Content-Type-Options: nosniff\n/)
  assert.match(headersSource, /Permissions-Policy:[^\n]*accelerometer=\(self\)/)
  assert.match(headersSource, /Permissions-Policy:[^\n]*camera=\(self\)/)
  assert.match(headersSource, /Permissions-Policy:[^\n]*gyroscope=\(self\)/)
  assert.match(headersSource, /Permissions-Policy:[^\n]*xr-spatial-tracking=\(self\)/)
  assert.match(headersSource, /Permissions-Policy:[^\n]*microphone=\(\)/)
  assert.doesNotMatch(headersSource, /(?:accelerometer|camera|gyroscope)=\(\*\)/)
})

test('production header fragment preserves sealed bytes and a self-only application policy', () => {
  assert.match(headersSource, /Content-Security-Policy:[^\n]*script-src 'self'; script-src-attr 'none'/)
  assert.match(headersSource, /Content-Security-Policy:[^\n]*style-src 'self' 'unsafe-inline'/)
  assert.doesNotMatch(headersSource, /Content-Security-Policy:[^\n]*script-src[^;]*(?:unsafe-inline|unsafe-eval|https:)/)

  for (const path of [
    '/gamexr',
    '/gamexr/',
    '/gamexr/index.html',
    '/gamexr/sw.js',
    '/gamexr/manifest.webmanifest',
    '/gamexr/precache-manifest.json',
    '/gamexr/release-manifest.json',
    '/gamexr/llms.txt',
    '/gamexr/.well-known/*',
    '/gamexr/schemas/*',
    '/gamexr/icons/*',
  ]) {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    assert.match(headersSource, new RegExp(`${escapedPath}\\n  Cache-Control: [^\\n]*no-store[^\\n]*no-transform[^\\n]*must-revalidate`, 'u'))
  }
  assert.match(headersSource, /\/gamexr\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable, no-transform\n/)
})
