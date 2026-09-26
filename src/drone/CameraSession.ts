export type CameraState = { phase: 'off' | 'requesting' | 'active' | 'error'; message: string; stream: MediaStream | null }
export type CameraRequest = (constraints: MediaStreamConstraints) => Promise<MediaStream>

/** Owns one local camera stream; late permission grants cannot revive stopped capture. */
export class CameraSession {
  private generation = 0
  private stream: MediaStream | null = null
  private disposed = false
  private request: CameraRequest
  private changed: (state: CameraState) => void
  constructor(request: CameraRequest, changed: (state: CameraState) => void) {
    this.request = request; this.changed = changed
  }
  async start(facing: 'user' | 'environment' = 'environment'): Promise<void> {
    if (this.disposed) return
    this.stop('Starting camera')
    const generation = this.generation
    this.changed({ phase: 'requesting', message: 'Waiting for camera permission', stream: null })
    try {
      const stream = await this.request({ audio: false, video: { facingMode: { ideal: facing },
        width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 30 } } })
      if (this.disposed || generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return }
      if (!stream.getVideoTracks().length) { stream.getTracks().forEach(track => track.stop()); throw new Error('NoVideoTrack') }
      this.stream = stream
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
        if (this.stream === stream) this.stop('Camera disconnected; start again when ready')
      }, { once: true })
      this.changed({ phase: 'active', message: 'Camera on · local preview only', stream })
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      const name = error instanceof Error ? error.name : ''
      const message = name === 'NotAllowedError' ? 'Camera permission denied; allow it in browser settings and retry'
        : name === 'NotFoundError' ? 'No camera found'
        : name === 'NotReadableError' ? 'Camera is busy or unavailable'
        : name === 'OverconstrainedError' ? 'This camera cannot provide the bounded video format'
        : 'Camera unavailable; check browser support and permission'
      this.changed({ phase: 'error', message, stream: null })
    }
  }
  stop(message = 'Camera off'): void {
    this.generation++
    const stream = this.stream; this.stream = null
    stream?.getTracks().forEach(track => track.stop())
    if (!this.disposed) this.changed({ phase: 'off', message, stream: null })
  }
  dispose(): void { this.stop(); this.disposed = true }
}
