import { readFlightLink } from './FlightPathLink.ts'

const PROTOCOL = 'agentic-drone-flight-handoff/v1'
export function validFlightMessage(event: MessageEvent, opener: Window, origin: string, channel: string): boolean {
  const value = event.data
  return event.source === opener && event.origin === origin && !!value && typeof value === 'object'
    && Object.keys(value).sort().join(',') === 'channel,kind,protocol,text'
    && value.protocol === PROTOCOL && value.kind === 'path' && value.channel === channel
    && typeof value.text === 'string' && value.text.length <= 500000
}

/** Removes only transfer fields; the pairing owner consumes its token on explicit Connect. */
export function takeFlightTransfer(url: URL): { encoded: string | null; channel: string | null; origin: string | null } {
  const params = new URLSearchParams(url.hash.slice(1))
  const result = { encoded: params.get('flight'), channel: params.get('flightChannel'), origin: params.get('flightOrigin') }
  const duplicate = ['flight', 'flightChannel', 'flightOrigin'].some(key => params.getAll(key).length > 1)
  for (const key of ['flight', 'flightChannel', 'flightOrigin']) params.delete(key)
  url.hash = params.toString()
  if (duplicate || (result.encoded !== null && (result.channel !== null || result.origin !== null)))
    throw new Error('Ambiguous flight transfer link')
  return result
}

export function receiveFlightTransfer(load: (text: Promise<string>) => Promise<boolean>, message: (text: string) => void): () => void {
  const url = new URL(location.href), opener = window.opener as Window | null
  let transfer: ReturnType<typeof takeFlightTransfer>
  try { transfer = takeFlightTransfer(url) }
  catch (error) { message((error as Error).message); history.replaceState(history.state, '', url.href); return () => {} }
  history.replaceState(history.state, '', url.href)
  if (transfer.encoded !== null) {
    void load(readFlightLink(transfer.encoded))
    return () => {}
  }
  if (transfer.channel === null && transfer.origin === null) return () => {}
  let origin: string
  try {
    const parsed = new URL(transfer.origin!)
    if (!opener || !/^[a-f0-9]{32}$/u.test(transfer.channel ?? '') || !['http:', 'https:'].includes(parsed.protocol)
      || parsed.origin !== transfer.origin) throw new Error()
    origin = parsed.origin
  } catch { message('Transfer link needs its original Graph tab. Use paste or import instead.'); return () => {} }
  const channel = transfer.channel!, source = opener!
  const reply = (kind: string) => source.postMessage({ protocol: PROTOCOL, kind, channel }, origin)
  let settled = false
  const dispose = () => {
    settled = true; clearInterval(interval); clearTimeout(timeout); window.removeEventListener('message', receive)
  }
  const receive = (event: MessageEvent) => {
    if (settled || !validFlightMessage(event, source, origin, channel)) return
    dispose()
    void load(Promise.resolve(event.data.text as string)).then(accepted => reply(accepted ? 'accepted' : 'rejected'))
  }
  const interval = setInterval(() => reply('ready'), 250)
  const timeout = setTimeout(() => { dispose(); message('Transfer expired. Send again from Graph, or paste a flight path.') }, 20000)
  window.addEventListener('message', receive)
  message('Waiting for the flight path from Graph…'); reply('ready')
  return dispose
}
