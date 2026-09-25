import { readFlightPath } from './FlightPath.ts'
import { GraphCanvasPreview } from './GraphCanvasPreview.ts'
import { createFlightLink } from './FlightPathLink.ts'
import { receiveFlightTransfer } from './FlightPathTransfer.ts'
import type { PathPose } from './protocol.ts'

/** One admission path for files, paste, browser handoff and phone links. Never enables control. */
export class FlightPathView {
  private root: HTMLElement
  private revision = 0
  private preview: GraphCanvasPreview
  private stopTransfer: () => void
  private text = ''
  private running = false
  private ready = false
  private disposed = false
  poses: readonly PathPose[] | null = null
  onRun: () => void = () => {}
  constructor(root: HTMLElement) {
    this.root = root
    root.innerHTML = `<h3>Graph flight path</h3>
      <p>Send here from Graph Results, paste a path, or open a phone link.</p>
      <details><summary>Paste flight path</summary>
        <label>Flight path JSON <textarea data-path-paste aria-label="Flight path JSON" rows="3" maxlength="500000" style="width:100%;box-sizing:border-box"></textarea></label>
        <button data-path-review type="button">Review pasted path</button>
      </details>
      <label style="display:block;min-width:0">Import flight path <input data-path-file aria-label="Import Graph flight path" type="file" accept=".json,application/json" style="display:block;max-width:100%;width:100%;box-sizing:border-box"></label>
      <p data-path-summary role="status">In Graph: run your drone program, land, then send its flight path from Results.</p>
      <p style="overflow-wrap:anywhere"><a data-path-source target="_blank" rel="noopener noreferrer" hidden>Open source in Graph</a><span data-path-source-hint>Re-export from Graph to include a source link.</span></p>
      <div data-graph-preview></div>
      <p data-path-position>Receiver-accepted path position: unavailable</p>
      <button data-path-run type="button" disabled>Run flight path</button>
      <details><summary>Share flight with iPhone</summary>
        <p>Use the Mac’s trusted HTTPS GameXR address on the same Wi-Fi. For an unpaired phone, paste its unused pairing link. This link contains your path and any pairing token you provide; share it privately. Pairing keeps its existing expiry and one-browser limit.</p>
        <label>Phone GameXR or pairing link <input data-path-destination aria-label="Phone GameXR or pairing link" type="url" autocomplete="off" placeholder="https://…/gamexr/" style="width:100%;box-sizing:border-box"></label>
        <button data-path-link type="button" disabled>Create phone link</button>
        <label data-path-link-result hidden>Phone flight link <textarea data-path-link-text aria-label="Phone flight link" rows="3" readonly style="width:100%;box-sizing:border-box"></textarea></label>
        <button data-path-copy-link type="button" hidden>Copy phone link</button>
        <p data-path-share-status role="status"></p>
      </details>
      <p>Simulated position setpoints · no motors. Review, connect, then Run. Keep Safari visible while running. Stop requires a fresh Run.</p>`
    this.preview = new GraphCanvasPreview(root.querySelector('[data-graph-preview]')!)
    this.input('file').addEventListener('change', event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
      if (!file) return
      void this.load(file.size > 500000 ? Promise.reject(new Error('Flight path exceeds 500 kB')) : file.text())
    })
    this.button('review').addEventListener('click', () => { void this.load(Promise.resolve(this.area('paste').value)) })
    this.button('run').addEventListener('click', () => this.onRun())
    this.button('link').addEventListener('click', () => { void this.makeLink() })
    this.input('destination').addEventListener('input', () => this.clearLink())
    this.button('copy-link').addEventListener('click', () => {
      const text = this.area('link-text'); text.focus(); text.select()
      void navigator.clipboard?.writeText(text.value).then(() => this.shareMessage('Phone link copied. Open it in Safari.'))
        .catch(() => this.shareMessage('Select and copy the phone link above.'))
    })
    this.area('link-text').addEventListener('focus', () => this.area('link-text').select())
    if (location.protocol === 'https:') this.input('destination').value = location.origin + location.pathname
    this.stopTransfer = receiveFlightTransfer(text => this.load(text), text => this.message(text))
  }
  private button(name: string): HTMLButtonElement { return this.root.querySelector(`[data-path-${name}]`)! }
  private input(name: string): HTMLInputElement { return this.root.querySelector(`[data-path-${name}]`)! }
  private area(name: string): HTMLTextAreaElement { return this.root.querySelector(`[data-path-${name}]`)! }
  private clearLink(): void {
    this.area('link-text').value = ''; this.root.querySelector<HTMLElement>('[data-path-link-result]')!.hidden = true
    this.button('copy-link').hidden = true; this.shareMessage('')
  }
  private shareMessage(text: string): void { this.root.querySelector('[data-path-share-status]')!.textContent = text }
  private async makeLink(): Promise<void> {
    if (!this.text || this.running) return
    const revision = this.revision, destination = this.input('destination').value.trim()
    this.clearLink(); this.shareMessage('Preparing phone link…')
    try {
      const link = await createFlightLink(this.text, destination)
      if (this.disposed || revision !== this.revision || this.running || destination !== this.input('destination').value.trim()) return
      this.area('link-text').value = link
      this.root.querySelector<HTMLElement>('[data-path-link-result]')!.hidden = false; this.button('copy-link').hidden = false
      this.shareMessage('Ready to copy. The phone will show the path for review; Connect and Run remain explicit.')
    } catch (error) {
      if (!this.disposed && revision === this.revision && destination === this.input('destination').value.trim())
        this.shareMessage(error instanceof Error ? error.message : 'Could not create phone link')
    }
  }
  private async load(pending: Promise<string>): Promise<boolean> {
    if (this.running || this.disposed) { void pending.catch(() => {}); return false }
    const revision = ++this.revision
    this.poses = null; this.text = ''; this.clearLink(); this.source(null); this.availability(this.ready, false)
    this.preview.pose([0, 0, 0, 0, 0]); this.message('Validating flight path…')
    this.root.querySelector('[data-path-position]')!.textContent = 'Receiver-accepted path position: unavailable'
    try {
      const text = await pending, { poses, sourceUrl } = readFlightPath(text)
      if (revision !== this.revision || this.running || this.disposed) return false
      this.text = text; this.poses = poses; this.preview.pose(poses[0]!); this.source(sourceUrl)
      this.area('paste').value = ''; this.availability(this.ready, false)
      this.message(`Ready for review · ${((poses.length - 1) / 60).toFixed(1)} s · ${poses.length} samples · max altitude ${Math.max(...poses.map(p => p[4])).toFixed(2)} m. Connect receiver, then Run.`)
      return true
    } catch (error) {
      if (!this.disposed && revision === this.revision) this.message(error instanceof Error ? error.message : 'Invalid path')
      return false
    }
  }
  private source(url: string | null): void {
    const anchor = this.root.querySelector<HTMLAnchorElement>('[data-path-source]')!
    anchor.hidden = !url; this.root.querySelector<HTMLElement>('[data-path-source-hint]')!.hidden = !!url
    if (url) { anchor.href = url; anchor.textContent = `Open source in Graph · ${new URL(url).searchParams.get('kgDoc')}` }
    else anchor.removeAttribute('href')
  }
  message(text: string): void { this.root.querySelector('[data-path-summary]')!.textContent = text }
  accepted(pose: PathPose): void {
    this.preview.pose(pose)
    this.root.querySelector('[data-path-position]')!.textContent = `Receiver-accepted path position: x ${pose[1].toFixed(2)} · z ${pose[2].toFixed(2)} · altitude ${pose[4].toFixed(2)} m · ${pose[4] === 0 ? 'landed' : 'airborne'} · tick ${pose[0]}`
  }
  availability(ready: boolean, running: boolean): void {
    if (running && !this.running) { this.revision++; this.clearLink() }
    this.ready = ready; this.running = running
    this.button('run').disabled = !ready || running || !this.poses
    this.button('link').disabled = running || !this.poses
    for (const name of ['file', 'destination']) this.input(name).disabled = running
    this.button('review').disabled = running; this.area('paste').disabled = running
  }
  dispose(): void { this.disposed = true; this.revision++; this.stopTransfer(); this.preview.dispose(); this.root.replaceChildren() }
}
