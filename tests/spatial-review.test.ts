import assert from 'node:assert/strict'
import test from 'node:test'
import { SpatialReview, previewSceneEdit, parseSceneReviewExport, readSceneReviewLedger } from '../src/runtime/SpatialReview.ts'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import type { LocalDatabase, SceneSnapshot } from '../src/storage/LocalDatabase.ts'
import { spatialValuesEqual } from '@agentic-graph/spatial-review'

function harness() {
  let manifest = getDefaultSceneManifest(), phase = 'paused', failProjection = false
  let saved: SceneSnapshot = { sceneId: manifest.id, scene: structuredClone(manifest), activeSceneId: manifest.id, revision: 'initial', review: null }
  let writes = 0
  const database: Pick<LocalDatabase, 'getActiveSceneId' | 'getSceneSnapshot' | 'saveScene'> = {
    getActiveSceneId: async () => saved.activeSceneId,
    getSceneSnapshot: async () => structuredClone(saved),
    saveScene: async (scene, _active, expected, review, check) => {
      check?.()
      if (!spatialValuesEqual(saved, expected)) throw new Error('stale-source')
      saved = { ...saved, scene: structuredClone(scene), revision: crypto.randomUUID(), review: structuredClone(review) }
      writes++
      return saved.revision
    },
  }
  const controller = new SpatialReview(database, {
    manifest: () => structuredClone(manifest), phase: () => phase,
    enqueue: operation => operation(),
    project: async (candidate, persist) => { await persist(); if (failProjection) throw new Error('projection failed'); manifest = structuredClone(candidate) },
    block: () => { phase = 'blocked' }, recovered: () => { phase = 'paused' },
  })
  return { controller, get saved() { return structuredClone(saved) }, get manifest() { return structuredClone(manifest) }, get writes() { return writes },
    setPhase: (value: string) => { phase = value }, fail: (value: boolean) => { failProjection = value },
    mutate: (mutate: (value: typeof manifest) => void) => { mutate(manifest); saved.scene = structuredClone(manifest); saved.revision = crypto.randomUUID() },
    externalWrite: () => { saved.revision = crypto.randomUUID() },
  }
}
async function preview(h: ReturnType<typeof harness>, edit: unknown = { scale: 2 }) {
  const { source } = await h.controller.inspect()
  return h.controller.preview(edit, { schema: source.schema, sourceKind: source.sourceKind, sourceToken: source.token })
}

test('preview/cancel never persist; exact local acceptance writes one scene/receipt and replay is refused', async () => {
  const h = harness(), before = h.saved
  await preview(h); assert.deepEqual(h.saved, before); h.controller.cancel(); assert.equal(h.writes, 0)
  const p = await preview(h)
  const decisions = await Promise.allSettled([h.controller.accept(p.id, p.digest), h.controller.accept(p.id, p.digest)])
  assert.equal(decisions[0]!.status, 'fulfilled'); assert.equal(decisions[1]!.status, 'rejected')
  const receipt = (decisions[0] as PromiseFulfilledResult<Awaited<ReturnType<SpatialReview['accept']>>>).value
  assert.equal(h.writes, 1); assert.equal(h.manifest.ship.scale, 2)
  assert.equal(readSceneReviewLedger(h.saved.review, h.manifest.id).receipts[0]?.id, receipt.id)
  await assert.rejects(h.controller.accept(p.id, p.digest)); assert.equal(h.writes, 1)
})

test('foreign bindings, approval fields, unsupported geometry and invalid transforms fail closed', async () => {
  const h = harness(), { source } = await h.controller.inspect()
  for (const binding of [
    { schema: source.schema, sourceKind: 'graph-workspace', sourceToken: source.token },
    { schema: source.schema, sourceKind: source.sourceKind, sourceToken: source.token, approved: true },
    { schema: source.schema, sourceKind: source.sourceKind, sourceToken: 'gamexr-manifest:' + '0'.repeat(64) },
  ]) await assert.rejects(h.controller.preview({ scale: 2 }, binding as never))
  for (const input of [{ scale: 100 }, { position: [0, 0] }, { rotation: [0, 0, 0] }, { scale: NaN }]) assert.throws(() => previewSceneEdit(h.manifest, input))
  h.mutate(m => { m.ship.asset = { kind: 'local-glb', localAssetId: 'local' } })
  await assert.rejects(preview(h)); assert.equal(h.writes, 0)
})

