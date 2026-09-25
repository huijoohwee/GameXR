import { parseFlightPath } from './FlightPath.ts'
import type { PathPose } from './protocol.ts'

/** Isometric trace projection; planned coordinates are never presented as measured flight. */
export class FlightPathView {
  private root: HTMLElement
  private revision = 0
  poses: readonly PathPose[] | null = null
  onRun: () => void = () => {}
  constructor(root: HTMLElement) {
    this.root = root
    root.innerHTML = `<h3>Graph flight path</h3>
      <label style="display:block;min-width:0">Import flight path <input aria-label="Import Graph flight path" type="file" accept=".json,application/json" style="display:block;max-width:100%;width:100%;box-sizing:border-box"></label>
      <p data-path-summary role="status">In Graph: run your drone program, land, then export its flight path from Results.</p>
      <svg viewBox="0 0 360 200" role="img" aria-label="Flight path preview" style="width:100%;max-height:220px;background:#121d2b;border-radius:8px">
        <path data-route fill="none" stroke="#58bdca" stroke-width="2"/>
        <g data-drone stroke="#ffe39a" stroke-width="2" fill="#203040"><path d="M-9,-5L9,5M-9,5L9,-5"/>
          <circle cx="-9" cy="-5" r="4"/><circle cx="9" cy="5" r="4"/><circle cx="-9" cy="5" r="4"/><circle cx="9" cy="-5" r="4"/><circle r="3"/></g>
      </svg>
      <p data-path-position>Receiver-accepted path position: unavailable</p>
      <button data-path-run type="button" disabled>Run flight path</button>
      <p>Simulated position setpoints · no motors. Keep Safari visible while running. Stop requires a fresh Run.</p>`
    root.querySelector('input')!.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0], revision = ++this.revision
      input.value = ''; this.poses = null; this.availability(false, false)
      this.root.querySelector('[data-route]')!.setAttribute('d', '')
      this.root.querySelector('[data-path-position]')!.textContent = 'Receiver-accepted path position: unavailable'
      try {
        if (!file) return
        if (file.size > 500000) throw new Error('Flight path exceeds 500 kB')
        const poses = parseFlightPath(await file.text())
        if (revision !== this.revision) return
        this.poses = poses; this.showPose(poses[0]!)
        this.root.querySelector('[data-route]')!.setAttribute('d', poses.map((p, i) => `${i ? 'L' : 'M'}${this.point(p).join(',')}`).join(' '))
        this.message(`Ready for review · ${((poses.length - 1) / 60).toFixed(1)} s · ${poses.length} samples · max altitude ${Math.max(...poses.map(p => p[4])).toFixed(2)} m. Connect receiver, then Run.`)
      } catch (error) { if (revision === this.revision) this.message(error instanceof Error ? error.message : 'Invalid path') }
    })
    root.querySelector('button')!.addEventListener('click', () => this.onRun())
  }
  private point(p: PathPose): [number, number] { return [180 + (p[1] - p[2]) * 10, 120 + (p[1] + p[2]) * 4 - p[4] * 20] }
  private showPose(p: PathPose): void { this.root.querySelector('[data-drone]')!.setAttribute('transform', `translate(${this.point(p).join(' ')})`) }
  message(text: string): void { this.root.querySelector('[data-path-summary]')!.textContent = text }
  accepted(pose: PathPose): void {
    this.showPose(pose)
    this.root.querySelector('[data-path-position]')!.textContent = `Receiver-accepted path position: x ${pose[1].toFixed(2)} · z ${pose[2].toFixed(2)} · altitude ${pose[4].toFixed(2)} m · ${pose[4] === 0 ? 'landed' : 'airborne'} · tick ${pose[0]}`
  }
  availability(ready: boolean, running: boolean): void {
    this.root.querySelector('button')!.disabled = !ready || running || !this.poses
    this.root.querySelector('input')!.disabled = running
  }
  dispose(): void { this.revision++; this.root.replaceChildren() }
}
