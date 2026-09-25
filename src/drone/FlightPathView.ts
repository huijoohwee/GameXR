import { readFlightPath } from './FlightPath.ts'
import { GraphCanvasPreview } from './GraphCanvasPreview.ts'
import type { PathPose } from './protocol.ts'

/** Graph owns the preview renderer; this view owns review, source navigation and explicit Run. */
export class FlightPathView {
  private root: HTMLElement
  private revision = 0
  private preview: GraphCanvasPreview
  poses: readonly PathPose[] | null = null
  onRun: () => void = () => {}
  constructor(root: HTMLElement) {
    this.root = root
    root.innerHTML = `<h3>Graph flight path</h3>
      <label style="display:block;min-width:0">Import flight path <input aria-label="Import Graph flight path" type="file" accept=".json,application/json" style="display:block;max-width:100%;width:100%;box-sizing:border-box"></label>
      <p data-path-summary role="status">In Graph: run your drone program, land, then export its flight path from Results.</p>
      <p><a data-path-source target="_blank" rel="noopener noreferrer" hidden>Open source in Graph</a><span data-path-source-hint>Re-export from Graph to include a source link.</span></p>
      <div data-graph-preview></div>
      <p data-path-position>Receiver-accepted path position: unavailable</p>
      <button data-path-run type="button" disabled>Run flight path</button>
      <p>Simulated position setpoints · no motors. Keep Safari visible while running. Stop requires a fresh Run.</p>`
    this.preview = new GraphCanvasPreview(root.querySelector('[data-graph-preview]')!)
    root.querySelector('input')!.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0], revision = ++this.revision
      input.value = ''; this.poses = null; this.availability(false, false)
      this.preview.pose([0, 0, 0, 0, 0]); this.source(null)
      this.root.querySelector('[data-path-position]')!.textContent = 'Receiver-accepted path position: unavailable'
      try {
        if (!file) return
        if (file.size > 500000) throw new Error('Flight path exceeds 500 kB')
        const { poses, sourceUrl } = readFlightPath(await file.text())
        if (revision !== this.revision) return
        this.poses = poses; this.preview.pose(poses[0]!); this.source(sourceUrl)
        this.message(`Ready for review · ${((poses.length - 1) / 60).toFixed(1)} s · ${poses.length} samples · max altitude ${Math.max(...poses.map(p => p[4])).toFixed(2)} m. Connect receiver, then Run.`)
      } catch (error) { if (revision === this.revision) this.message(error instanceof Error ? error.message : 'Invalid path') }
    })
    root.querySelector('button')!.addEventListener('click', () => this.onRun())
  }
  private source(url: string | null): void {
    const anchor = this.root.querySelector<HTMLAnchorElement>('[data-path-source]')!
    anchor.hidden = !url
    this.root.querySelector<HTMLElement>('[data-path-source-hint]')!.hidden = !!url
    if (url) { anchor.href = url; anchor.textContent = `Open source in Graph · ${new URL(url).searchParams.get('kgDoc')}` }
    else anchor.removeAttribute('href')
  }
  message(text: string): void { this.root.querySelector('[data-path-summary]')!.textContent = text }
  accepted(pose: PathPose): void {
    this.preview.pose(pose)
    this.root.querySelector('[data-path-position]')!.textContent = `Receiver-accepted path position: x ${pose[1].toFixed(2)} · z ${pose[2].toFixed(2)} · altitude ${pose[4].toFixed(2)} m · ${pose[4] === 0 ? 'landed' : 'airborne'} · tick ${pose[0]}`
  }
  availability(ready: boolean, running: boolean): void {
    this.root.querySelector('button')!.disabled = !ready || running || !this.poses
    this.root.querySelector('input')!.disabled = running
  }
  dispose(): void { this.revision++; this.preview.dispose(); this.root.replaceChildren() }
}
