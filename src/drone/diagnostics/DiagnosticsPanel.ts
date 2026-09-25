import './diagnostics.css'
import { diagnosticsSocket } from '../PhoneGateway.ts'
import { CameraView } from '../CameraView.ts'
import { STALE_MS, type Snapshot, type Sample, type Vector } from './protocol.ts'
import { fitGyro, fitSixFace, poseMean, validatePose, correctedAccel, subtract, tilt, POSES,
  type Pose, type GyroCalibration, type AccelCalibration } from './calibration.ts'

export class DiagnosticsPanel {
  private dialog = document.createElement('dialog')
  private socket: WebSocket | null = null
  private snapshot: Snapshot | null = null
  private received = -Infinity
  private timer: ReturnType<typeof setInterval>
  private records: { source: string; session: string; sample: Sample }[] = []
  private connection = 0
  private lastKey = ''
  private gyro: GyroCalibration | null = null
  private poses: Partial<Record<Pose, Vector>> = {}
  private accel: AccelCalibration | null = null
  private accelVerified = false
  private capture: { mode: 'gyro' | Pose | 'validate'; samples: Sample[]; target: number } | null = null
  private reconnects = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private sessionKey = ''
  private camera: CameraView

  constructor() {
    this.dialog.className = 'diagnostics-panel'
    this.dialog.setAttribute('aria-labelledby', 'diagnostics-title')
    this.dialog.innerHTML = `
      <header><div><p class="diagnostics-eyebrow">GAMEXR · DEVICE LAB</p><h2 id="diagnostics-title">USB diagnostics</h2></div>
        <button id="diag-close" type="button" aria-label="Close diagnostics">Close</button></header>
      <div class="diagnostics-toolbar"><span id="diag-source" class="diagnostics-badge">OFFLINE</span>
        <span id="diag-state" role="status" aria-live="polite">Connecting to local bridge</span></div>
      <p class="diagnostics-muted">Read-only sensor observation · Motor control unavailable</p>
      <div class="diagnostics-actions"><button id="diag-start">Start capture</button><button id="diag-stop" disabled>Stop</button>
        <button id="diag-reconnect">Reconnect bridge</button><button id="diag-export">Export session</button></div>
      <div id="diag-camera"></div>
      <div class="diagnostics-grid">
        <section class="diagnostics-card"><h3>Acceleration <small>m/s²</small></h3><output id="diag-accel">—</output><p id="diag-frame">Sensor axes · uncalibrated</p></section>
        <section class="diagnostics-card"><h3>Angular rate <small>rad/s</small></h3><output id="diag-gyro">—</output><p id="diag-bias-state">Raw sensor values</p></section>
        <section class="diagnostics-card"><h3>Battery estimate <small>UNVERIFIED</small></h3><output id="diag-battery">—</output><p id="diag-battery-status">Calibration KIV · no battery-health inference</p></section>
        <section class="diagnostics-card"><h3>Link health</h3><output id="diag-age">—</output><p id="diag-sequence">No samples</p><p id="diag-errors">No observations yet</p></section>
      </div>
      <section class="diagnostics-card diagnostics-attitude"><div><h3>Tilt preview</h3><p id="diag-tilt">Unavailable</p>
        <p class="diagnostics-muted">Gravity-derived roll/pitch · yaw unavailable · visualization only</p></div>
        <div class="diagnostics-horizon" aria-hidden="true"><div id="diag-horizon"></div><span>+</span></div></section>
      <details class="diagnostics-calibration"><summary>IMU calibration</summary>
        <p>Keep motor power isolated. Corrections apply only to this dashboard session and clear on reconnect or reboot.</p>
        <label><input id="diag-stationary" type="checkbox"> The board is stationary on a stable surface.</label>
        <button id="diag-fit-gyro">Measure gyro bias · 20 seconds</button>
        <p id="diag-calibration-status" role="status">No correction applied.</p>
        <p><strong>Six known faces:</strong> choose board +X forward, +Y left, +Z up. Point the selected positive or negative axis vertically upward, hold still, then capture it.</p>
        <div class="diagnostics-actions">${POSES.map(p => `<button data-pose="${p}">Capture ${p}</button>`).join('')}</div>
        <p id="diag-poses">0 / 6 faces recorded</p>
        <button id="diag-validate">Verify again with +Z upward · 5 seconds</button>
        <button id="diag-clear">Clear corrections</button>
        <p class="diagnostics-muted">Pose collection needs physical orientation by you. Six-face fitting stays inactive until the independent +Z check passes. Battery calibration is deferred.</p>
      </details>`
    document.body.append(this.dialog)
    this.camera = new CameraView(this.element('camera'))
    this.button('close').onclick = () => this.dispose()
    this.dialog.oncancel = event => { event.preventDefault(); this.dispose() }
    this.button('start').onclick = () => this.command('start')
    this.button('stop').onclick = () => this.command('stop')
    this.button('reconnect').onclick = () => { this.reconnects = 0; this.connect() }
    this.button('export').onclick = () => this.export()
    this.button('fit-gyro').onclick = () => this.begin('gyro')
    this.button('validate').onclick = () => this.begin('validate')
    this.button('clear').onclick = () => this.clearCalibration('Corrections cleared.')
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach(button => { button.onclick = () => this.begin(button.dataset.pose as Pose) })
    this.timer = setInterval(() => this.render(), 200)
    this.dialog.showModal(); this.render(); this.connect()
  }
  get open() { return !this.disposed && this.dialog.isConnected }
  private element(name: string) { return this.dialog.querySelector<HTMLElement>(`#diag-${name}`)! }
  private button(name: string) { return this.element(name) as HTMLButtonElement }
  private text(name: string, text: string) { this.element(name).textContent = text }
  private async connect() {
    if (this.disposed) return
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    const previous = this.socket; this.socket = null; previous?.close()
    this.connection++; this.lastKey = ''; this.sessionKey = ''
    this.snapshot = null; this.clearCalibration('New connection; corrections cleared.')
    const connecting = this.connection
    let address: string
    try { address = await diagnosticsSocket() }
    catch (error) {
      if (!this.disposed && connecting === this.connection) this.text('state', error instanceof Error ? error.message : 'Gateway pairing failed')
      return
    }
    if (this.disposed || connecting !== this.connection) return
    const socket = new WebSocket(address)
    this.socket = socket
    socket.onmessage = event => {
      if (this.socket !== socket || this.disposed) return
      try {
        const status = JSON.parse(event.data as string) as Snapshot
        if (status.kind !== 'diagnostics' || status.actuationAvailable !== false || !['usb', 'replay'].includes(status.source)) throw new Error('Unexpected endpoint')
        const key = `${this.connection}:${status.source}:${status.session}`
        if (this.sessionKey !== key || status.state === 'disconnected') this.clearCalibration('Session changed; corrections cleared.')
        this.sessionKey = key; this.snapshot = status; this.received = performance.now()
        if (status.sample && ['live', 'replay'].includes(status.state)) this.sample(status.sample, key)
        else if (this.capture) this.failCapture('Capture interrupted; retry when data is fresh.')
        this.render()
      } catch { socket.close(1008, 'Invalid telemetry'); this.text('state', 'Invalid bridge response') }
    }
    socket.onclose = () => {
      if (this.socket !== socket || this.disposed) return
      this.socket = null; this.snapshot = null; this.clearCalibration('Connection lost; corrections cleared.'); this.render()
      if (this.reconnects < 3) this.retry = setTimeout(() => this.connect(), 1000 * 2 ** this.reconnects++)
    }
    socket.onerror = () => this.text('state', 'Local diagnostics bridge unavailable')
    socket.onopen = () => this.render()
  }
  private command(action: 'start' | 'stop') {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ action }))
  }
  private clearCalibration(reason: string) {
    this.gyro = null; this.accel = null; this.accelVerified = false; this.poses = {}; this.capture = null
    this.text('calibration-status', reason); this.text('poses', '0 / 6 faces recorded')
  }
  private fresh() {
    const s = this.snapshot
    return !!s && (s.state === 'live' || s.state === 'replay') && s.sample !== null
      && (s.ageMs ?? Infinity) + performance.now() - this.received < STALE_MS
  }
  private begin(mode: 'gyro' | Pose | 'validate') {
    if (!this.fresh() || this.snapshot?.source !== 'usb') { this.text('calibration-status', 'Calibration requires fresh live USB data.'); return }
    if (!(this.element('stationary') as HTMLInputElement).checked) { this.text('calibration-status', 'Confirm the board is stationary first.'); return }
    if (mode === 'validate' && !this.accel) { this.text('calibration-status', 'Collect all six known faces first.'); return }
    this.capture = { mode, samples: [], target: mode === 'gyro' ? 200 : 50 }
    this.text('calibration-status', `Capturing ${mode}; hold still.`)
  }
  private failCapture(reason: string) { this.capture = null; this.text('calibration-status', reason) }
  private sample(sample: Sample, session: string) {
    const key = `${session}:${sample.seq}:${sample.uptime_ms}`
    if (key === this.lastKey) return
    this.lastKey = key
    this.records.push({ source: this.snapshot!.source, session, sample })
    if (this.records.length > 800) this.records.shift()
    if (!this.capture) return
    if (!(this.element('stationary') as HTMLInputElement).checked) { this.failCapture('Stationary confirmation removed; capture stopped.'); return }
    const capture = this.capture
    if (sample.imu.status !== 'ok') { this.failCapture('IMU fault; capture stopped.'); return }
    capture.samples.push(sample)
    this.text('calibration-status', `Capturing ${capture.mode}: ${capture.samples.length} / ${capture.target}`)
    if (capture.samples.length < capture.target) return
    try {
      if (capture.mode === 'gyro') {
        this.gyro = fitGyro(capture.samples, true)
        this.text('calibration-status', 'Gyro correction active in this session; independent window passed.')
      } else if (capture.mode === 'validate') {
        const error = validatePose(this.accel!, '+Z', capture.samples, true)
        this.accelVerified = true
        this.text('calibration-status', `Board-axis correction active; independent error ${error.toFixed(3)} m/s².`)
      } else {
        this.poses[capture.mode] = poseMean(capture.samples, true); this.accel = null; this.accelVerified = false
        const count = Object.keys(this.poses).length
        this.text('poses', `${count} / 6 faces recorded: ${Object.keys(this.poses).join(', ')}`)
        if (count === 6) { this.accel = fitSixFace(this.poses); this.text('calibration-status', 'Candidate ready. Verify a new +Z-up capture before applying.') }
        else this.text('calibration-status', `${capture.mode} recorded. Position the next face.`)
      }
    } catch (error) { this.text('calibration-status', error instanceof Error ? error.message : 'Calibration failed') }
    this.capture = null
  }
  private render() {
    if (this.disposed) return
    const s = this.snapshot, fresh = this.fresh(), sample = fresh ? s!.sample : null
    const age = s?.ageMs === null || !s ? null : Math.round(s.ageMs + performance.now() - this.received)
    this.text('source', s?.source === 'replay' ? 'RECORDED REPLAY' : s?.source === 'usb' ? 'USB OBSERVATION' : 'OFFLINE')
    this.text('state', !s ? 'Bridge disconnected' : !fresh && s.sample ? 'Stale · waiting for new samples' : `${s.state} · ${s.reason}`)
    this.button('start').disabled = this.socket?.readyState !== WebSocket.OPEN || s?.transport === 'connected'
    this.button('stop').disabled = s?.transport !== 'connected'
    this.text('age', age === null ? '—' : `${age} ms${!fresh ? ' · not live' : ''}`)
    this.text('sequence', sample ? `Sample ${sample.seq} · ${s!.gaps} missing · ${s!.accepted} received` : 'No current sample')
    this.text('errors', s ? `${s.rejected} rejected · ${s.boot ? `IMU identity 0x${s.boot.who_am_i.toString(16)}` : 'Boot identity not observed'}` : 'No observations yet')
    const accel = sample?.imu.accel_m_s2, gyro = sample?.imu.gyro_rad_s
    const displayedAccel = accel && this.accel && this.accelVerified ? correctedAccel(this.accel, accel) : accel
    const displayedGyro = gyro && this.gyro ? subtract(gyro, this.gyro.biasRadS) : gyro
    const format = (v: Vector | null | undefined) => v ? v.map(n => n.toFixed(3)).join(' / ') : '—'
    this.text('accel', format(displayedAccel)); this.text('gyro', format(displayedGyro))
    this.text('frame', this.accelVerified ? 'Board axes · calibrated in this session' : 'Sensor axes · uncalibrated')
    this.text('bias-state', this.gyro ? 'Stationary bias corrected in this session' : 'Raw sensor values')
    this.text('battery', sample?.battery.battery_mv !== null && sample?.battery.battery_mv !== undefined ? `${(sample.battery.battery_mv / 1000).toFixed(3)} V` : '—')
    this.text('battery-status', `Calibration KIV · ${sample ? sample.battery.status.replaceAll('_', ' ') : 'no current reading'}`)
    const orientation = displayedAccel ? tilt(displayedAccel) : null
    this.text('tilt', orientation ? `${this.accelVerified ? 'Board' : 'Sensor'} roll ${orientation.roll.toFixed(1)}° · pitch ${orientation.pitch.toFixed(1)}°` : 'Unavailable')
    this.element('horizon').style.transform = orientation ? `rotate(${-orientation.roll}deg) translateY(${Math.max(-25, Math.min(25, orientation.pitch))}px)` : 'none'
    this.element('horizon').style.opacity = orientation ? '1' : '0.2'
    this.camera.setTelemetry(`${s?.source === 'replay' ? 'RECORDED REPLAY' : 'USB IMU'} · ${fresh ? 'fresh' : 'unavailable'} · observation only`,
      orientation ? `${this.accelVerified ? 'Board' : 'Sensor'} roll ${orientation.roll.toFixed(1)}° · pitch ${orientation.pitch.toFixed(1)}° · yaw unavailable` : 'Attitude unavailable',
      sample ? `a ${format(displayedAccel)} m/s² · ω ${format(displayedGyro)} rad/s` : 'No current IMU sample')
    if (!fresh && this.capture) this.failCapture('Data became stale; capture stopped.')
  }
  private export() {
    const data = { schema: 'gamexr/diagnostics-session/v1', exportedAt: new Date().toISOString(),
      actuationAvailable: false, batteryCalibration: 'KIV', snapshot: this.snapshot,
      calibration: { gyro: this.gyro, accelerometer: this.accel, accelerometerValidated: this.accelVerified }, records: this.records }
    const bytes = JSON.stringify(data)
    if (new TextEncoder().encode(bytes).length > 499999) { this.text('state', 'Export exceeds size limit'); return }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'gamexr-diagnostics.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true; clearInterval(this.timer)
    if (this.retry) clearTimeout(this.retry)
    this.camera.dispose(); this.socket?.close(); this.socket = null; this.dialog.close(); this.dialog.remove()
  }
}
