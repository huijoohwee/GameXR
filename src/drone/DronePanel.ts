import './drone.css'
import { BENCH, neutralAxes, shapeAxis, type Axes, type BridgeStatus } from './protocol.ts'

/** Pilot state is private to this panel; game controls and WebMCP have no command handle. */
export class DronePanel {
  private dialog = document.createElement('dialog')
  private listeners = new AbortController()
  private socket: WebSocket | null = null
  private state: BridgeStatus | null = null
  private receivedAt = -Infinity
  private axes = neutralAxes()
  private intent = false
  private sequence = 0
  private lastChallenge = ''
  private timer: number
  private records: object[] = []

  constructor() {
    this.dialog.className = 'drone-panel'
    this.dialog.setAttribute('aria-labelledby', 'drone-title')
    this.dialog.innerHTML = `
      <header><div><p class="eyebrow">LOCAL CONTROL WORKBENCH</p><h2 id="drone-title">Drone bench</h2></div>
      <button id="drone-close" type="button" aria-label="Close drone bench">Close</button></header>
      <p class="drone-source">Simulated receiver · No motor outputs</p>
      <p class="drone-intro">Test four independent controls and command-loss handling. Physical aircraft support awaits a reviewed board and firmware profile.</p>
      <p id="drone-status" role="status">Disconnected</p>
      <div class="drone-actions">
        <button id="drone-connect" type="button">Connect receiver</button>
        <button id="drone-enable" type="button" disabled>Enable bench control</button>
        <button id="drone-disable" type="button" disabled>Disable control</button>
      </div>
      <fieldset id="drone-axes" disabled><legend>Command setpoints</legend>
      ${(['roll', 'pitch', 'yaw', 'throttle'] as const).map(name => `
        <label for="drone-${name}"><span>${name[0]!.toUpperCase() + name.slice(1)} <output id="drone-${name}-value">0.00</output></span>
        <input id="drone-${name}" type="range" min="${name === 'throttle' ? '0' : '-1'}" max="1" step="0.01" value="0"></label>`).join('')}
      <p>Roll/pitch ±10° · yaw ±45°/s · thrust 0–10,000 bench units. Steering dead zone 6%. These signs and limits are not an aircraft calibration.</p>
      </fieldset>
      <dl class="drone-telemetry">
        <div><dt>Receiver identity</dt><dd id="drone-identity">Unavailable</dd></div>
        <div><dt>Telemetry age</dt><dd id="drone-age">Unavailable</dd></div>
        <div><dt>Accepted sequence</dt><dd id="drone-sequence">—</dd></div>
        <div><dt>Accepted setpoints</dt><dd id="drone-setpoint">Unavailable</dd></div>
        <div><dt>Measured attitude / battery</dt><dd>Unavailable in simulated receiver</dd></div>
      </dl>
      <p class="drone-intro">Control resets on focus loss, hidden page, cancelled input, disconnect, or a missed lease. Reconnect never enables control automatically.</p>
      <button id="drone-export" type="button">Export session log</button>
      <p class="drone-intro">Last 1,000 events, kept in memory until this panel closes.</p>`
    document.body.append(this.dialog)
    const listen = (target: EventTarget, event: string, handler: EventListener) =>
      target.addEventListener(event, handler, { signal: this.listeners.signal })
    listen(this.element('connect'), 'click', () => this.connect())
    listen(this.element('enable'), 'click', () => {
      this.resetAxes(); this.sequence = 0; this.lastChallenge = ''; this.intent = true
      this.send({ kind: 'enable' }); this.render()
    })
    listen(this.element('disable'), 'click', () => this.inhibit('Pilot disabled bench control'))
    listen(this.element('close'), 'click', () => this.dispose())
    listen(this.dialog, 'cancel', event => { event.preventDefault(); this.dispose() })
    listen(this.dialog, 'pointercancel', () => this.inhibit('Input cancelled'))
    listen(this.dialog, 'keydown', event => event.stopPropagation())
    listen(this.dialog, 'keyup', event => event.stopPropagation())
    listen(window, 'blur', () => this.inhibit('Focus lost'))
    listen(window, 'pagehide', () => this.inhibit('Page left'))
    listen(window, 'gamepaddisconnected', () => this.inhibit('Controller disconnected'))
    listen(document, 'visibilitychange', () => { if (document.hidden) this.inhibit('Page hidden') })
    for (const name of Object.keys(this.axes) as (keyof Axes)[]) {
      listen(this.element(name), 'input', () => {
        if (!this.intent || !this.state?.enabled) { this.resetAxes(); return }
        const raw = Number((this.element(name) as HTMLInputElement).value)
        this.axes[name] = name === 'throttle' ? Math.max(0, Math.min(1, raw)) : shapeAxis(raw)
        this.element(`${name}-value`).textContent = this.axes[name].toFixed(2)
      })
    }
    listen(this.element('export'), 'click', () => this.exportLog())
    this.timer = window.setInterval(() => this.tick(), BENCH.cadenceMs)
    this.dialog.showModal()
  }

