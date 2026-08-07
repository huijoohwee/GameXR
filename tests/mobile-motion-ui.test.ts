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
  assert.match(headersSource, /Permissions-Policy:[^\n]*accelerometer=\(self\)/)
  assert.match(headersSource, /Permissions-Policy:[^\n]*gyroscope=\(self\)/)
  assert.doesNotMatch(headersSource, /(?:accelerometer|gyroscope)=\(\*\)/)
})
