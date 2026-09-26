import { exactKeys, object, parsePathPose, type PathPose } from './protocol.ts'

/** Consumer admission for Graph's portable data contract; contains no flight physics. */
export function parseFlightPath(text: string): readonly PathPose[] { return readFlightPath(text).poses }

export function readFlightPath(text: string): { poses: readonly PathPose[]; sourceUrl: string | null } {
  if (new TextEncoder().encode(text).byteLength > 500000) throw new Error('Flight path exceeds 500 kB')
  const value = object(JSON.parse(text))
  exactKeys(value, ['schema', 'model', 'physicalAircraft', 'tickRate', 'coordinateFrame', 'sourceDigest', 'sceneDigest', 'samples', ...(value.schema === 'agentic-drone-flight-path/v2' ? ['sourceUrl'] : [])])
  if (!['agentic-drone-flight-path/v1', 'agentic-drone-flight-path/v2'].includes(String(value.schema)) || value.model !== 'kinematic' || value.physicalAircraft !== false
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
  const sourceUrl = value.schema === 'agentic-drone-flight-path/v2' ? readGraphSourceUrl(value.sourceUrl) : null
  return { poses, sourceUrl }
}

/** Imported links are displayed for an explicit click; they are never fetched or executed. */
function readGraphSourceUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid Graph source link')
  const url = new URL(value), file = url.searchParams.get('kgDoc')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !file
    || file.length > 2048 || [...url.searchParams.keys()].join(',') !== 'kgDoc'
    || file.split('/').some(part => part === '..') || /[\\\x00-\x1f]/u.test(file)) throw new Error('Invalid Graph source link')
  return url.href
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
