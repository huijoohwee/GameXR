import { exactKeys, object, parsePathPose, type PathPose } from './protocol.ts'

/** Consumer admission for Graph's portable data contract; contains no flight physics. */
export function parseFlightPath(text: string): readonly PathPose[] {
  if (new TextEncoder().encode(text).byteLength > 500000) throw new Error('Flight path exceeds 500 kB')
  const value = object(JSON.parse(text))
  exactKeys(value, ['schema', 'model', 'physicalAircraft', 'tickRate', 'coordinateFrame', 'sourceDigest', 'sceneDigest', 'samples'])
  if (value.schema !== 'agentic-drone-flight-path/v1' || value.model !== 'kinematic' || value.physicalAircraft !== false
    || value.tickRate !== 60 || value.coordinateFrame !== 'local-xz-altitude-m-heading-deg'
    || ![value.sourceDigest, value.sceneDigest].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v))
    || !Array.isArray(value.samples) || value.samples.length < 2 || value.samples.length > 7201) throw new Error('Unsupported flight path')
  const poses = value.samples.map(parsePathPose)
  if (poses[0]!.some(n => n !== 0) || poses.at(-1)![4] !== 0) throw new Error('Path must start at origin and end landed')
  for (let i = 1; i < poses.length; i++) {
    const p = poses[i]!, previous = poses[i - 1]!
    if (p[0] !== i || Math.hypot(p[1] - previous[1], p[2] - previous[2], p[4] - previous[4]) > 0.050002)
      throw new Error('Discontinuous path or translation over 3 m/s')
  }
  return poses
}

/** Clocked sample selection, not an aircraft controller. A new Run always starts from zero. */
export class FlightPathRun {
  private started: number | null = null
  private sentTick = -1
  readonly poses: readonly PathPose[]
  constructor(poses: readonly PathPose[]) { this.poses = poses }
  next(now: number): PathPose | null {
    this.started ??= now
    const index = Math.min(Math.floor((now - this.started) * 60 / 1000), this.poses.length - 1)
    if (index <= this.sentTick) return null
    if (index - this.sentTick > 12) throw new Error('Flight path timer stalled; Run again')
    this.sentTick = index
    return this.poses[index]!
  }
  complete(accepted: PathPose | null | undefined): boolean {
    const final = this.poses.at(-1)!
    return this.sentTick === final[0] && !!accepted && accepted.every((n, i) => n === final[i])
  }
}
