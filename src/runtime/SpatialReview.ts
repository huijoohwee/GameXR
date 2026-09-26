import {
  canonicalSpatialJson, createSpatialSourceIdentity, enforceSpatialBudget, freezeSpatial,
  refuse, requireSpatialCapability, spatialDigest, spatialValuesEqual, SPATIAL_REVIEW_MAX_RECEIPTS,
  type SpatialSourceBinding, type SpatialSourceIdentity,
} from '@agentic-graph/spatial-review'
import { applyManifestPatch, validateSceneManifest } from '../config/manifest.ts'
import type { SceneManifest } from '../config/types.ts'
import type { LocalDatabase, SceneSnapshot } from '../storage/LocalDatabase.ts'

export const SCENE_REVIEW_SCHEMA = 'gamexr.scene-review/v1'
export const SCENE_REVIEW_EXPORT_SCHEMA = 'gamexr.scene-review-export/v1'
type Transform = Pick<SceneManifest['ship'], 'position' | 'scale'>
type Field = keyof Transform
type Actor = 'local-operator' | 'browser-agent'
export type SceneReviewDiff = { fields: Field[]; before: Transform; after: Transform }
export type SceneReviewReceipt = {
  id: string; proposalDigest: string; sourceToken: string; sceneDigest: string; documentId: string
  timestamp: number; actor: Actor; approver: 'local-operator'; kind: 'apply' | 'undo'; undoOf?: string
  context: string; diff: SceneReviewDiff
}
export type SceneReviewLedger = { schema: typeof SCENE_REVIEW_SCHEMA; imported: boolean; receipts: SceneReviewReceipt[] }
export type SceneReviewProposal = {
  id: string; digest: string; source: SpatialSourceIdentity; expiresAt: number; actor: Actor
  kind: 'apply' | 'undo'; undoOf?: string; candidate: SceneManifest; diff: SceneReviewDiff; context: string
}
type ReviewDatabase = Pick<LocalDatabase, 'getActiveSceneId' | 'getSceneSnapshot' | 'saveScene'>
interface Pending { proposal: SceneReviewProposal; snapshot: SceneSnapshot }
interface ReviewHost {
  manifest: () => SceneManifest
  phase: () => string
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>
  project: (manifest: SceneManifest, persist: () => Promise<void>) => Promise<void>
  block: (message: string) => void
  recovered: () => void
}
const provenance = Object.freeze({ authored: 'saved starting transform', simulatedPose: 'separate live flight state',
  units: 'manifest world units', physicalScale: 'unknown', correspondence: 'unknown', geometry: 'unavailable', assetSource: 'procedural or device-local bytes; no URL fetch' })
