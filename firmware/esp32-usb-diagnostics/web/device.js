// SPDX-License-Identifier: MIT
const element = id => document.getElementById(id)
const text = (id, value) => { element(id).textContent = value }
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
const format = value => value.map(n => n.toFixed(3)).join(' / ')
const cameraAllowed = isSecureContext && !!navigator.mediaDevices?.getUserMedia
let timer, request, latest = null, received = -Infinity, lastSession = null, lastSequence = -1, failures = 0, disposed = false
let cameraGeneration = 0, stream = null, facing = 'environment'
function clear(reason) {
  latest = null; text('link', reason); text('source', 'DIRECT WI-FI · unavailable')
  for (const id of ['accel', 'gyro', 'battery', 'sequence']) text(id, '—')
  text('tilt', 'Tilt unavailable'); text('reading', 'No fresh IMU reading'); text('age', 'No current sample')
}
async function poll() {
  if (disposed || document.hidden || request) return
  const own = new AbortController(); request = own
  const timeout = setTimeout(() => own.abort(), 1200)
  const began = performance.now()
  try {
    const response = await fetch('/api/telemetry', { cache: 'no-store', signal: own.signal })
    if (!response.ok) throw new Error('Device has no fresh telemetry')
    const raw = await response.text()
    if (raw.length > 1024) throw new Error('Unexpected telemetry size')
    const message = JSON.parse(raw), sample = message.sample
    if (message.schema !== 'gamexr.direct-wifi/v1' || message.actuation_available !== false
      || !Number.isInteger(message.session) || !Number.isFinite(message.age_ms) || message.age_ms < 0 || message.age_ms >= 1500
      || sample?.profile !== 'gamexr.usb-diagnostics/v1' || sample.motor_gate_command !== 'low_held'
      || !Number.isInteger(sample.seq) || sample.seq < 0 || sample.imu?.status !== 'ok'
      || !vector(sample.imu.accel_m_s2) || !vector(sample.imu.gyro_rad_s)) throw new Error('IMU unavailable or unsupported device response')
    if (disposed || document.hidden || request !== own) return
    if (lastSession !== message.session) { lastSession = message.session; lastSequence = -1 }
    if (sample.seq <= lastSequence) throw new Error('Waiting for a new device sample')
    lastSequence = sample.seq; latest = message; received = began; failures = 0
    render()
  } catch (error) {
    if (request === own && !disposed) { failures++; clear(error instanceof Error ? error.message : 'Connection lost') }
  } finally {
    clearTimeout(timeout)
    if (request === own) { request = null; if (!disposed && !document.hidden && failures < 5) timer = setTimeout(poll, 300) }
  }
}
function render() {
  if (!latest) return
  const age = latest.age_ms + performance.now() - received
  if (age >= 1500) { clear('Telemetry became stale'); return }
  const sample = latest.sample, a = sample.imu.accel_m_s2, g = sample.imu.gyro_rad_s
  text('link', 'Connected · direct Wi-Fi · observation only'); text('source', 'DIRECT WI-FI · fresh · motors inhibited')
  text('accel', format(a)); text('gyro', format(g)); text('reading', `a ${format(a)} m/s² · ω ${format(g)} rad/s`)
  const norm = Math.hypot(...a)
  text('tilt', norm >= 8.5 && norm <= 11.1 ? `Sensor roll ${(Math.atan2(a[1], a[2])*180/Math.PI).toFixed(1)}° · pitch ${(Math.atan2(-a[0], Math.hypot(a[1],a[2]))*180/Math.PI).toFixed(1)}° · yaw unavailable` : 'Tilt unavailable under motion')
  const battery = sample.battery
  text('battery', battery?.status === 'ok' && Number.isInteger(battery.battery_mv) ? `${(battery.battery_mv/1000).toFixed(2)} V*` : 'Unverified / unavailable')
  text('sequence', `#${sample.seq}`); text('age', `${Math.round(age)} ms old · raw sensor frame`)
}
function stopCamera(reason = 'Camera off') {
  cameraGeneration++; const old = stream; stream = null
  old?.getTracks().forEach(track => track.stop()); element('camera').srcObject = null
  element('placeholder').hidden = false; element('placeholder').style.display = 'grid'
  element('start-camera').disabled = !cameraAllowed; element('stop-camera').disabled = true; element('switch-camera').disabled = true
  text('camera-status', reason)
}
async function startCamera() {
  if (!cameraAllowed || document.hidden || disposed) return
  stopCamera('Waiting for camera permission'); const own = cameraGeneration
  element('start-camera').disabled = true; element('stop-camera').disabled = false
  try {
    const granted = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 30 } } })
    if (disposed || own !== cameraGeneration) { granted.getTracks().forEach(track => track.stop()); return }
    stream = granted
    if (!stream.getVideoTracks().length) throw new Error('No video track')
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (stream === granted) stopCamera('Camera disconnected') }, { once: true })
    const video = element('camera'); video.muted = true; video.srcObject = stream; await video.play()
    if (disposed || own !== cameraGeneration) return
    element('placeholder').style.display = 'none'; element('switch-camera').disabled = false
    text('camera-status', 'Camera on · local preview only · no audio')
  } catch (error) {
    if (own === cameraGeneration) stopCamera(error?.name === 'NotAllowedError' ? 'Camera permission denied; allow access and retry' : 'Camera unavailable; check permission and availability')
  }
}
function pause() {
  clearTimeout(timer); const old = request; request = null; old?.abort()
  clear('Page paused; reconnect when ready'); stopCamera('Camera stopped while page is hidden')
}
element('start-camera').onclick = startCamera
element('stop-camera').onclick = () => stopCamera()
element('switch-camera').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; void startCamera() }
element('retry').onclick = () => { if (!disposed) { clearTimeout(timer); failures = 0; void poll() } }
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else { failures = 0; void poll() } })
window.addEventListener('pagehide', () => { disposed = true; pause(); clearInterval(freshness) })
window.addEventListener('pageshow', () => {
  if (disposed) { disposed = false; failures = 0; freshness = setInterval(render, 200); void poll() }
})
if (!cameraAllowed) { element('start-camera').disabled = true; element('secure-help').hidden = false; text('camera-status', 'Camera requires trusted HTTPS') }
let freshness = setInterval(render, 200)
void poll()