test('running flight, expired approval, source ABA, stale digest and cancellation cannot commit', async () => {
  for (const mode of ['running', 'expiry', 'aba', 'digest', 'cancel']) {
    const h = harness(), p = await preview(h)
    if (mode === 'running') h.setPhase('running')
    if (mode === 'aba') h.externalWrite()
    if (mode === 'cancel') h.controller.cancel()
    const clock = Date.now
    try {
      if (mode === 'expiry') Date.now = () => p.expiresAt
      await assert.rejects(h.controller.accept(p.id, mode === 'digest' ? 'wrong' : p.digest))
      assert.equal(h.writes, 0)
    } finally { Date.now = clock }
  }
})

test('post-commit projection failure retains receipt, gates further changes, and recovers saved source', async () => {
  const h = harness(), p = await preview(h); h.fail(true)
  await assert.rejects(h.controller.accept(p.id, p.digest), /projection failed/)
  assert.equal(h.writes, 1); assert.equal(h.saved.scene?.ship.scale, 2)
  assert.equal(readSceneReviewLedger(h.saved.review, h.manifest.id).receipts.length, 1)
  assert.equal(h.controller.recoveryRequired, true); await assert.rejects(preview(h))
  h.fail(false); await h.controller.recover()
  assert.equal(h.controller.recoveryRequired, false); assert.equal(h.manifest.ship.scale, 2); assert.equal(h.writes, 1)
})

test('guarded undo preserves unrelated fields, survives exported history, and rejects later affected edits', async () => {
  const h = harness(), p = await preview(h), original = h.manifest.ship.scale
  const receipt = await h.controller.accept(p.id, p.digest)
  const bundle = parseSceneReviewExport(JSON.parse(await h.controller.exportBundle()))
  assert.equal(bundle.review.imported, true); assert.deepEqual(bundle.review.receipts[0], receipt)
  h.mutate(m => { m.name = 'Unrelated newer name' })
  const undo = await h.controller.previewUndo(receipt.id); await h.controller.accept(undo.id, undo.digest)
  assert.equal(h.manifest.ship.scale, original); assert.equal(h.manifest.name, 'Unrelated newer name')
  await assert.rejects(h.controller.previewUndo(receipt.id))
  const p2 = await preview(h); const r2 = await h.controller.accept(p2.id, p2.digest)
  h.mutate(m => { m.ship.scale = 3 })
  await assert.rejects(h.controller.previewUndo(r2.id)); assert.equal(h.writes, 3)
})

test('partial, malformed, oversized and inconsistent history imports reject before effects', async () => {
  const h = harness(), p = await preview(h); await h.controller.accept(p.id, p.digest)
  const bundle = JSON.parse(await h.controller.exportBundle())
  for (const invalid of [{ ...bundle, review: null }, { ...bundle, manifest: null }, { ...bundle, extra: true }, { ...bundle, padding: 'x'.repeat(140000) }]) assert.throws(() => parseSceneReviewExport(invalid))
  bundle.review.receipts[0].diff.fields = ['position']; assert.throws(() => parseSceneReviewExport(bundle))
  assert.equal(h.writes, 1)
})


test('tool session replacement invalidates both pending approval and old source bindings', async () => {
  const h = harness(), p = await preview(h)
  h.controller.replaceSession()
  await assert.rejects(h.controller.accept(p.id, p.digest))
  await assert.rejects(h.controller.preview({ scale: 2 }, { schema: p.source.schema, sourceKind: p.source.sourceKind, sourceToken: p.source.token }))
  assert.equal(h.writes, 0)
})


test('cancelling while source hashing is pending cannot resurrect a proposal', async () => {
  const h = harness(), { source } = await h.controller.inspect()
  const pending = h.controller.preview({ scale: 2 }, { schema: source.schema, sourceKind: source.sourceKind, sourceToken: source.token })
  h.controller.cancel()
  await assert.rejects(pending)
  assert.equal(h.controller.proposal, null); assert.equal(h.writes, 0)
})