const hash = /^[a-f0-9]{64}$/
const identifier = /^[a-zA-Z0-9_-]{1,96}$/
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) refuse('invalid-input', 'Unsupported review fields.')
  return value as Record<string, unknown>
}
function transform(value: unknown): Transform {
  const raw = object(value, ['position', 'scale'])
  if (!Array.isArray(raw.position) || raw.position.length !== 3 || raw.position.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1000)
    || typeof raw.scale !== 'number' || !Number.isFinite(raw.scale) || raw.scale < 0.01 || raw.scale > 20) refuse('invalid-input', 'Malformed authored transform in review history.')
  return { position: [...raw.position] as Transform['position'], scale: raw.scale }
}
function values(manifest: SceneManifest): Transform { return structuredClone({ position: manifest.ship.position, scale: manifest.ship.scale }) }
function context(manifest: SceneManifest): string { return canonicalSpatialJson({ asset: manifest.ship.asset, rotation: manifest.ship.rotation }) }
export function readSceneReviewLedger(value: unknown, sceneId: string): SceneReviewLedger {
  if (value === null || value === undefined) return { schema: SCENE_REVIEW_SCHEMA, imported: false, receipts: [] }
  enforceSpatialBudget(value)
  const raw = object(value, ['schema', 'imported', 'receipts'])
  if (raw.schema !== SCENE_REVIEW_SCHEMA || typeof raw.imported !== 'boolean' || !Array.isArray(raw.receipts) || raw.receipts.length > SPATIAL_REVIEW_MAX_RECEIPTS) refuse('invalid-input', 'Unsupported or oversized review history.')
  const ids = new Set<string>()
  for (const item of raw.receipts) {
    const r = object(item, ['id', 'proposalDigest', 'sourceToken', 'sceneDigest', 'documentId', 'timestamp', 'actor', 'approver', 'kind', 'undoOf', 'context', 'diff'])
    if (typeof r.id !== 'string' || !identifier.test(r.id) || ids.has(r.id) || typeof r.proposalDigest !== 'string' || !hash.test(r.proposalDigest)
      || typeof r.sceneDigest !== 'string' || !hash.test(r.sceneDigest) || typeof r.sourceToken !== 'string' || !/^gamexr-manifest:[a-f0-9]{64}$/.test(r.sourceToken)
      || r.documentId !== sceneId || !Number.isSafeInteger(r.timestamp) || (r.timestamp as number) < 0
      || !['local-operator', 'browser-agent'].includes(r.actor as string) || r.approver !== 'local-operator'
      || !['apply', 'undo'].includes(r.kind as string) || (r.kind === 'undo' ? typeof r.undoOf !== 'string' || !identifier.test(r.undoOf) : r.undoOf !== undefined)
      || typeof r.context !== 'string' || r.context.length > 2048) refuse('invalid-input', 'Malformed review receipt. Preserve the source and repair its history.')
    const diff = object(r.diff, ['fields', 'before', 'after'])
    if (!Array.isArray(diff.fields) || diff.fields.length < 1 || diff.fields.length > 2 || new Set(diff.fields).size !== diff.fields.length || diff.fields.some(key => !['position', 'scale'].includes(key))) refuse('invalid-input', 'Malformed inverse fields.')
    const before = transform(diff.before), after = transform(diff.after)
    for (const key of ['position', 'scale'] as const) {
      if (diff.fields.includes(key) === spatialValuesEqual(before[key], after[key])) refuse('invalid-input', 'Receipt fields do not match the recorded change.')
    }
    ids.add(r.id)
  }
  return structuredClone(raw) as SceneReviewLedger
}
export function parseSceneReviewExport(value: unknown): { manifest: SceneManifest; review: SceneReviewLedger } {
  enforceSpatialBudget(value)
  const raw = object(value, ['schema', 'manifest', 'review'])
  if (raw.schema !== SCENE_REVIEW_EXPORT_SCHEMA || !Object.hasOwn(raw, 'review') || raw.review === null) refuse('invalid-input', 'A review import requires both its manifest and complete history.')
  const parsed = validateSceneManifest(raw.manifest)
  if (!parsed.ok) refuse('invalid-input', parsed.issues.join(' '))
  const review = readSceneReviewLedger(raw.review, parsed.value.id)
  return { manifest: parsed.value, review: { ...review, imported: true } }
}
export function previewSceneEdit(manifest: SceneManifest, input: unknown): { candidate: SceneManifest; diff: SceneReviewDiff } {
  if (manifest.ship.asset.kind !== 'procedural') refuse('unsupported-geometry', 'Review currently supports the procedural ship. Local GLB geometry is unavailable.')
  const edit = object(input, ['position', 'scale'])
  if (!Object.keys(edit).length) refuse('invalid-input', 'Provide a saved position or scale.')
  const parsed = applyManifestPatch(manifest, { ship: edit })
  if (!parsed.ok) refuse('invalid-input', parsed.issues.join(' '))
  const before = values(manifest), after = values(parsed.value)
  for (const key of Object.keys(edit) as Field[]) if (!spatialValuesEqual(edit[key], after[key])) refuse('invalid-input', 'The requested transform must survive manifest validation exactly.')
  const fields = (['position', 'scale'] as const).filter(key => !spatialValuesEqual(before[key], after[key]))
  if (!fields.length) refuse('invalid-input', 'The proposed transform does not change the saved scene.')
  return freezeSpatial({ candidate: parsed.value, diff: { fields, before, after } })
}

