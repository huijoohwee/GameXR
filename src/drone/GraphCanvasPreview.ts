import type { PathPose } from './protocol.ts'

const protocol = 'agentic-graph/learning-canvas/v1'

/** Read-only adapter to Graph's own build, mounted by the local gateway on the same origin. */
export class GraphCanvasPreview {
  private root: HTMLElement
  private frame: HTMLIFrameElement | null = null
  private channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')
  private ready = false
  private latest: PathPose = [0, 0, 0, 0, 0]
  private abort = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(root: HTMLElement) {
    this.root = root
    root.innerHTML = '<p role="status">Loading Graph Canvas…</p>'
    window.addEventListener('message', this.receive)
    void this.load()
  }
  private async load(): Promise<void> {
    try {
      const response = await fetch('/gamexr/graph-canvas/graph-canvas-manifest.json', { signal: this.abort.signal })
      if (!response.ok) throw new Error('unavailable')
      const manifest = await response.json() as Record<string, unknown>
      if (manifest.schema !== 'agentic-graph/learning-canvas-artifact/v1' || manifest.protocol !== protocol
        || manifest.entry !== 'index.html' || manifest.base !== '/gamexr/graph-canvas/'
        || typeof manifest.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/u.test(manifest.sourceRevision)) throw new Error('unsupported')
      if (this.abort.signal.aborted) return
      const frame = document.createElement('iframe')
      frame.title = 'Graph drone Canvas'; frame.src = `/gamexr/graph-canvas/#${this.channel}`
      frame.referrerPolicy = 'no-referrer'
      frame.style.cssText = 'display:block;width:100%;height:280px;border:0;border-radius:8px'
      // The immutable local Graph build is trusted same-origin code; no imported URL is framed.
      this.frame = frame; this.root.replaceChildren(frame)
      this.timer = setTimeout(() => { if (!this.ready) this.unavailable() }, 15000)
    } catch { if (!this.abort.signal.aborted) this.unavailable() }
  }
  private receive = (event: MessageEvent): void => {
    if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== window.location.origin) return
    const data = event.data as Record<string, unknown> | null
    if (!data || data.protocol !== protocol || data.kind !== 'ready' || data.channel !== this.channel
      || Object.keys(data).sort().join(',') !== 'channel,kind,protocol') return
    clearTimeout(this.timer); this.ready = true; this.pose(this.latest)
  }
  private unavailable(): void {
    this.frame?.remove(); this.frame = null; this.ready = false
    this.root.innerHTML = '<p role="status">Graph Canvas unavailable. Start this gateway with the Graph Canvas build, or open the source in Graph to review.</p>'
  }
  pose(pose: PathPose): void {
    this.latest = pose
    if (this.ready) this.frame?.contentWindow?.postMessage({ protocol, kind: 'pose', channel: this.channel, pose }, window.location.origin)
  }
  dispose(): void {
    this.abort.abort(); clearTimeout(this.timer); window.removeEventListener('message', this.receive)
    this.frame?.remove(); this.frame = null
  }
}