  get open(): boolean { return this.dialog.isConnected }
  private element(name: string): HTMLElement { return this.dialog.querySelector(`#drone-${name}`)! }
  private note(event: string, value: unknown = null): void {
    this.records.push({ at: new Date().toISOString(), event, value })
    if (this.records.length > 1000) this.records.shift()
  }
  private resetAxes(): void {
    this.axes = neutralAxes()
    for (const name of Object.keys(this.axes)) {
      (this.element(name) as HTMLInputElement).value = '0'
      this.element(`${name}-value`).textContent = '0.00'
    }
  }
  private send(value: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (this.socket.bufferedAmount > 4096) { this.socket.close(); return }
      this.socket.send(JSON.stringify(value))
      this.note('sent', value)
    }
  }
  private inhibit(reason: string): void {
    if (this.intent || this.state?.owned) this.send({ kind: 'disable' })
    this.intent = false; this.resetAxes(); this.lastChallenge = ''
    this.note('inhibited', reason)
    this.render(reason)
  }
  private connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return
    if (location.hostname !== '127.0.0.1' || location.protocol !== 'http:') {
      this.render('Open the local address printed by npm run drone:bench to connect.'); return
    }
    this.inhibit('Connecting to simulated receiver')
    const socket = new WebSocket(`ws://${location.host}/gamexr/drone-socket`)
    this.socket = socket
    this.render('Connecting to simulated receiver')
    socket.onmessage = event => {
      if (this.socket !== socket) return
      try {
        const message = JSON.parse(event.data as string) as BridgeStatus | { kind: 'error'; message: string }
        if (message.kind === 'error') { this.inhibit(message.message); return }
        if (message.kind !== 'status' || message.backend !== 'simulated'
          || (message.telemetry && message.telemetry.motorOutputs !== false)) throw new Error('Unexpected receiver')
        const hadOwnership = this.state?.owned
        this.state = message; this.receivedAt = performance.now()
        if ((hadOwnership && !message.owned) || !message.connected) this.inhibit(message.reason)
        if (message.owned && !this.intent) this.send({ kind: 'disable' })
        this.note('status', message)
        this.render()
      } catch { this.inhibit('Invalid bridge response'); socket.close() }
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.state = null; this.socket = null; this.inhibit('Disconnected. Connect and enable again to resume.')
    }
    socket.onerror = () => this.render('Bridge unavailable. Build GameXR, run npm run drone:bench, and open its local address.')
  }
  private tick(): void {
    const age = this.state?.telemetryAgeMs === null || !this.state ? Infinity
      : this.state.telemetryAgeMs + performance.now() - this.receivedAt
    this.element('age').textContent = Number.isFinite(age) ? `${Math.round(age)} ms${age >= BENCH.telemetryMaxAgeMs ? ' · stale' : ''}` : 'Unavailable'
    if (this.intent && age >= BENCH.telemetryMaxAgeMs) { this.inhibit('Telemetry stale'); return }
    if (!this.intent || !this.state?.enabled || !this.state.session || !this.state.telemetry || document.hidden) return
    const challenge = this.state.telemetry.challenge
    if (challenge === this.lastChallenge) return
    this.lastChallenge = challenge
    this.send({ kind: 'controls', profile: BENCH.profile, session: this.state.session,
      challenge, sequence: ++this.sequence, axes: { ...this.axes } })
  }
  private render(message?: string): void {
    const connected = this.socket?.readyState === WebSocket.OPEN && this.state?.connected === true
    const active = this.intent && this.state?.enabled === true
    ;(this.element('connect') as HTMLButtonElement).disabled = !!this.socket && this.socket.readyState <= WebSocket.OPEN
    ;(this.element('enable') as HTMLButtonElement).disabled = !connected || this.intent || this.state?.telemetry?.enabled === true
    ;(this.element('disable') as HTMLButtonElement).disabled = !this.intent
    ;(this.element('axes') as HTMLFieldSetElement).disabled = !active
    this.element('status').textContent = message ?? (active ? 'Bench control enabled · simulated receiver' : this.state?.reason ?? 'Disconnected')
    this.dialog.dataset.control = active ? 'enabled' : 'inhibited'
    const telemetry = this.state?.telemetry
    this.element('identity').textContent = telemetry ? `${telemetry.device} · ${telemetry.firmware}` : 'Unavailable'
    this.element('sequence').textContent = telemetry ? String(telemetry.sequence) : '—'
    this.element('setpoint').textContent = telemetry
      ? Object.entries(telemetry.setpoint).map(([name, value]) => `${name} ${value.toFixed(2)}`).join(' · ') : 'Unavailable'
  }
  private exportLog(): void {
    const blob = new Blob([JSON.stringify({ schema: 'gamexr-drone-bench-log/v1',
      profile: BENCH.profile, physicalAircraft: false, records: this.records }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'gamexr-drone-bench-session.json'; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  dispose(): void {
    if (!this.open) return
    this.inhibit('Drone panel closed')
    this.listeners.abort(); window.clearInterval(this.timer)
    this.socket?.close(); this.socket = null; this.state = null; this.records = []
    this.dialog.close(); this.dialog.remove()
  }
}
