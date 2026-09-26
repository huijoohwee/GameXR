import { CameraSession, type CameraState } from './CameraSession.ts'
import './camera.css'

/** Video stays in this element: no recording, pixel reads, upload or control authority. */
export class CameraView {
  private root = document.createElement('section')
  private video: HTMLVideoElement
  private session: CameraSession
  private listeners = new AbortController()
  private facing: 'user' | 'environment' = 'environment'
  private disposed = false
  private available = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  constructor(parent: HTMLElement) {
    this.root.className = 'drone-camera'
    this.root.setAttribute('aria-label', 'Local camera and telemetry')
    this.root.innerHTML = `<div class="drone-camera-stage">
      <video autoplay muted playsinline aria-label="Local phone camera preview"></video>
      <div class="drone-camera-placeholder">Your camera view</div>
      <div class="drone-camera-overlay"><strong data-camera-source>No device telemetry</strong>
        <span data-camera-attitude>Attitude unavailable</span><span data-camera-reading>No current reading</span></div></div>
      <div class="drone-camera-actions"><button type="button" data-camera-start>Start camera</button>
        <button type="button" data-camera-stop disabled>Stop camera</button>
        <button type="button" data-camera-switch disabled>Switch camera</button></div>
      <p data-camera-status role="status">Camera off · frames stay on this device · no audio</p>`
    parent.append(this.root)
    this.video = this.root.querySelector('video')!
    this.video.muted = true
    this.session = new CameraSession(constraints => navigator.mediaDevices.getUserMedia(constraints), state => this.render(state))
    this.button('start').onclick = () => this.start()
    this.button('stop').onclick = () => this.session.stop()
    this.button('switch').onclick = () => { this.facing = this.facing === 'environment' ? 'user' : 'environment'; this.start() }
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.session.stop('Camera stopped while page is hidden') }, { signal: this.listeners.signal })
    window.addEventListener('pagehide', () => this.session.stop('Camera stopped on page exit'), { signal: this.listeners.signal })
    if (!this.available) {
      this.button('start').disabled = true
      this.status('Camera needs a supported browser on trusted HTTPS or localhost')
    }
  }
  private button(name: string) { return this.root.querySelector<HTMLButtonElement>(`[data-camera-${name}]`)! }
  private status(value: string) { this.root.querySelector('[data-camera-status]')!.textContent = value }
  private start() {
    if (this.disposed || document.hidden || !this.available) return
    void this.session.start(this.facing)
  }
  private render(state: CameraState) {
    if (this.disposed) return
    this.root.dataset.phase = state.phase
    this.button('start').disabled = !this.available || state.phase === 'requesting' || state.phase === 'active'
    this.button('stop').disabled = state.phase !== 'requesting' && state.phase !== 'active'
    this.button('switch').disabled = state.phase !== 'active'
    this.status(state.message)
    this.video.srcObject = state.stream
    if (state.stream) void this.video.play().catch(() => {
      if (this.video.srcObject === state.stream) this.session.stop('Preview could not start; tap Start camera again')
    })
  }
  setTelemetry(source: string, attitude: string, reading: string) {
    this.root.querySelector('[data-camera-source]')!.textContent = source
    this.root.querySelector('[data-camera-attitude]')!.textContent = attitude
    this.root.querySelector('[data-camera-reading]')!.textContent = reading
  }
  dispose() { if (this.disposed) return; this.listeners.abort(); this.session.dispose(); this.disposed = true; this.video.srcObject = null; this.root.remove() }
}
