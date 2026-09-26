/** Pairing secret is consumed once, removed from browser history, and never stored by JS. */
export async function diagnosticsSocket(): Promise<string> {
  if (location.protocol === 'http:' && location.hostname === '127.0.0.1')
    return `ws://${location.host}/gamexr/diagnostics-socket`
  if (location.protocol !== 'https:') throw new Error('Use the Mac gateway link with trusted HTTPS')
  const token = new URLSearchParams(location.hash.slice(1)).get('pair')
  if (token !== null) {
    history.replaceState(null, '', location.pathname + location.search)
    if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error('Invalid pairing link; use the link printed by the Mac gateway')
    const paired = await fetch('/gamexr/diagnostics-pair', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(6000) })
    if (!paired.ok) throw new Error('Pairing link expired or already used; restart the Mac gateway for a new link')
  }
  const session = await fetch('/gamexr/diagnostics-session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(6000) })
  if (!session.ok) throw new Error('Open the private pairing link printed by the Mac gateway')
  return `wss://${location.host}/gamexr/diagnostics-socket`
}