/** One ephemeral proposal; the existing database and runtime queue remain the only writers. */
export class SpatialReview extends EventTarget {
  private session = crypto.randomUUID()
  private epoch = 0
  private pending: Pending | null = null
  private committing = false
  private needsRecovery = false
  private readonly database: ReviewDatabase
  private readonly host: ReviewHost
  constructor(database: ReviewDatabase, host: ReviewHost) { super(); this.database = database; this.host = host }
  get busy(): boolean { return this.committing }
  get recoveryRequired(): boolean { return this.needsRecovery }
  get proposal(): SceneReviewProposal | null { return this.pending?.proposal ?? null }
  invalidate(): void { this.epoch++; this.pending = null; this.dispatchEvent(new Event('change')) }
  cancel(): void { this.invalidate() }
  replaceSession(): void { this.session = crypto.randomUUID(); this.invalidate() }
  projectionFailed(): void {
    this.needsRecovery = true
    this.invalidate()
    this.host.block('The source was saved but projection failed. Recover the saved scene before continuing.')
  }
  private ensurePaused(): void {
    if (!['idle', 'paused'].includes(this.host.phase())) refuse('flight-active', 'Pause flight before accepting a saved scene change.')
  }
  private async source() {
    if (['disposed', 'blocked'].includes(this.host.phase()) || this.committing || this.needsRecovery) refuse('recovery-required', 'Wait for the current commit or recover the saved scene.')
    const epoch = this.epoch, manifest = this.host.manifest()
    const snapshot = await this.database.getSceneSnapshot(manifest.id)
    if (snapshot.activeSceneId !== manifest.id || !spatialValuesEqual(snapshot.scene, manifest)) refuse('source-unavailable', 'The saved scene changed in another view. Reload or recover it before review.')
    const review = readSceneReviewLedger(snapshot.review, manifest.id)
    enforceSpatialBudget({ manifest, review })
    const identity = await createSpatialSourceIdentity({ sourceKind: 'gamexr-manifest', schema: manifest.schema,
      documentId: manifest.id, session: this.session, revision: `${snapshot.revision}:${await spatialDigest(manifest)}` })
    if (epoch !== this.epoch || !spatialValuesEqual(manifest, this.host.manifest())) refuse('stale-source', 'The scene changed during inspection.')
    return { manifest, snapshot, identity, review, epoch }
  }
  async inspect() {
    const source = await this.source()
    return freezeSpatial({ source: source.identity, capabilities: source.manifest.ship.asset.kind === 'procedural' ? ['inspect', 'preview', 'export'] : ['inspect', 'export'],
      operatorActions: ['accept', 'cancel', 'review-undo', 'recover'], authored: values(source.manifest), provenance,
      review: source.review, proposal: this.proposal, geometryAvailable: false,
      cost: { modelCalls: 0, networkCalls: 0, paidCalls: 0 } })
  }
  async preview(input: unknown, binding: SpatialSourceBinding, actor: Actor = 'local-operator'): Promise<SceneReviewProposal> {
    this.invalidate()
    const source = await this.source()
    requireSpatialCapability(source.identity, binding, 'preview', source.manifest.ship.asset.kind === 'procedural' ? ['preview'] : [])
    return this.propose(source, input, actor)
  }
  private async propose(source: Awaited<ReturnType<SpatialReview['source']>>, input: unknown, actor: Actor, undoOf?: string): Promise<SceneReviewProposal> {
    const preview = previewSceneEdit(source.manifest, input)
    const digest = await spatialDigest({ source: source.identity, ...preview, undoOf: undoOf ?? null })
    if (source.epoch !== this.epoch) refuse('stale-source', 'The proposal was cancelled or its source changed.')
    const proposal: SceneReviewProposal = freezeSpatial({ id: crypto.randomUUID(), digest, source: source.identity,
      expiresAt: Date.now() + 300_000, actor, kind: undoOf ? 'undo' : 'apply', ...(undoOf ? { undoOf } : {}),
      ...preview, context: context(source.manifest) })
    enforceSpatialBudget({ proposal, review: source.review })
    this.pending = { proposal, snapshot: source.snapshot }
    this.dispatchEvent(new Event('change'))
    return proposal
  }
  async previewUndo(id: string): Promise<SceneReviewProposal> {
    this.invalidate()
    const source = await this.source()
    const receipt = source.review.receipts.find(row => row.id === id && row.kind === 'apply')
    if (!receipt || source.review.receipts.some(row => row.undoOf === id)) refuse('conflict', 'This receipt is missing or already undone.')
    if (context(source.manifest) !== receipt.context || receipt.diff.fields.some(key => !spatialValuesEqual(source.manifest.ship[key], receipt.diff.after[key]))) refuse('conflict', 'An affected ship value changed after this receipt. Create a fresh proposal.')
    const input = Object.fromEntries(receipt.diff.fields.map(key => [key, receipt.diff.before[key]]))
    return this.propose(source, input, 'local-operator', id)
  }
  /** Only the local review view calls this method. It is deliberately absent from WebMCP. */
  async accept(id: string, digest: string): Promise<SceneReviewReceipt> {
    if (this.committing || this.needsRecovery) refuse('recovery-required', 'A commit or recovery is already pending.')
    const pending = this.pending
    if (!pending || pending.proposal.id !== id || pending.proposal.digest !== digest) refuse('stale-approval', 'Accept the exact proposal currently shown in review.')
    this.ensurePaused()
    if (Date.now() >= pending.proposal.expiresAt) { this.invalidate(); refuse('expired', 'This proposal expired. Create a fresh preview.') }
    this.committing = true
    this.invalidate()
    const epoch = this.epoch
    const check = () => {
      this.ensurePaused()
      if (epoch !== this.epoch || Date.now() >= pending.proposal.expiresAt || !spatialValuesEqual(this.host.manifest(), pending.snapshot.scene)) refuse('stale-approval', 'The source or approval changed before commit.')
    }
    let committed = false
    try {
      return await this.host.enqueue(async () => {
        check()
        const p = pending.proposal
        const receipt: SceneReviewReceipt = { id: crypto.randomUUID(), proposalDigest: p.digest, sourceToken: p.source.token,
          sceneDigest: await spatialDigest(p.candidate), documentId: p.candidate.id, timestamp: Date.now(), actor: p.actor,
          approver: 'local-operator', kind: p.kind, ...(p.undoOf ? { undoOf: p.undoOf } : {}), context: p.context, diff: p.diff }
        const previous = readSceneReviewLedger(pending.snapshot.review, p.candidate.id)
        const ledger: SceneReviewLedger = { ...previous, receipts: [...previous.receipts.slice(-(SPATIAL_REVIEW_MAX_RECEIPTS - 1)), receipt] }
        enforceSpatialBudget({ manifest: p.candidate, review: ledger })
        let revision = ''
        await this.host.project(p.candidate, async () => {
          check()
          revision = await this.database.saveScene(p.candidate, true, pending.snapshot, ledger, check)
          committed = true
        })
        const saved = await this.database.getSceneSnapshot(p.candidate.id)
        if (saved.revision !== revision || saved.activeSceneId !== p.candidate.id || !spatialValuesEqual(saved.scene, p.candidate) || !spatialValuesEqual(saved.review, ledger)) refuse('persistence-indeterminate', 'Commit readback changed. Recover from saved source before continuing.')
        return freezeSpatial(receipt)
      })
    } catch (error) {
      if (committed) {
        this.needsRecovery = true
        this.host.block('The scene and receipt were saved, but projection or readback failed. Recover the saved scene; do not repeat acceptance.')
      }
      throw error
    } finally { this.committing = false; this.dispatchEvent(new Event('change')) }
  }
  async exportBundle(): Promise<string> {
    const source = await this.source()
    const bundle = { schema: SCENE_REVIEW_EXPORT_SCHEMA, manifest: source.manifest, review: source.review }
    enforceSpatialBudget(bundle)
    return JSON.stringify(bundle)
  }
  async recover(): Promise<void> {
    if (this.committing) refuse('busy', 'Wait for the pending commit.')
    this.invalidate()
    this.committing = true
    try {
      await this.host.enqueue(async () => {
        const id = await this.database.getActiveSceneId()
        if (!id) refuse('source-unavailable', 'No active saved scene is available.')
        const source = await this.database.getSceneSnapshot(id)
        const parsed = validateSceneManifest(source.scene)
        if (!parsed.ok) refuse('invalid-input', parsed.issues.join(' '))
        readSceneReviewLedger(source.review, id)
        await this.host.project(parsed.value, async () => {
          const current = await this.database.getSceneSnapshot(id)
          if (!spatialValuesEqual(current, source)) refuse('stale-source', 'Saved source changed during recovery.')
        })
        this.needsRecovery = false
        this.host.recovered()
      })
    } catch (error) { this.needsRecovery = true; this.host.block('Saved scene recovery failed. Preserve the source and retry recovery.'); throw error }
    finally { this.committing = false; this.dispatchEvent(new Event('change')) }
  }
}
